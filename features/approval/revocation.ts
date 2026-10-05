import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";
import { ApprovalWorkflowError } from "./server";

export async function revokeLeaderApprovalRequest(actor: ServerActor, caseNumber: string, requestId: string) {
  if (actor.role !== "admin" && actor.role !== "consultant") {
    throw new ApprovalWorkflowError(403, "APPROVAL_FORBIDDEN", "Kun D-GITA kan tilbagekalde et godkendelseslink.");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(requestId)) {
    throw new ApprovalWorkflowError(400, "APPROVAL_ID_INVALID", "Ugyldigt godkendelseslink.");
  }
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const row = await DB.prepare(`SELECT request.id, request.status, request.application_id, request.application_version_id
    FROM portal_approval_requests request JOIN portal_applications application
      ON application.id = request.application_id AND application.tenant_id = request.tenant_id
    WHERE request.id = ? AND request.tenant_id = ? AND application.case_number = ?`)
    .bind(requestId, actor.tenantId, caseNumber).first<{
      id: string; status: string; application_id: string; application_version_id: string;
    }>();
  if (!row) throw new ApprovalWorkflowError(404, "APPROVAL_NOT_FOUND", "Godkendelseslinket findes ikke i sagen.");
  if (row.status === "cancelled") return { status: "cancelled", changed: false };
  if (!["pending", "approving", "rejecting"].includes(row.status)) throw alreadyDecided();
  const now = new Date().toISOString();
  const auditId = `approval-revoked:${requestId}`;
  const [, cancelled] = await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO portal_audit_events
      (id, tenant_id, application_id, actor_user_id, actor_subject, event_type, entity_type, entity_id, payload_json, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'approval.revoked', 'approval_request', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM portal_approval_requests WHERE id = ? AND tenant_id = ?
        AND status IN ('pending', 'approving', 'rejecting'))
      AND NOT EXISTS (SELECT 1 FROM portal_audit_events WHERE id = ?)`)
      .bind(auditId, actor.tenantId, row.application_id, actor.userId, actor.subject, requestId,
        JSON.stringify({ applicationVersionId: row.application_version_id }), now,
        requestId, actor.tenantId, `approval-decision:${requestId}`),
    DB.prepare(`UPDATE portal_approval_requests SET status = 'cancelled'
      WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'approving', 'rejecting')
        AND EXISTS (SELECT 1 FROM portal_audit_events WHERE id = ? AND tenant_id = ?)`)
      .bind(requestId, actor.tenantId, auditId, actor.tenantId),
    DB.prepare(`UPDATE portal_mail_outbox
      SET status = CASE WHEN status IN ('queued','failed') THEN 'cancelled' ELSE status END,
        text_body = '[Godkendelseslink tilbagekaldt]', html_body = '<p>Godkendelseslinket er tilbagekaldt.</p>', updated_at = ?
      WHERE tenant_id = ? AND application_id = ? AND template_key = 'approval.requested' AND status <> 'sent'
        AND idempotency_key LIKE ?
        AND EXISTS (SELECT 1 FROM portal_audit_events WHERE id = ? AND tenant_id = ?)`)
      .bind(now, actor.tenantId, row.application_id, `approval.requested:${requestId}:%`, auditId, actor.tenantId),
    DB.prepare(`UPDATE portal_applications SET status = 'submitted', updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND current_version_id = ? AND status = 'awaiting_leader'
        AND EXISTS (SELECT 1 FROM portal_audit_events WHERE id = ? AND tenant_id = ?)
        AND NOT EXISTS (SELECT 1 FROM portal_approval_requests WHERE application_id = ? AND tenant_id = ?
          AND application_version_id = ? AND status IN ('pending', 'approving', 'rejecting'))`)
      .bind(now, row.application_id, actor.tenantId, row.application_version_id, auditId, actor.tenantId,
        row.application_id, actor.tenantId, row.application_version_id),
  ]);
  if (Number(cancelled.meta.changes ?? 0) !== 1) {
    const current = await DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ? AND tenant_id = ?")
      .bind(requestId, actor.tenantId).first<{ status: string }>();
    if (current?.status !== "cancelled") throw alreadyDecided();
    return { status: "cancelled", changed: false };
  }
  return { status: "cancelled", changed: true };
}

function alreadyDecided() {
  return new ApprovalWorkflowError(409, "APPROVAL_ALREADY_CLOSED", "Godkendelseslinket er afsluttet. Den gemte beslutning ændres ikke.");
}
