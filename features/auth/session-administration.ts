import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import { AuthHttpError } from "./http";
import type { ServerActor } from "./types";

/** Revoke currently existing sessions. A later successful login creates a new
 * session; permanent departure is handled by disabling the provisioned user. */
export async function revokeUserSessions(actor: ServerActor, targetUserId = actor.userId, now = new Date()) {
  if (actor.userId !== targetUserId && actor.role !== "admin") {
    throw new AuthHttpError(403, "SESSION_ADMIN_FORBIDDEN", "Du kan kun tilbagekalde dine egne sessioner.");
  }
  if (!targetUserId || targetUserId.length > 200) throw new AuthHttpError(400, "SESSION_TARGET_INVALID", "Ugyldig bruger.");
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const target = await DB.prepare("SELECT id FROM portal_users WHERE id = ? AND tenant_id = ?")
    .bind(targetUserId, actor.tenantId).first<{ id: string }>();
  if (!target) throw new AuthHttpError(404, "SESSION_TARGET_NOT_FOUND", "Brugeren findes ikke i din organisation.");
  const nowIso = now.toISOString();
  // Both the mutation and append-only audit are committed together by the DB adapter.
  const [revoked] = await DB.batch([
    DB.prepare("UPDATE portal_sessions SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(nowIso, actor.tenantId, targetUserId),
    DB.prepare(`INSERT INTO portal_audit_events
      (id, tenant_id, actor_user_id, actor_subject, event_type, entity_type, entity_id, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, 'auth.sessions_revoked', 'user', ?, '{}', ?)`)
      .bind(crypto.randomUUID(), actor.tenantId, actor.userId, actor.subject, targetUserId, nowIso),
  ]);
  return { revoked: Number(revoked.meta.changes ?? 0), ownSessions: targetUserId === actor.userId };
}
