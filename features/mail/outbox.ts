import type { ServerActor } from "../auth/types";
import { approvalMandateSql } from "../approval/mandate";
import {
  APPROVAL_TOKEN_PLACEHOLDER,
  approvalTokenForRequest,
} from "../approval/token-service";
import { getOrCreateReceipt, ReceiptError } from "../receipt/server";
import { preparePortalData, resolveActorUserId } from "../workspace/server-repository";
import {
  createGraphMailTransport,
  getGraphMailEnvironment,
  isGraphMailError,
  readGraphMailConfig,
  type MailAttachment,
} from "./index";

type OutboxStatus = "queued" | "processing" | "sent" | "failed" | "cancelled";

type OutboxRow = {
  id: string;
  tenant_id: string;
  application_id: string | null;
  case_number: string | null;
  recipient_email: string;
  recipient_name: string | null;
  template_key: string;
  subject: string;
  text_body: string;
  html_body: string;
  attachments_json: string;
  idempotency_key: string;
  status: OutboxStatus;
  attempt_count: number;
};

type ReceiptReference = {
  receiptKind: "submission" | "approval" | "final";
  applicationVersionId: string;
};

export class OutboxError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OutboxError";
  }
}

class MailAttachmentReferenceError extends Error {
  constructor() {
    super("Mailens bilagsreferencer er ugyldige.");
    this.name = "MailAttachmentReferenceError";
  }
}

class MailCancelledError extends Error {
  constructor() {
    super("Mailen er ikke længere aktuel.");
    this.name = "MailCancelledError";
  }
}

export async function getMailDashboard(actor: ServerActor) {
  requireAdmin(actor);
  const DB = await preparePortalData();
  const configuration = await mailConfigurationStatus();
  const counts = await DB.prepare(`
    SELECT status, COUNT(*) AS count
    FROM portal_mail_outbox
    WHERE tenant_id = ?
    GROUP BY status
  `).bind(actor.tenantId).all<{ status: OutboxStatus; count: number }>();
  const recent = await DB.prepare(`
    SELECT o.id, o.recipient_email, o.recipient_name, o.template_key,
           o.subject, o.status, o.attempt_count, o.last_error,
           o.created_at, o.updated_at, o.sent_at, a.case_number
    FROM portal_mail_outbox o
    LEFT JOIN portal_applications a
      ON a.id = o.application_id AND a.tenant_id = o.tenant_id
    WHERE o.tenant_id = ?
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 50
  `).bind(actor.tenantId).all<{
    id: string;
    recipient_email: string;
    recipient_name: string | null;
    template_key: string;
    subject: string;
    status: OutboxStatus;
    attempt_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    sent_at: string | null;
    case_number: string | null;
  }>();
  return {
    configured: configuration.configured,
    sender: configuration.sender,
    counts: Object.fromEntries(counts.results.map((row) => [row.status, Number(row.count)])),
    messages: recent.results.map((row) => ({
      id: row.id,
      caseNumber: row.case_number,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      templateKey: row.template_key,
      subject: row.subject,
      status: row.status,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sentAt: row.sent_at,
    })),
  };
}

