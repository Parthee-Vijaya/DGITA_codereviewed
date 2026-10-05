import type { ServerActor } from "../auth/types";
import { assertMailStillAuthorized, MailCancelledError, MailAttachmentReferenceError } from "./claim-authorization";
import {
  APPROVAL_TOKEN_PLACEHOLDER,
  approvalTokenForRequest,
} from "../approval/token-service";
import { getOrCreateOutboxReceipt, ReceiptError } from "../receipt/server";
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
  return processTenantOutbox(actor, limit);
}

type MailPrincipal = { tenantId: string; subject: string; userId: string | null };

async function processTenantOutbox(actor: MailPrincipal, limit: number, deadline = Infinity) {
  const DB = await preparePortalData();
  const activeTenant = await DB.prepare("SELECT id FROM portal_tenants WHERE id = ? AND status = 'active'")
    .bind(actor.tenantId).first<{ id: string }>();
  if (!activeTenant) {
    throw new OutboxError(403, "TENANT_INACTIVE", "Kommunen er ikke aktiv. Ingen mails er sendt.");
  }
  const quarantined = await DB.prepare("SELECT 1 AS blocked FROM portal_bootstrap_state WHERE tenant_id = ? AND scope = 'recovery-quarantine'")
    .bind(actor.tenantId).first();
  if (quarantined) throw new OutboxError(403, "MAIL_RECOVERY_QUARANTINED", "Mail er spærret efter gendannelse og kræver operatørens frigivelse.");
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
  const abandoned = await DB.prepare(`
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
    if (Date.now() >= deadline) break;
    const claimed = await DB.prepare(`
      UPDATE portal_mail_outbox
      SET status = 'processing', attempt_count = attempt_count + 1,
          updated_at = ?, last_error = NULL
      WHERE id = ? AND tenant_id = ? AND status = 'queued' AND attempt_count = ?
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND NOT EXISTS (SELECT 1 FROM portal_bootstrap_state quarantine WHERE quarantine.tenant_id = portal_mail_outbox.tenant_id AND quarantine.scope = 'recovery-quarantine')
    `).bind(new Date().toISOString(), row.id, actor.tenantId, row.attempt_count, now).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;

    let accepted;
    try {
      const content = await materializeMailContent(DB, row);
      const attachments = await resolveAttachments(row);
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
          WHERE id = ? AND tenant_id = ? AND status = 'processing' AND attempt_count = ?
        `).bind(cancelledAt, row.id, actor.tenantId, row.attempt_count + 1).run();
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
        WHERE id = ? AND tenant_id = ? AND status = 'processing' AND attempt_count = ?
      `).bind(status, retryAt, safeError, new Date().toISOString(), row.id, actor.tenantId, row.attempt_count + 1).run();
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
        WHERE id = ? AND tenant_id = ? AND status = 'processing' AND attempt_count = ?
      `).bind(accepted.requestId, sentAt, sentAt, row.id, actor.tenantId, row.attempt_count + 1),
      DB.prepare(`
        INSERT INTO portal_audit_events
          (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
           entity_type, entity_id, payload_json, ip_hash, occurred_at)
        SELECT ?, ?, ?, ?, ?, 'mail.sent', 'mail_outbox', ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM portal_mail_outbox WHERE id = ? AND tenant_id = ? AND status = 'sent' AND attempt_count = ? AND provider_message_id = ?)
      `).bind(
        auditId,
        actor.tenantId,
        row.application_id,
        actor.userId,
        actor.subject,
        row.id,
        JSON.stringify({ recipient: row.recipient_email, requestId: accepted.requestId }),
        sentAt,
        row.id, actor.tenantId, row.attempt_count + 1, accepted.requestId,
      ),
    ]);
    results.push({ id: row.id, status: "sent" });
  }
  return { processed: results.length, results, abandoned: Number(abandoned.meta.changes ?? 0) };
}

/** Both hosts use a machine principal; no human administrator is impersonated. */
export async function processScheduledOutbox(limitPerTenant = 10) {
  try { readGraphMailConfig(await getGraphMailEnvironment()); }
  catch { return { configured: false, tenants: 0, processed: 0, failed: 0, queueAgeSeconds: 0 }; }
  const DB = await preparePortalData();
  const now = new Date().toISOString();
  const tenants = await DB.prepare(`
    SELECT outbox.tenant_id, MIN(outbox.created_at) AS oldest
    FROM portal_mail_outbox outbox
    INNER JOIN portal_tenants tenant ON tenant.id = outbox.tenant_id AND tenant.status = 'active'
    WHERE NOT EXISTS (SELECT 1 FROM portal_bootstrap_state quarantine WHERE quarantine.tenant_id = outbox.tenant_id AND quarantine.scope = 'recovery-quarantine')
      AND ((outbox.status = 'queued'
      AND (outbox.next_attempt_at IS NULL OR outbox.next_attempt_at <= ?)
      AND outbox.attempt_count < 5)
      OR (outbox.status = 'processing' AND outbox.updated_at < ?))
    GROUP BY outbox.tenant_id ORDER BY oldest, outbox.tenant_id LIMIT 50
  `).bind(now, new Date(Date.now() - 15 * 60_000).toISOString()).all<{ tenant_id: string; oldest: string }>();
  let processed = 0;
  let failed = 0;
  const queue = await DB.prepare(`SELECT MIN(mail.created_at) AS oldest FROM portal_mail_outbox mail
    JOIN portal_tenants tenant ON tenant.id = mail.tenant_id AND tenant.status = 'active'
    WHERE mail.status IN ('queued', 'processing')
      AND NOT EXISTS (SELECT 1 FROM portal_bootstrap_state quarantine WHERE quarantine.tenant_id = mail.tenant_id AND quarantine.scope = 'recovery-quarantine')`).first<{ oldest: string | null }>();
  const queuedAt = queue?.oldest;
  const age = queuedAt ? Math.floor((Date.now() - Date.parse(queuedAt.replace(" ", "T") + (queuedAt.includes("Z") ? "" : "Z"))) / 1000) : 0;
  const queueAgeSeconds = Number.isFinite(age) ? Math.min(365 * 86400, Math.max(0, age)) : 0;
  let processedTenants = 0;
  const deadline = Date.now() + 45_000;
  for (const tenant of tenants.results) {
    if (Date.now() >= deadline) break;
    processedTenants += 1;
    try {
      const result = await processTenantOutbox({ tenantId: tenant.tenant_id, userId: null, subject: "service:mail-scheduler" }, limitPerTenant, deadline);
      processed += result.processed;
      failed += result.abandoned + result.results.filter((item) => item.status === "failed").length;
    } catch { failed += 1; }
  }
  return { configured: true, tenants: processedTenants, processed, failed, queueAgeSeconds };
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


async function resolveAttachments(row: OutboxRow) {
  const references = parseReceiptReferences(row.attachments_json);
  if (!references.length) return undefined;
  if (!row.case_number) throw new Error("Outbox-mail mangler sag.");
  const attachments: MailAttachment[] = [];
  for (const reference of references) {
    const receipt = await getOrCreateOutboxReceipt(
      row,
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
