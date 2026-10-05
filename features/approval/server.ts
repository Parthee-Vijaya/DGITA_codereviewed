import { hashSessionToken } from "../auth/primitives";
import { approvalMandateSql, hasApprovalMandate } from "./mandate";
import { noCommittedLeaderDecisionSql } from "./decision-integrity";
import { assertAttachmentScanAllowed } from "../application/malware-scan";
import { getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";
import type { ApplicationFormState } from "../application/engine";
import { preparePortalData, resolveActorUserId } from "../workspace/server-repository";
import {
  APPROVAL_TOKEN_PLACEHOLDER,
  ApprovalTokenConfigurationError,
  approvalTokenForRequest,
} from "./token-service";

type ApprovalStatus =
  | "pending"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

type PublicApprovalStatus = Exclude<ApprovalStatus, "approving" | "rejecting">;

type ApprovalApplicationRow = {
  id: string;
  case_number: string;
  system_name: string | null;
  status: string;
  current_version_id: string | null;
  current_version_number: number;
  row_version: number;
  snapshot_json: string | null;
  owner_user_id: string;
  owner_name: string;
  owner_email: string;
};

type ApprovalRequestRow = {
  id: string;
  tenant_id: string;
  application_id: string;
  application_version_id: string;
  approver_email: string;
  approver_name: string;
  status: ApprovalStatus;
  decision_comment: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  case_number: string;
  system_name: string | null;
  current_version_id: string | null;
  version_number: number;
  snapshot_json: string;
  owner_user_id: string;
  owner_name: string;
  owner_email: string;
};

export type PublicApprovalRequest = {
  caseNumber: string;
  systemName: string;
  versionNumber: number;
  approverName: string;
  applicantName: string;
  status: PublicApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionComment: string | null;
  summary: {
    purpose: string;
    department: string;
    acquisitionMethod: string;
    totalCost: string;
    personalData: string;
    implementationPeriod: string;
  };
  details: Array<{
    title: string;
    rows: Array<{ label: string; value: string }>;
  }>;
  attachments: Array<{
    id: string;
    kind: string;
    name: string;
    size: number;
    contentType: string;
  }>;
};

export type PublicApprovalAttachment = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  checksum: string;
};

export type PublicApprovalAttachmentAccess = {
  filename: string;
  contentType: string;
  checksum: string;
  size: number;
  storageKey: string;
};

export class ApprovalWorkflowError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalWorkflowError";
  }
}

