/** A committed decision belongs to an immutable version. A new leader request
 * requires a new version; replacing an undecided/revoked link remains allowed. */
export function noCommittedLeaderDecisionSql(application: "portal_applications" | "application" = "portal_applications") {
  return `NOT EXISTS (
    SELECT 1 FROM portal_approval_requests decided
    JOIN portal_audit_events event ON event.id = 'approval-decision:' || decided.id
      AND event.tenant_id = decided.tenant_id AND event.application_id = decided.application_id
      AND event.event_type IN ('approval.approved', 'approval.rejected')
    WHERE decided.tenant_id = ${application}.tenant_id
      AND decided.application_id = ${application}.id
      AND decided.application_version_id = ${application}.current_version_id
  )`;
}