export async function queueStatusMail(
  actor: ServerActor,
  caseNumber: string,
  input: { message: string; idempotencyKey: string },
) {
  if (actor.role === "user") {
    throw new OutboxError(403, "MAIL_FORBIDDEN", "Kun D-GITA kan sende statusmails.");
  }
  const message = input.message.trim();
  if (!message || message.length > 8_000) {
    throw new OutboxError(422, "MAIL_INVALID", "Statusbeskeden er tom eller for lang.");
  }
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(input.idempotencyKey)) {
    throw new OutboxError(422, "MAIL_INVALID", "Afsendelsesnøglen er ugyldig.");
  }
  const DB = await preparePortalData();
  const actorUserId = await resolveActorUserId(DB, actor);
  const application = await DB.prepare(`
    SELECT a.id, a.case_number, a.system_name, a.owner_user_id,
           owner.email AS owner_email, owner.display_name AS owner_name
    FROM portal_applications a
    INNER JOIN portal_users owner ON owner.id = a.owner_user_id
    WHERE a.tenant_id = ? AND a.case_number = ?
    LIMIT 1
  `).bind(actor.tenantId, caseNumber).first<{
    id: string;
    case_number: string;
    system_name: string | null;
    owner_user_id: string;
    owner_email: string;
    owner_name: string;
  }>();
  if (!application) {
    throw new OutboxError(404, "CASE_NOT_FOUND", "Sagen findes ikke, eller du har ikke adgang.");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const subject = `D-GITA status på ${application.case_number}`;
  const textBody = `Hej ${application.owner_name}\n\n${message}\n\nSag: ${application.case_number}\nSystem: ${application.system_name || "Ikke navngivet"}`;
  const htmlBody = `<p>Hej ${escapeHtml(application.owner_name)}</p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p><p>Sag: <strong>${escapeHtml(application.case_number)}</strong><br>System: ${escapeHtml(application.system_name || "Ikke navngivet")}</p>`;

  const result = await DB.batch([
    DB.prepare(`
      INSERT INTO portal_mail_outbox
        (id, tenant_id, application_id, recipient_user_id, recipient_email,
         recipient_name, template_key, subject, text_body, html_body,
         attachments_json, idempotency_key, status, attempt_count,
         next_attempt_at, provider, provider_message_id, last_error,
         created_by_user_id, created_at, updated_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 'application.status', ?, ?, ?, '[]', ?,
              'queued', 0, ?, 'microsoft_graph', NULL, NULL, ?, ?, ?, NULL)
      ON CONFLICT(tenant_id, idempotency_key) DO NOTHING
    `).bind(
      id,
      actor.tenantId,
      application.id,
      application.owner_user_id,
      application.owner_email,
      application.owner_name,
      subject,
      textBody,
      htmlBody,
      input.idempotencyKey,
      now,
      actorUserId,
      now,
      now,
    ),
    DB.prepare(`
      INSERT INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'mail.queued', 'mail_outbox', ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_mail_outbox
        WHERE id = ? AND tenant_id = ?
      )
    `).bind(
      auditId,
      actor.tenantId,
      application.id,
      actorUserId,
      actor.subject,
      id,
      JSON.stringify({ caseNumber: application.case_number, templateKey: "application.status" }),
      now,
      id,
      actor.tenantId,
    ),
  ]);
  if (Number(result[0].meta.changes ?? 0) === 0) {
    const existing = await DB.prepare(`
      SELECT id, status FROM portal_mail_outbox
      WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1
    `).bind(actor.tenantId, input.idempotencyKey).first<{ id: string; status: OutboxStatus }>();
    return { id: existing?.id ?? id, status: existing?.status ?? "queued", duplicate: true };
  }
  return { id, status: "queued" as const, duplicate: false };
}