export async function createLeaderApprovalRequest(
  actor: ServerActor,
  caseNumber: string,
  applicationOrigin: string,
) {
  if (actor.role === "user") {
    throw new ApprovalWorkflowError(
      403,
      "APPROVAL_FORBIDDEN",
      "Kun D-GITA kan sende en sag til ledergodkendelse.",
    );
  }
  const origin = safeOrigin(applicationOrigin);
  const DB = await preparePortalData();
  const actorUserId = await resolveActorUserId(DB, actor);
  const application = await DB.prepare(`
    SELECT a.id, a.case_number, a.system_name, a.status,
           a.current_version_id, a.current_version_number, a.row_version,
           version.snapshot_json, a.owner_user_id,
           owner.display_name AS owner_name, owner.email AS owner_email
    FROM portal_applications a
    INNER JOIN portal_users owner ON owner.id = a.owner_user_id
    LEFT JOIN portal_application_versions version ON version.id = a.current_version_id
    WHERE a.tenant_id = ? AND a.case_number = ?
    LIMIT 1
  `).bind(actor.tenantId, caseNumber).first<ApprovalApplicationRow>();
  if (!application) {
    throw new ApprovalWorkflowError(404, "CASE_NOT_FOUND", "Sagen findes ikke.");
  }
  if (!application.current_version_id || !application.snapshot_json) {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_REQUIRES_VERSION",
      "Ansøgningen skal indsendes og versionslåses først.",
    );
  }
  if (["approved", "rejected", "closed"].includes(application.status)) {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_CASE_CLOSED",
      "Sagen er afsluttet og kan ikke sendes til en ny ledergodkendelse.",
    );
  }
  if (application.status === "changes_requested") {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_CHANGES_REQUIRED",
      "Ansøgeren skal rette og genindsende en ny version, før sagen kan sendes til ledergodkendelse igen.",
    );
  }
  const undecided = await DB.prepare(`SELECT id FROM portal_applications
    WHERE id = ? AND tenant_id = ? AND current_version_id = ? AND ${noCommittedLeaderDecisionSql()}`)
    .bind(application.id, actor.tenantId, application.current_version_id).first<{ id: string }>();
  if (!undecided) throw new ApprovalWorkflowError(409, "APPROVAL_VERSION_ALREADY_DECIDED",
    "Denne version har allerede en gemt lederbeslutning. En ny lederbeslutning kræver en ny sagsversion.");
  const snapshot = parseSnapshot(application.snapshot_json);
  const selectedApproverId = snapshot.approvingLeaderId;
  if (!selectedApproverId) {
    throw new ApprovalWorkflowError(422, "APPROVER_MISSING", "Der er ikke valgt en godkendende leder.");
  }
  if (selectedApproverId === application.owner_user_id) {
    throw new ApprovalWorkflowError(
      422,
      "SELF_APPROVAL_FORBIDDEN",
      "Ansøgeren kan ikke godkende sin egen ansøgning. Vælg en anden godkendende leder.",
    );
  }
  const approver = await DB.prepare(`
    SELECT id, email, display_name
    FROM portal_users user
    WHERE user.tenant_id = ? AND user.id = ? AND user.status = 'active'
      AND EXISTS (
        SELECT 1 FROM portal_user_roles role
        WHERE role.tenant_id = user.tenant_id AND role.user_id = user.id
          AND role.role = 'approver'
      )
    LIMIT 1
  `).bind(actor.tenantId, selectedApproverId).first<{ id: string; email: string; display_name: string }>();
  if (!approver) {
    throw new ApprovalWorkflowError(
      422,
      "APPROVER_NOT_FOUND",
      "Den valgte leder har ikke en aktiv godkenderrettighed i kommunen.",
    );
  }
  if (approver.email.trim().toLowerCase() === application.owner_email.trim().toLowerCase()) {
    throw new ApprovalWorkflowError(
      422,
      "SELF_APPROVAL_FORBIDDEN",
      "Ansøger og godkendende leder skal have forskellige personlige mailadresser.",
    );
  }

  const requestId = crypto.randomUUID();
  let token: string;
  try {
    token = await approvalTokenForRequest(requestId, origin);
  } catch (error) {
    if (error instanceof ApprovalTokenConfigurationError) {
      throw new ApprovalWorkflowError(
        503,
        "APPROVAL_TOKEN_NOT_CONFIGURED",
        "Godkendelseslinks er ikke konfigureret i servermiljøet.",
      );
    }
    throw error;
  }
  const tokenHash = await hashSessionToken(token);
  const auditId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const approvalUrl = `${origin}/approve/${APPROVAL_TOKEN_PLACEHOLDER}`;
  const subject = `Godkend D-GITA-sag ${application.case_number}`;
  const text = `Hej ${approver.display_name}\n\n${application.owner_name} har indsendt en ansøgning om ${application.system_name || "et IT-system"}. Åbn beslutningsgrundlaget og godkend eller afvis senest ${formatDate(expiresAt)}:\n${approvalUrl}`;
  const html = `<p>Hej ${escapeHtml(approver.display_name)}</p><p>${escapeHtml(application.owner_name)} har indsendt en ansøgning om <strong>${escapeHtml(application.system_name || "et IT-system")}</strong>.</p><p><a href="${escapeHtml(approvalUrl)}">Åbn beslutningsgrundlaget og godkend eller afvis</a></p><p>Linket udløber ${escapeHtml(formatDate(expiresAt))} og kan kun bruges én gang.</p>`;

  const created = await DB.batch([
    DB.prepare(`
      UPDATE portal_approval_requests
      SET status = 'cancelled'
      WHERE tenant_id = ? AND application_id = ?
        AND status IN ('pending', 'approving', 'rejecting')
        AND EXISTS (
          SELECT 1 FROM portal_applications
          WHERE id = ? AND tenant_id = ? AND current_version_id = ?
            AND status = ? AND row_version = ?
            AND ${noCommittedLeaderDecisionSql()}
        )
    `).bind(
      actor.tenantId,
      application.id,
      application.id,
      actor.tenantId,
      application.current_version_id,
      application.status,
      application.row_version,
    ),
    DB.prepare(`
      UPDATE portal_mail_outbox
      SET status = CASE WHEN status IN ('queued', 'failed') THEN 'cancelled' ELSE status END,
          text_body = '[Godkendelseslink erstattet af et nyere link]',
          html_body = '<p>Godkendelseslink erstattet af et nyere link.</p>',
          updated_at = ?
      WHERE tenant_id = ? AND application_id = ?
        AND template_key = 'approval.requested' AND status <> 'sent'
        AND EXISTS (
          SELECT 1 FROM portal_applications
          WHERE id = ? AND tenant_id = ? AND current_version_id = ?
            AND status = ? AND row_version = ?
            AND ${noCommittedLeaderDecisionSql()}
        )
    `).bind(
      now,
      actor.tenantId,
      application.id,
      application.id,
      actor.tenantId,
      application.current_version_id,
      application.status,
      application.row_version,
    ),
    DB.prepare(`
      INSERT INTO portal_approval_requests
        (id, tenant_id, application_id, application_version_id, approver_email,
         approver_name, token_hash, status, decision_comment,
         created_by_user_id, created_at, expires_at, decided_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_applications
        WHERE id = ? AND tenant_id = ? AND current_version_id = ?
          AND status = ? AND row_version = ?
            AND ${noCommittedLeaderDecisionSql()}
      )
    `).bind(
      requestId,
      actor.tenantId,
      application.id,
      application.current_version_id,
      approver.email,
      approver.display_name,
      tokenHash,
      actorUserId,
      now,
      expiresAt,
      application.id,
      actor.tenantId,
      application.current_version_id,
      application.status,
      application.row_version,
    ),
    DB.prepare(`
      UPDATE portal_applications
      SET status = 'awaiting_leader', updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND current_version_id = ?
        AND status = ? AND row_version = ?
            AND ${noCommittedLeaderDecisionSql()}
        AND EXISTS (
          SELECT 1 FROM portal_approval_requests
          WHERE id = ? AND tenant_id = ? AND application_id = ?
            AND application_version_id = ? AND status = 'pending'
        )
    `).bind(
      now,
      application.id,
      actor.tenantId,
      application.current_version_id,
      application.status,
      application.row_version,
      requestId,
      actor.tenantId,
      application.id,
      application.current_version_id,
    ),
    DB.prepare(`
      INSERT INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'approval.requested', 'approval_request', ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_applications application
        INNER JOIN portal_approval_requests request
          ON request.id = ? AND request.application_id = application.id
          AND request.tenant_id = application.tenant_id
        WHERE application.id = ? AND application.tenant_id = ?
          AND application.current_version_id = ?
          AND application.status = 'awaiting_leader'
          AND application.row_version = ?
      )
    `).bind(
      auditId,
      actor.tenantId,
      application.id,
      actorUserId,
      actor.subject,
      requestId,
      JSON.stringify({ approverName: approver.display_name, versionNumber: application.current_version_number }),
      now,
      requestId,
      application.id,
      actor.tenantId,
      application.current_version_id,
      application.row_version + 1,
    ),
    DB.prepare(`
      INSERT INTO portal_notifications
        (id, tenant_id, recipient_user_id, application_id, source_event_id,
         event_type, title, body, link_path, status, created_at, read_at)
      SELECT ?, ?, ?, ?, ?, 'approval.requested', ?, ?, ?, 'unread', ?, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_audit_events WHERE id = ? AND tenant_id = ?
      )
    `).bind(
      notificationId,
      actor.tenantId,
      application.owner_user_id,
      application.id,
      auditId,
      `${application.case_number} er sendt til godkendelse`,
      `${approver.display_name} er bedt om at tage stilling til version ${application.current_version_number}.`,
      `/?case=${encodeURIComponent(application.case_number)}`,
      now,
      auditId,
      actor.tenantId,
    ),
    DB.prepare(`
      INSERT INTO portal_mail_outbox
        (id, tenant_id, application_id, recipient_user_id, recipient_email,
         recipient_name, template_key, subject, text_body, html_body,
         attachments_json, idempotency_key, status, attempt_count,
         next_attempt_at, provider, provider_message_id, last_error,
         created_by_user_id, created_at, updated_at, sent_at)
      SELECT ?, ?, ?, ?, ?, ?, 'approval.requested', ?, ?, ?, ?, ?,
             'queued', 0, ?, 'microsoft_graph', NULL, NULL, ?, ?, ?, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_audit_events WHERE id = ? AND tenant_id = ?
      )
    `).bind(
      outboxId,
      actor.tenantId,
      application.id,
      approver.id,
      approver.email,
      approver.display_name,
      subject,
      text,
      html,
      JSON.stringify([{ receiptKind: "submission", applicationVersionId: application.current_version_id }]),
      `approval.requested:${requestId}:${approver.email.toLowerCase()}`,
      now,
      actorUserId,
      now,
      now,
      auditId,
      actor.tenantId,
    ),
  ]);
  if (Number(created[3]?.meta.changes ?? 0) !== 1) {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_VERSION_STALE",
      "Sagen blev ændret, før godkendelseslinket kunne oprettes. Hent sagen igen.",
    );
  }
  return {
    id: requestId,
    caseNumber: application.case_number,
    approverName: approver.display_name,
    approverEmail: approver.email,
    status: "pending" as const,
    expiresAt,
  };
}

