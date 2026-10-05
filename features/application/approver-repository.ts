import type { ServerActor } from "../auth/types";
import { preparePortalData } from "../workspace/server-repository";
import type { ApplicationFormState } from "./engine";

export type ApproverOption = { id: string; name: string };

async function allowedApprovers(DB: D1Database, actor: ServerActor) {
  const result = await DB.prepare(`
    SELECT DISTINCT u.id, u.display_name AS name
    FROM portal_users u
    JOIN portal_tenants t ON t.id = u.tenant_id AND t.status = 'active'
    JOIN portal_user_roles r ON r.user_id = u.id AND r.tenant_id = u.tenant_id
    WHERE u.tenant_id = ? AND u.status = 'active' AND r.role = 'approver'
      AND u.id != ? AND LOWER(TRIM(u.email)) != LOWER(TRIM(?))
    ORDER BY u.display_name, u.id
  `).bind(actor.tenantId, actor.userId, actor.email).all<ApproverOption>();
  return result.results;
}

export async function listApproversForActor(actor: ServerActor) {
  return allowedApprovers(await preparePortalData(), actor);
}

/** Names from the browser are presentation only; the database owns the mandate. */
export async function canonicalizeApprovingLeader(
  DB: D1Database, actor: ServerActor, state: ApplicationFormState,
): Promise<ApplicationFormState> {
  const approver = (await allowedApprovers(DB, actor)).find((entry) => entry.id === state.approvingLeaderId);
  if (!approver) throw new Error("Vælg en anden aktiv, bemyndiget godkender i din kommune.");
  return { ...state, approvingLeaderId: approver.id, approvingLeader: approver.name };
}