export async function processOutbox(actor: ServerActor, limit = 5) {
  requireAdmin(actor);
  const DB = await preparePortalData();
  const activeTenant = await DB.prepare("SELECT id FROM portal_tenants WHERE id = ? AND status = 'active'")
    .bind(actor.tenantId).first<{ id: string }>();
  if (!activeTenant) {
    throw new OutboxError(403, "TENANT_INACTIVE", "Kommunen er ikke aktiv. Ingen mails er sendt.");
  }
  const normalizedLimit = Math.min(10, Math.max(1, Math.trunc(limit)));
  const environment = await getGraphMailEnvironment();
  let transport;
  try {
    transport = createGraphMailTransport(environment);
  } catch {
    throw new OutboxError(
      503,
      "MAIL_NOT_CONFIGURED",
      "Microsoft Graph er ikke konfigureret. Ingen mails er sendt.",
    );
  }

  const now = new Date().toISOString();
  const abandonedBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await DB.prepare(`
    UPDATE portal_mail_outbox
    SET status = 'failed', next_attempt_at = NULL,
        last_error = 'MAIL_DELIVERY_STATE_UNKNOWN', updated_at = ?
    WHERE tenant_id = ? AND status = 'processing' AND updated_at < ?
  `).bind(now, actor.tenantId, abandonedBefore).run();

  const rows = await DB.prepare(`
    SELECT o.id, o.tenant_id, o.application_id, a.case_number,
           o.recipient_email, o.recipient_name, o.template_key,
           o.subject, o.text_body,
           o.html_body, o.attachments_json, o.idempotency_key,
           o.status, o.attempt_count
    FROM portal_mail_outbox o
    LEFT JOIN portal_applications a
      ON a.id = o.application_id AND a.tenant_id = o.tenant_id
    WHERE o.tenant_id = ?
      AND o.status = 'queued'
      AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
      AND o.attempt_count < 5
    ORDER BY o.created_at, o.id
    LIMIT ?
  `).bind(actor.tenantId, now, normalizedLimit).all<OutboxRow>();

  const results: Array<{
    id: string;
    status: "sent" | "queued" | "failed" | "cancelled";
  }> = [];
  for (const row of rows.results) {
    const claimed = await DB.prepare(`
      UPDATE portal_mail_outbox
      SET status = 'processing', attempt_count = attempt_count + 1,
          updated_at = ?, last_error = NULL
      WHERE id = ? AND tenant_id = ? AND status = 'queued' AND attempt_count = ?
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    `).bind(new Date().toISOString(), row.id, actor.tenantId, row.attempt_count, now).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;

    let accepted;
    try {
      const content = await materializeMailContent(DB, row);
      const attachments = await resolveAttachments(actor, row);
      accepted = await transport.send({
        subject: row.subject,
        body: { contentType: "HTML", content: content.html },
        to: [{ address: row.recipient_email, ...(row.recipient_name ? { name: row.recipient_name } : {}) }],
        attachments,
      }, { beforeSend: () => assertMailStillAuthorized(DB, row) });
    } catch (error) {
      if (error instanceof MailCancelledError) {
        const cancelledAt = new Date().toISOString();
        await DB.prepare(`
          UPDATE portal_mail_outbox
          SET status = 'cancelled', next_attempt_at = NULL,
              text_body = '[Mail annulleret]',
              html_body = '<p>Mail annulleret.</p>',
              attachments_json = '[]',
              last_error = 'MAIL_CANCELLED', updated_at = ?
          WHERE id = ? AND tenant_id = ? AND status = 'processing'
        `).bind(cancelledAt, row.id, actor.tenantId).run();
        results.push({ id: row.id, status: "cancelled" });
        continue;
      }
      const currentAttempt = row.attempt_count + 1;
      const retryable = isGraphMailError(error)
        ? error.retryable && (error.stage !== "send" || error.code === "GRAPH_SEND_ERROR")
        : !(error instanceof ReceiptError) &&
          !(error instanceof MailAttachmentReferenceError);
      const retry = retryable && currentAttempt < 5;
      const status = retry ? "queued" : "failed";
      const retryDelayMs = isGraphMailError(error) && error.retryAfterMs !== null
        ? error.retryAfterMs
        : Math.min(60, 2 ** currentAttempt) * 60_000;
      const retryAt = retry
        ? new Date(Date.now() + retryDelayMs).toISOString()
        : null;
      const safeError = isGraphMailError(error) ? error.code : "MAIL_PROCESSING_ERROR";
      await DB.prepare(`
        UPDATE portal_mail_outbox
        SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'processing'
      `).bind(status, retryAt, safeError, new Date().toISOString(), row.id, actor.tenantId).run();
      results.push({ id: row.id, status });
      continue;
    }

    const sentAt = accepted.acceptedAt;
    const auditId = crypto.randomUUID();
    await DB.batch([
      DB.prepare(`
        UPDATE portal_mail_outbox
        SET status = 'sent', provider_message_id = ?, last_error = NULL,
            text_body = CASE WHEN template_key = 'approval.requested'
              THEN '[Godkendelseslink fjernet efter afsendelse]' ELSE text_body END,
            html_body = CASE WHEN template_key = 'approval.requested'
              THEN '<p>Godkendelseslink fjernet efter afsendelse.</p>' ELSE html_body END,
            updated_at = ?, sent_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'processing'
      `).bind(accepted.requestId, sentAt, sentAt, row.id, actor.tenantId),
      DB.prepare(`
        INSERT INTO portal_audit_events
          (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
           entity_type, entity_id, payload_json, ip_hash, occurred_at)
        VALUES (?, ?, ?, ?, ?, 'mail.sent', 'mail_outbox', ?, ?, NULL, ?)
      `).bind(
        auditId,
        actor.tenantId,
        row.application_id,
        actor.userId,
        actor.subject,
        row.id,
        JSON.stringify({ recipient: row.recipient_email, requestId: accepted.requestId }),
        sentAt,
      ),
    ]);
    results.push({ id: row.id, status: "sent" });
  }
  return { processed: results.length, results };
}