export async function getPublicApprovalRequest(token: string): Promise<PublicApprovalRequest> {
  const tokenHash = await validTokenHash(token);
  const DB = await preparePortalData();
  const row = await approvalRequestByHash(DB, tokenHash);
  if (!row) throw invalidLink();
  const now = new Date();
  if (row.status === "pending" && new Date(row.expires_at) <= now) {
    const expired = await DB.batch([
      DB.prepare(`
        UPDATE portal_approval_requests SET status = 'expired'
        WHERE id = ? AND status = 'pending'
      `).bind(row.id),
      scrubApprovalRequestMail(DB, row, "Godkendelseslinket er udløbet", true),
    ]);
    if (Number(expired[0].meta.changes ?? 0) === 1) {
      row.status = "expired";
    } else {
      const current = await approvalRequestByHash(DB, tokenHash);
      if (!current) throw invalidLink();
      return toPublicRequest(current);
    }
  }
  return toPublicRequest(row);
}

export async function getPublicApprovalAttachment(
  token: string,
  attachmentId: string,
): Promise<PublicApprovalAttachment> {
  const attachment = await authorizePublicApprovalAttachment(token, attachmentId);
  const { FILES } = await getPersistenceBindings();
  const object = await FILES.get(attachment.storageKey);
  if (!object) throw invalidLink();
  const bytes = new Uint8Array(await object.arrayBuffer());
  const checksum = await sha256Bytes(bytes);
  if (bytes.byteLength !== attachment.size || checksum !== attachment.checksum) {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_ATTACHMENT_INTEGRITY",
      "Bilaget kunne ikke integritetskontrolleres.",
    );
  }
  return {
    bytes,
    filename: attachment.filename,
    contentType: attachment.contentType,
    checksum,
  };
}

