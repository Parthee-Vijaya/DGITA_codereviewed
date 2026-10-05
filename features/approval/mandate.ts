/** Shared live authority check for bearer access, decision writes and queued mail.
 * The aliases are fixed by source code, never supplied by a request.
 */
export function approvalMandateSql(request: "request" | "portal_approval_requests" = "request") {
  return `EXISTS (
    SELECT 1 FROM portal_users mandate_user
    INNER JOIN portal_tenants mandate_tenant
      ON mandate_tenant.id = mandate_user.tenant_id AND mandate_tenant.status = 'active'
    INNER JOIN portal_applications mandate_application
      ON mandate_application.id = ${request}.application_id
      AND mandate_application.tenant_id = ${request}.tenant_id
    INNER JOIN portal_application_versions mandate_version
      ON mandate_version.id = ${request}.application_version_id
      AND mandate_version.application_id = mandate_application.id
      AND mandate_version.tenant_id = ${request}.tenant_id
    INNER JOIN portal_users mandate_owner
      ON mandate_owner.id = mandate_application.owner_user_id
      AND mandate_owner.tenant_id = ${request}.tenant_id
    WHERE mandate_user.id = CASE WHEN json_valid(mandate_version.snapshot_json)
      THEN json_extract(mandate_version.snapshot_json, '$.approvingLeaderId') ELSE NULL END
      AND mandate_user.tenant_id = ${request}.tenant_id AND mandate_user.status = 'active'
      AND LOWER(TRIM(mandate_user.email)) = LOWER(TRIM(${request}.approver_email))
      AND mandate_user.id <> mandate_owner.id
      AND LOWER(TRIM(mandate_user.email)) <> LOWER(TRIM(mandate_owner.email))
      AND EXISTS (
        SELECT 1 FROM portal_user_roles mandate_role
        WHERE mandate_role.user_id = mandate_user.id
          AND mandate_role.tenant_id = mandate_user.tenant_id
          AND mandate_role.role = 'approver'
      )
  )`;
}

export async function hasApprovalMandate(DB: D1Database, requestId: string) {
  const authorized = await DB.prepare(`
    SELECT request.id FROM portal_approval_requests request
    WHERE request.id = ? AND ${approvalMandateSql()}
    LIMIT 1
  `).bind(requestId).first<{ id: string }>();
  return Boolean(authorized);
}