/**
 * Cloudflare Cron entry point. Each tenant with queued mail is processed with
 * a stable admin identity for authorization/audit, while the audit subject
 * clearly identifies the scheduler instead of a human interaction.
 */
export async function processScheduledOutbox(limitPerTenant = 10) {
  try {
    readGraphMailConfig(await getGraphMailEnvironment());
  } catch {
    return { configured: false, tenants: 0, processed: 0 };
  }
  const DB = await preparePortalData();
  const tenants = await DB.prepare(`
    SELECT DISTINCT outbox.tenant_id
    FROM portal_mail_outbox outbox
    WHERE (outbox.status = 'queued'
      AND (outbox.next_attempt_at IS NULL OR outbox.next_attempt_at <= ?)
      AND outbox.attempt_count < 5)
      OR (outbox.status = 'processing' AND outbox.updated_at < ?)
    ORDER BY outbox.tenant_id
  `).bind(new Date().toISOString(), new Date(Date.now() - 15 * 60_000).toISOString()).all<{ tenant_id: string }>();
  let processed = 0;
  let processedTenants = 0;
  for (const tenant of tenants.results) {
    const identity = await DB.prepare(`
      SELECT user.id, user.external_subject, user.email, user.display_name,
             tenant.name AS municipality, user.identity_provider
      FROM portal_users user
      INNER JOIN portal_tenants tenant ON tenant.id = user.tenant_id
      INNER JOIN portal_user_roles role
        ON role.tenant_id = user.tenant_id AND role.user_id = user.id
      WHERE user.tenant_id = ? AND user.status = 'active' AND role.role = 'admin'
        AND tenant.status = 'active'
      ORDER BY user.created_at, user.id
      LIMIT 1
    `).bind(tenant.tenant_id).first<{
      id: string;
      external_subject: string;
      email: string;
      display_name: string;
      municipality: string;
      identity_provider: "dev" | "entra" | "fk";
    }>();
    if (!identity) continue;
    const result = await processOutbox({
      userId: identity.id,
      subject: `mail-scheduler:${identity.external_subject}`,
      tenantId: tenant.tenant_id,
      role: "admin",
      displayName: "D-GITA mailscheduler",
      email: identity.email,
      initials: "DS",
      municipality: identity.municipality,
      provider: identity.identity_provider,
    }, limitPerTenant);
    processed += result.processed;
    processedTenants += 1;
  }
  return { configured: true, tenants: processedTenants, processed };
}