export async function authorizePublicApprovalAttachment(
  token: string,
  attachmentId: string,
): Promise<PublicApprovalAttachmentAccess> {
  if (!/^[0-9a-f-]{36}$/iu.test(attachmentId)) throw invalidLink();
  const tokenHash = await validTokenHash(token);
  const DB = await preparePortalData();
  const request = await approvalRequestByHash(DB, tokenHash);
  if (!request || request.status === "cancelled") throw invalidLink();
  if (request.status === "expired" || new Date(request.expires_at) <= new Date()) {
    throw new ApprovalWorkflowError(410, "APPROVAL_EXPIRED", "Godkendelseslinket er udløbet.");
  }
  if (request.status !== "pending") throw new ApprovalWorkflowError(410, "APPROVAL_LINK_USED", "Beslutningen er allerede registreret. Bilag kan herefter åbnes i portalen.");
  const attachment = await DB.prepare(`
    SELECT original_name, content_type, storage_key, checksum_sha256, size_bytes, scan_status
    FROM portal_attachments
    WHERE id = ? AND tenant_id = ? AND application_id = ?
      AND application_version_id = ? AND status = 'ready'
    LIMIT 1
  `).bind(
    attachmentId,
    request.tenant_id,
    request.application_id,
    request.application_version_id,
  ).first<{
    original_name: string;
    content_type: string;
    storage_key: string;
    checksum_sha256: string;
    size_bytes: number;
    scan_status: string;
  }>();
  if (!attachment) throw invalidLink();
  await assertAttachmentScanAllowed(attachment.scan_status);
  return {
    filename: attachment.original_name,
    contentType: attachment.content_type,
    checksum: attachment.checksum_sha256,
    size: attachment.size_bytes,
    storageKey: attachment.storage_key,
  };
}

