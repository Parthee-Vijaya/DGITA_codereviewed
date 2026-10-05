import { approvalMandateSql } from "../approval/mandate";

/** Snapshot read before a successful queued -> processing compare-and-set. */
export type ClaimedMail = {
  id: string; tenant_id: string; application_id: string | null;
  recipient_email: string; template_key: string; idempotency_key: string;
  attachments_json: string; attempt_count: number;
};
export class MailCancelledError extends Error {
  constructor() { super("Mailen er ikke længere aktuel."); this.name = "MailCancelledError"; }
}
export class MailAttachmentReferenceError extends Error {
  constructor() { super("Mailens bilagsreferencer er ugyldige."); this.name = "MailAttachmentReferenceError"; }
}

export async function assertMailStillAuthorized(DB: D1Database, row: ClaimedMail) {
  const current = await DB.prepare(`
    SELECT mail.id FROM portal_mail_outbox mail
    INNER JOIN portal_tenants tenant ON tenant.id = mail.tenant_id AND tenant.status = 'active'
    WHERE mail.id = ? AND mail.tenant_id = ? AND mail.status = 'processing'
      AND mail.recipient_email = ? AND mail.attempt_count = ?
      AND mail.application_id IS ? AND mail.template_key = ?
      AND mail.idempotency_key = ? AND mail.attachments_json = ?
      AND NOT EXISTS (SELECT 1 FROM portal_bootstrap_state quarantine WHERE quarantine.tenant_id = mail.tenant_id AND quarantine.scope = 'recovery-quarantine')
    LIMIT 1
  `).bind(row.id, row.tenant_id, row.recipient_email, row.attempt_count + 1, row.application_id, row.template_key, row.idempotency_key, row.attachments_json).first<{ id: string }>();
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