async function materializeMailContent(DB: D1Database, row: OutboxRow) {
  await assertMailStillAuthorized(DB, row);
  if (row.template_key !== "approval.requested") {
    return { text: row.text_body, html: row.html_body };
  }
  const match = /^approval\.requested:([0-9a-f-]{36}):/iu.exec(row.idempotency_key);
  if (!match) throw new MailAttachmentReferenceError();
  if (
    !row.text_body.includes(APPROVAL_TOKEN_PLACEHOLDER) ||
    !row.html_body.includes(APPROVAL_TOKEN_PLACEHOLDER)
  ) {
    throw new MailAttachmentReferenceError();
  }
  const token = await approvalTokenForRequest(match[1]);
  return {
    text: row.text_body.replaceAll(APPROVAL_TOKEN_PLACEHOLDER, token),
    html: row.html_body.replaceAll(APPROVAL_TOKEN_PLACEHOLDER, token),
  };
}

async function assertMailStillAuthorized(DB: D1Database, row: OutboxRow) {
  const current = await DB.prepare(`
    SELECT mail.id FROM portal_mail_outbox mail
    INNER JOIN portal_tenants tenant ON tenant.id = mail.tenant_id AND tenant.status = 'active'
    WHERE mail.id = ? AND mail.tenant_id = ? AND mail.status = 'processing'
      AND mail.recipient_email = ?
    LIMIT 1
  `).bind(row.id, row.tenant_id, row.recipient_email).first<{ id: string }>();
  if (!current) throw new MailCancelledError();
  if (row.template_key !== "approval.requested") return;
  const match = /^approval\.requested:([0-9a-f-]{36}):/iu.exec(row.idempotency_key);
  if (!match) throw new MailAttachmentReferenceError();
  const authorized = await DB.prepare(`
    SELECT request.id FROM portal_approval_requests request
    INNER JOIN portal_applications application
      ON application.id = request.application_id AND application.tenant_id = request.tenant_id
    WHERE request.id = ? AND request.tenant_id = ? AND request.application_id = ?
      AND request.status = 'pending' AND request.expires_at > ?
      AND request.application_version_id = application.current_version_id
      AND LOWER(TRIM(request.approver_email)) = LOWER(TRIM(?))
      AND ${approvalMandateSql()}
    LIMIT 1
  `).bind(match[1], row.tenant_id, row.application_id, new Date().toISOString(), row.recipient_email)
    .first<{ id: string }>();
  if (!authorized) throw new MailCancelledError();
}

async function resolveAttachments(actor: ServerActor, row: OutboxRow) {
  const references = parseReceiptReferences(row.attachments_json);
  if (!references.length) return undefined;
  if (!row.case_number) throw new Error("Outbox-mail mangler sag.");
  const attachments: MailAttachment[] = [];
  for (const reference of references) {
    const receipt = await getOrCreateReceipt(
      actor,
      row.case_number,
      reference.receiptKind,
      reference.applicationVersionId,
    );
    attachments.push({
      name: receipt.filename,
      contentType: "application/pdf",
      contentBytes: bytesToBase64(receipt.bytes),
    });
  }
  return attachments;
}

function parseReceiptReferences(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new MailAttachmentReferenceError();
    if (!parsed.every((item): item is ReceiptReference =>
      typeof item === "object" && item !== null &&
      "receiptKind" in item && ["submission", "approval", "final"].includes(String(item.receiptKind)) &&
      "applicationVersionId" in item && typeof item.applicationVersionId === "string" &&
      item.applicationVersionId.length > 0 && item.applicationVersionId.length <= 200,
    )) {
      throw new MailAttachmentReferenceError();
    }
    return parsed;
  } catch {
    throw new MailAttachmentReferenceError();
  }
}

async function mailConfigurationStatus() {
  try {
    const config = readGraphMailConfig(await getGraphMailEnvironment());
    return { configured: true, sender: config.sender };
  } catch {
    return { configured: false, sender: null };
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function requireAdmin(actor: ServerActor) {
  if (actor.role !== "admin") {
    throw new OutboxError(403, "MAIL_FORBIDDEN", "Kun administratorer kan behandle mailkøen.");
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}