export async function decideLeaderApproval(
  token: string,
  input: { decision: "approved" | "rejected"; comment: string },
) {
  const tokenHash = await validTokenHash(token);
  const comment = input.comment.trim();
  if (comment.length > 4_000) {
    throw new ApprovalWorkflowError(422, "COMMENT_TOO_LONG", "Bemærkningen er for lang.");
  }
  if (!input.decision || !["approved", "rejected"].includes(input.decision)) {
    throw new ApprovalWorkflowError(422, "DECISION_INVALID", "Vælg godkend eller afvis.");
  }
  if (input.decision === "rejected" && comment.length < 3) {
    throw new ApprovalWorkflowError(
      422,
      "REJECTION_COMMENT_REQUIRED",
      "Skriv en kort begrundelse, når ansøgningen afvises.",
    );
  }
  const DB = await preparePortalData();
  let row = await approvalRequestByHash(DB, tokenHash);
  if (!row) throw invalidLink();
  const transitionStatus = input.decision === "approved" ? "approving" : "rejecting";
  if (
    row.status !== "pending" &&
    row.status !== transitionStatus
  ) {
    throw new ApprovalWorkflowError(409, "APPROVAL_ALREADY_DECIDED", "Godkendelseslinket er allerede brugt.");
  }
  if (row.current_version_id !== row.application_version_id) {
    await DB.batch([
      DB.prepare(`
        UPDATE portal_approval_requests SET status = 'cancelled'
        WHERE id = ? AND status IN ('pending', 'approving', 'rejecting')
      `).bind(row.id),
      scrubApprovalRequestMail(DB, row, "Godkendelseslinket er erstattet af en nyere version", true),
    ]);
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_VERSION_STALE",
      "Sagen har fået en nyere version. Bed D-GITA om et nyt godkendelseslink.",
    );
  }
  if (row.status === "pending" && new Date(row.expires_at) <= new Date()) {
    await DB.batch([
      DB.prepare("UPDATE portal_approval_requests SET status = 'expired' WHERE id = ? AND status = 'pending'")
        .bind(row.id),
      scrubApprovalRequestMail(DB, row, "Godkendelseslinket er udløbet", true),
    ]);
    throw new ApprovalWorkflowError(410, "APPROVAL_EXPIRED", "Godkendelseslinket er udløbet.");
  }

  let decisionStartedAt = row.decided_at;
  let effectiveComment = row.decision_comment ?? "";
  if (row.status === "pending") {
    decisionStartedAt = new Date().toISOString();
    effectiveComment = comment;
    const claimed = await DB.prepare(`
      UPDATE portal_approval_requests
      SET status = ?, decision_comment = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'
        AND ${approvalMandateSql("portal_approval_requests")}
    `).bind(
      transitionStatus,
      effectiveComment || null,
      decisionStartedAt,
      row.id,
    ).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) {
      const current = await approvalRequestByHash(DB, tokenHash);
      if (!current || current.status !== transitionStatus) {
        throw new ApprovalWorkflowError(
          409,
          "APPROVAL_ALREADY_DECIDED",
          "Godkendelseslinket er allerede brugt.",
        );
      }
      row = current;
      decisionStartedAt = current.decided_at;
      effectiveComment = current.decision_comment ?? "";
    }
  }
  if (!decisionStartedAt) {
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_STATE_INVALID",
      "Godkendelsen kunne ikke færdiggøres. Bed D-GITA om et nyt link.",
    );
  }

  const auditId = `approval-decision:${row.id}`;
  const notificationId = `approval-notification:${row.id}`;
  const outboxId = `approval-mail:${row.id}`;
  const approved = input.decision === "approved";
  const nextStatus = approved ? "under_review" : "changes_requested";
  const nextPhase = approved ? "Under behandling" : "Indsendt";
  const subject = approved
    ? `${row.case_number} er godkendt af ${row.approver_name}`
    : `${row.case_number} er afvist af ${row.approver_name}`;
  const decisionText = approved ? "godkendt" : "afvist";
  const text = `Hej ${row.owner_name}\n\n${row.approver_name} har ${decisionText} version ${row.version_number} af ${row.case_number}.${effectiveComment ? `\n\nBemærkning: ${effectiveComment}` : ""}`;
  const html = `<p>Hej ${escapeHtml(row.owner_name)}</p><p>${escapeHtml(row.approver_name)} har <strong>${decisionText}</strong> version ${row.version_number} af ${escapeHtml(row.case_number)}.</p>${effectiveComment ? `<p>Bemærkning: ${escapeHtml(effectiveComment)}</p>` : ""}`;
  const completed = await DB.batch([
    DB.prepare(`
      UPDATE portal_applications
      SET status = ?, phase = ?, updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND current_version_id = ?
        AND EXISTS (
          SELECT 1 FROM portal_approval_requests request
          WHERE request.id = ? AND request.status = ?
            AND ${approvalMandateSql()}
        )
    `).bind(
      nextStatus,
      nextPhase,
      decisionStartedAt,
      row.application_id,
      row.tenant_id,
      row.application_version_id,
      row.id,
      transitionStatus,
    ),
    DB.prepare(`
      INSERT OR IGNORE INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, NULL, ?, ?, 'approval_request', ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_applications application
        WHERE application.id = ? AND application.tenant_id = ?
          AND application.current_version_id = ? AND application.status = ?
          AND application.updated_at = ?
      )
      AND EXISTS (
        SELECT 1 FROM portal_approval_requests request
        WHERE request.id = ? AND request.status = ? AND ${approvalMandateSql()}
      )
    `).bind(
      auditId,
      row.tenant_id,
      row.application_id,
      "external-approver",
      approved ? "approval.approved" : "approval.rejected",
      row.id,
      JSON.stringify({ approverName: row.approver_name, versionNumber: row.version_number }),
      decisionStartedAt,
      row.application_id,
      row.tenant_id,
      row.application_version_id,
      nextStatus,
      decisionStartedAt,
      row.id,
      transitionStatus,
    ),
    DB.prepare(`
      INSERT OR IGNORE INTO portal_notifications
        (id, tenant_id, recipient_user_id, application_id, source_event_id,
         event_type, title, body, link_path, status, created_at, read_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_audit_events event
        WHERE event.id = ? AND event.tenant_id = ?
      )
    `).bind(
      notificationId,
      row.tenant_id,
      row.owner_user_id,
      row.application_id,
      auditId,
      approved ? "approval.approved" : "approval.rejected",
      subject,
      effectiveComment || `Version ${row.version_number} er ${decisionText}.`,
      `/?case=${encodeURIComponent(row.case_number)}`,
      decisionStartedAt,
      auditId,
      row.tenant_id,
    ),
    DB.prepare(`
      INSERT OR IGNORE INTO portal_mail_outbox
        (id, tenant_id, application_id, recipient_user_id, recipient_email,
         recipient_name, template_key, subject, text_body, html_body,
         attachments_json, idempotency_key, status, attempt_count,
         next_attempt_at, provider, provider_message_id, last_error,
         created_by_user_id, created_at, updated_at, sent_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?,
             'microsoft_graph', NULL, NULL, NULL, ?, ?, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_audit_events event
        WHERE event.id = ? AND event.tenant_id = ?
      )
    `).bind(
      outboxId,
      row.tenant_id,
      row.application_id,
      row.owner_user_id,
      row.owner_email,
      row.owner_name,
      approved ? "approval.approved" : "approval.rejected",
      subject,
      text,
      html,
      JSON.stringify(approved ? [{ receiptKind: "approval", applicationVersionId: row.application_version_id }] : []),
      `approval.decided:${row.id}:${input.decision}:${row.owner_email.toLowerCase()}`,
      decisionStartedAt,
      decisionStartedAt,
      decisionStartedAt,
      auditId,
      row.tenant_id,
    ),
    scrubApprovalRequestMail(DB, row, "Godkendelseslinket er brugt", true),
    DB.prepare(`
      UPDATE portal_approval_requests
      SET status = ?
      WHERE id = ? AND status = ? AND decided_at = ?
        AND ${approvalMandateSql("portal_approval_requests")}
        AND EXISTS (
          SELECT 1 FROM portal_applications application
          WHERE application.id = ? AND application.tenant_id = ?
            AND application.current_version_id = ? AND application.status = ?
            AND application.updated_at = ?
        )
    `).bind(
      input.decision,
      row.id,
      transitionStatus,
      decisionStartedAt,
      row.application_id,
      row.tenant_id,
      row.application_version_id,
      nextStatus,
      decisionStartedAt,
    ),
  ]);
  if (Number(completed.at(-1)?.meta.changes ?? 0) !== 1) {
    await DB.batch([
      DB.prepare(`
        UPDATE portal_approval_requests
        SET status = 'cancelled'
        WHERE id = ? AND status = ?
      `).bind(row.id, transitionStatus),
      scrubApprovalRequestMail(
        DB,
        row,
        "Godkendelseslinket er erstattet af en nyere version",
        true,
      ),
    ]);
    throw new ApprovalWorkflowError(
      409,
      "APPROVAL_VERSION_STALE",
      "Sagen har ændret sig. Beslutningen blev ikke gemt.",
    );
  }
  return {
    ...toPublicRequest({
      ...row,
      status: input.decision,
      decision_comment: effectiveComment || null,
      decided_at: decisionStartedAt,
    }),
    decision: input.decision,
  };
}

