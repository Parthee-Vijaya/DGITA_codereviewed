import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import type { WorkspaceRole } from "../workspace/model";
import { readSessionToken, hashSessionToken, initialsFor } from "./primitives";
import { AUTH_PROVIDERS, type AuthProvider, type ServerActor } from "./types";
import { permitsTestSessions, readRuntimeEnvironment } from "../runtime/environment";
import { sessionTimeBounds } from "./session-lifecycle";

type ActorRow = {
  last_seen_at: string;
  user_id: string;
  external_subject: string;
  tenant_id: string;
  role: string;
  display_name: string;
  email: string;
  municipality: string;
  provider: string;
};

export type SessionActivityOptions = { recordActivity?: boolean };

export async function resolveSessionActor(cookieHeader: string | null, now = new Date(), options: SessionActivityOptions = {}): Promise<ServerActor | null> {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  const environment = await readRuntimeEnvironment();
  const bounds = sessionTimeBounds(environment, now);
  await ensurePortalSchema();
  const tokenHash = await hashSessionToken(token);
  const { DB } = await getPersistenceBindings();
  const query = () => DB.prepare(`SELECT
      u.id AS user_id, u.external_subject, u.tenant_id, r.role, u.display_name,
      u.email, t.name AS municipality, s.provider, s.last_seen_at
    FROM portal_sessions s
    JOIN portal_users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    JOIN portal_tenants t ON t.id = s.tenant_id
    JOIN portal_user_roles r ON r.user_id = u.id AND r.tenant_id = u.tenant_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      AND s.created_at > ? AND s.last_seen_at > ?
      AND u.status = 'active' AND t.status = 'active'
      AND r.role IN ('user', 'dgita_consultant', 'admin')
    ORDER BY CASE r.role WHEN 'admin' THEN 3 WHEN 'dgita_consultant' THEN 2 ELSE 1 END DESC LIMIT 1`)
    .bind(tokenHash, bounds.now, bounds.createdAfter, bounds.activeAfter).first<ActorRow>();
  let row = await query();
  if (!row || !actorFromRow(row) || row.provider === "dev" && !permitsTestSessions(environment)) return null;
  if (options.recordActivity !== false && row.last_seen_at <= bounds.touchBefore) {
    const touched = await DB.prepare(`UPDATE portal_sessions SET last_seen_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        AND created_at > ? AND last_seen_at > ? AND last_seen_at <= ?`)
      .bind(bounds.now, tokenHash, bounds.now, bounds.createdAfter, bounds.activeAfter, bounds.touchBefore).run();
    // A concurrent request may have touched or revoked the session. Re-read
    // the complete access predicates; never revive an expired/revoked session.
    if (Number(touched.meta.changes ?? 0) !== 1) row = await query();
  }
  return row ? actorFromRow(row) : null;
}

function actorFromRow(row: ActorRow): ServerActor | null {
  const role = actorRoleFromDatabase(row.role);
  const provider = actorProvider(row.provider);
  if (!role || !provider) return null;

  return {
    userId: row.user_id,
    subject: row.external_subject,
    tenantId: row.tenant_id,
    role,
    displayName: row.display_name,
    email: row.email,
    initials: initialsFor(row.display_name),
    municipality: row.municipality,
    provider,
  };
}

function actorRoleFromDatabase(role: string): WorkspaceRole | null {
  if (role === "dgita_consultant") return "consultant";
  if (role === "user" || role === "admin") return role;
  return null;
}

function actorProvider(value: string): AuthProvider | null {
  return (AUTH_PROVIDERS as readonly string[]).includes(value)
    ? (value as AuthProvider)
    : null;
}
