import type { InformationRequest } from "../workspace/model";

/** The committed event, request and immutable version must agree. Link expiry
 * after a timely decision does not erase that historical decision. */
export function committedLeaderApprovalSql(application: "application" | "portal_applications" | "a") {
  return `EXISTS (
    SELECT 1 FROM portal_approval_requests decision
    JOIN portal_audit_events event ON event.id = 'approval-decision:' || decision.id
      AND event.tenant_id = decision.tenant_id AND event.application_id = decision.application_id
      AND event.event_type = 'approval.approved' AND event.entity_id = decision.id
    WHERE decision.tenant_id = ${application}.tenant_id
      AND decision.application_id = ${application}.id
      AND decision.application_version_id = ${application}.current_version_id
      AND decision.status = 'approved'
      AND julianday(decision.decided_at) <= julianday(decision.expires_at)
      AND julianday(decision.decided_at) <= julianday('now')
      AND decision.id = (SELECT latest.id FROM portal_approval_requests latest
        WHERE latest.tenant_id = ${application}.tenant_id
          AND latest.application_id = ${application}.id
          AND latest.application_version_id = ${application}.current_version_id
        ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1)
  )`;
}

export function informationRequestEventId(applicationId: string, versionId: string) {
  return `information-request:${applicationId}:${versionId}`;
}

/** Explicit public projection shared by the case list and correction form. */
export function publicInformationRequest(value: string | null): InformationRequest | null {
  if (!value) return null;
  let parsed: InformationRequest;
  try { parsed = JSON.parse(value) as InformationRequest; } catch { return null; }
  if (!parsed || typeof parsed.reason !== "string" || typeof parsed.dueDate !== "string" ||
    typeof parsed.requestedAt !== "string" || typeof parsed.applicationVersionId !== "string" ||
    !Number.isSafeInteger(parsed.revision)) return null;
  return { reason: parsed.reason, dueDate: parsed.dueDate, requestedAt: parsed.requestedAt,
    applicationVersionId: parsed.applicationVersionId, revision: parsed.revision };
}