async function approvalRequestByHash(DB: D1Database, tokenHash: string) {
  const row = await DB.prepare(`
    SELECT request.id, request.tenant_id, request.application_id,
           request.application_version_id, request.approver_email,
           request.approver_name, request.status, request.decision_comment,
           request.created_at, request.expires_at, request.decided_at,
           application.case_number, application.system_name,
           application.current_version_id, version.version_number,
           version.snapshot_json,
           application.owner_user_id, owner.display_name AS owner_name,
           owner.email AS owner_email
    FROM portal_approval_requests request
    INNER JOIN portal_tenants tenant
      ON tenant.id = request.tenant_id AND tenant.status = 'active'
    INNER JOIN portal_applications application
      ON application.id = request.application_id AND application.tenant_id = request.tenant_id
    INNER JOIN portal_application_versions version
      ON version.id = request.application_version_id
      AND version.application_id = request.application_id
      AND version.tenant_id = request.tenant_id
    INNER JOIN portal_users owner
      ON owner.id = application.owner_user_id AND owner.tenant_id = request.tenant_id
    WHERE request.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<ApprovalRequestRow>();
  if (!row) return null;

  return await hasApprovalMandate(DB, row.id) ? row : null;
}

function toPublicRequest(row: ApprovalRequestRow): PublicApprovalRequest {
  if (row.status === "cancelled" || row.status === "expired" ||
      new Date(row.expires_at) <= new Date()) {
    throw new ApprovalWorkflowError(410, "APPROVAL_LINK_CLOSED", "Godkendelseslinket er udløbet eller annulleret. Bed D-GITA om et nyt link.");
  }
  const state = parseSnapshot(row.snapshot_json);
  const open = ["pending", "approving", "rejecting"].includes(row.status);
  return {
    caseNumber: row.case_number,
    systemName: row.system_name || state.selectedSystem?.name || state.manualSystemName || "Ikke navngivet",
    versionNumber: row.version_number,
    approverName: row.approver_name,
    applicantName: row.owner_name,
    status: row.status === "approving" || row.status === "rejecting"
      ? "pending"
      : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    summary: open ? {
      purpose: state.purpose || "Ikke oplyst",
      department: state.department || "Ikke oplyst",
      acquisitionMethod: state.acquisitionMethod || "Ikke oplyst",
      totalCost: totalCost(state),
      personalData: state.personalData === "ja" ? "Ja" : "Nej",
      implementationPeriod: [state.startDate, state.endDate].filter(Boolean).join(" - ") || "Ikke oplyst",
    } : { purpose: "", department: "", acquisitionMethod: "", totalCost: "", personalData: "", implementationPeriod: "" },
    details: open ? approvalDetails(state) : [],
    attachments: !open ? [] : Object.entries(state.attachments).flatMap(([kind, attachments]) =>
      attachments
        .filter((attachment) => attachment.status === "uploaded")
        .map((attachment) => ({
          id: attachment.id,
          kind,
          name: attachment.name,
          size: attachment.size,
          contentType: attachment.type,
        })),
    ),
  };
}

function approvalDetails(state: ApplicationFormState) {
  const rows = (
    title: string,
    values: Array<[string, string | string[] | null | undefined]>,
  ) => ({
    title,
    rows: values.map(([label, value]) => ({ label, value: displayValue(value) })),
  });
  return [
    rows("System og ansvar", [
      ["System", state.selectedSystem?.name || state.manualSystemName],
      ["Forretningsområde", state.businessType],
      ["Systembeskrivelse", state.systemDescription],
      ["Leverandør", state.supplier],
      ["Rettighedshaver", state.rightsHolder],
      ["Kontaktperson", state.contactPerson],
      ["Afdeling", state.department],
      ["Dataejer", state.dataOwner],
      ["Systemejer", state.systemOwner],
      ["Kontraktejer", state.contractOwner],
      ["Ansvarlig organisation", state.responsibleOrganization],
    ]),
    rows("Anskaffelse og behov", [
      ["Anskaffelsesform", state.acquisitionMethod],
      ["Markedsafdækning", state.marketResearch],
      ["Undersøgte systemer", state.marketResearchSystems],
      ["Type", state.acquisitionType],
      ["Formål", state.purpose],
      ["Funktion", state.functionDescription],
      ["KLE-emner", state.kleTopics],
      ["Eksisterende proces-systemer", state.existingProcessSystems],
      ["Tværgående funktionalitet", state.crossFunctionality],
      ["Berørte enheder", state.crossDepartments],
    ]),
    rows("Økonomi og gevinst", [
      ["Budget", state.hasBudget],
      ["Budgetbeløb", state.budgetAmount],
      ["Engangsomkostning", state.oneTimeCost],
      ["Årlig omkostning", state.yearlyCost],
      ["Øvrige omkostninger", state.otherCost],
      ["Forventede gevinster", state.benefits],
    ]),
    rows("Risiko og data", [
      ["Risikovurdering", state.hasRiskAssessment],
      ["Behov for hjælp", state.needsRiskHelp],
      ["Personoplysninger", state.personalData],
      ["Databehandleraftale", state.hasDpa],
      ["Dataklassifikation", state.dataClassification],
      ["Medarbejderadgang", state.employeeAccess],
    ]),
    rows("Implementering og IT-krav", [
      ["Milepæle", state.milestones],
      ["Ressourcer", state.implementationResources],
      ["Periode", [state.startDate, state.endDate].filter(Boolean).join(" – ")],
      ["Antal brugere", state.implementationUsers],
      ["Arkitekturtegning", state.hasArchitecture],
      ["Tjekliste journaliseret", state.checklistJournalized],
      ["Bemærkninger", state.remarks],
    ]),
  ];
}

function displayValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Ikke oplyst";
  const normalized = value?.trim();
  if (!normalized) return "Ikke oplyst";
  if (normalized === "ja") return "Ja";
  if (normalized === "nej") return "Nej";
  return normalized;
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function scrubApprovalRequestMail(
  DB: D1Database,
  row: Pick<ApprovalRequestRow, "id" | "tenant_id" | "application_id" | "approver_email">,
  reason: string,
  cancelPending: boolean,
) {
  return DB.prepare(`
    UPDATE portal_mail_outbox
    SET status = CASE
          WHEN ? = 1 AND status IN ('queued', 'failed') THEN 'cancelled'
          ELSE status
        END,
        text_body = ?, html_body = ?, updated_at = ?
    WHERE tenant_id = ? AND application_id = ?
      AND template_key = 'approval.requested' AND idempotency_key = ?
  `).bind(
    cancelPending ? 1 : 0,
    `[${reason}]`,
    `<p>${escapeHtml(reason)}.</p>`,
    new Date().toISOString(),
    row.tenant_id,
    row.application_id,
    approvalRequestIdempotencyKey(row.id, row.approver_email),
  );
}

function approvalRequestIdempotencyKey(requestId: string, approverEmail: string) {
  return `approval.requested:${requestId}:${approverEmail.toLowerCase()}`;
}

function parseSnapshot(value: string) {
  try {
    const state = JSON.parse(value) as ApplicationFormState;
    if (state.schemaVersion !== "dgita-v1") throw new Error("schema");
    return state;
  } catch {
    throw new ApprovalWorkflowError(422, "SNAPSHOT_INVALID", "Den indsendte version kan ikke læses.");
  }
}

async function validTokenHash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidLink();
  return hashSessionToken(token);
}

function invalidLink() {
  return new ApprovalWorkflowError(404, "APPROVAL_LINK_INVALID", "Godkendelseslinket er ugyldigt.");
}

function safeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("origin");
    return url.origin;
  } catch {
    throw new ApprovalWorkflowError(400, "APPROVAL_ORIGIN_INVALID", "Portaladressen er ugyldig.");
  }
}

function totalCost(state: ApplicationFormState) {
  const values = [state.oneTimeCost, state.yearlyCost, state.otherCost].map(parseDanishNumber);
  return `${values.reduce((sum, value) => sum + value, 0).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;
}

function parseDanishNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
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
