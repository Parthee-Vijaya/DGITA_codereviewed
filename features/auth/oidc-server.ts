import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import { AuthHttpError } from "./http";
import {
  assertEntraOrigin, consumeEntraState, exchangeEntraCode, oidcFlowCookie,
  readEntraFlow, requireEntraConfig, startEntraFlow,
  type EntraConfig, type EntraIdentity, type EntraNetwork,
} from "./oidc";
import {
  createSessionToken, hashSessionToken, readSessionToken, sessionCookie,
  SESSION_TTL_SECONDS, type AuthEnvironment,
} from "./primitives";

type ProvisionedUser = { id: string; role: string };

/** Roles and profile data are administrator-provisioned; token roles/email never grant access. */
export async function createEntraSession(DB: D1Database, identity: EntraIdentity,
  config: EntraConfig, request: Request, now = new Date()) {
  if (identity.tenantId !== config.tenantId ||
      identity.subject !== `${config.tenantId}:${identity.objectId}`) throw accessDenied();
  const user = await DB.prepare(
    `SELECT u.id, r.role FROM portal_users u
     JOIN portal_tenants t ON t.id = u.tenant_id
     JOIN portal_user_roles r ON r.user_id = u.id AND r.tenant_id = u.tenant_id
     WHERE u.tenant_id = ? AND u.identity_provider = 'entra' AND u.external_subject = ?
       AND u.status = 'active' AND t.status = 'active'
       AND r.role IN ('user', 'dgita_consultant', 'admin')
     ORDER BY CASE r.role WHEN 'admin' THEN 3 WHEN 'dgita_consultant' THEN 2 ELSE 1 END DESC LIMIT 1`,
  ).bind(config.portalTenantId, identity.subject).first<ProvisionedUser>();
  if (!user) throw accessDenied();
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const oldToken = readSessionToken(request.headers.get("cookie"));
  const oldHash = oldToken ? await hashSessionToken(oldToken) : null;
  // Recheck active status and assigned role at insert time; a prior lookup grants no rights by itself.
  const inserted = await DB.prepare(
    `INSERT INTO portal_sessions
      (id, tenant_id, user_id, token_hash, provider, provider_session_id,
       roles_snapshot_json, created_at, expires_at, last_seen_at, revoked_at, ip_hash, user_agent_hash)
     SELECT ?, u.tenant_id, u.id, ?, 'entra', NULL, ?, ?, ?, ?, NULL, NULL, NULL
     FROM portal_users u JOIN portal_tenants t ON t.id = u.tenant_id
     WHERE u.id = ? AND u.tenant_id = ? AND u.identity_provider = 'entra'
       AND u.external_subject = ? AND u.status = 'active' AND t.status = 'active'
       AND EXISTS (SELECT 1 FROM portal_user_roles r WHERE r.user_id = u.id
         AND r.tenant_id = u.tenant_id AND r.role = ?)`,
  ).bind(crypto.randomUUID(), tokenHash, JSON.stringify([user.role]), nowIso, expiresAt, nowIso,
    user.id, config.portalTenantId, identity.subject, user.role).run();
  if (inserted.meta.changes !== 1) throw accessDenied();
  const writes = [DB.prepare("UPDATE portal_users SET last_login_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(nowIso, user.id, config.portalTenantId)];
  if (oldHash) writes.push(DB.prepare("UPDATE portal_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(nowIso, oldHash));
  await DB.batch(writes);
  return { cookie: sessionCookie(token, config.origin), expiresAt };
}

function accessDenied() {
  return new AuthHttpError(403, "ENTRA_ACCESS_NOT_ASSIGNED", "Du er logget ind hos kommunen, men har ikke fået adgang til D-GITA. Kontakt systemadministratoren.");
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location, "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function handleEntraStart(request: Request, environment: AuthEnvironment, now = new Date()) {
  const config = requireEntraConfig(environment);
  assertEntraOrigin(request, config);
  // A normal top-level link is allowed. Cross-site initiation is rejected where browser metadata exists.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AuthHttpError(403, "ENTRA_INVALID_ORIGIN", "Start login fra portalens loginside.");
  }
  const flow = await startEntraFlow(config, now);
  return redirect(flow.location, [flow.cookie]);
}

export async function handleEntraCallback(request: Request, environment: AuthEnvironment,
  options: EntraNetwork & { now?: Date; database?: D1Database } = {}) {
  const config = requireEntraConfig(environment);
  try {
    assertEntraOrigin(request, config);
    const now = options.now ?? new Date();
    const flow = await readEntraFlow(request, config, now);
    if (!options.database) await ensurePortalSchema();
    const DB = options.database ?? (await getPersistenceBindings()).DB;
    await consumeEntraState(DB, flow, now);
    const params = new URL(request.url).searchParams;
    const codes = params.getAll("code");
    if (params.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 8192) {
      throw new AuthHttpError(400, "ENTRA_AUTHORIZATION_FAILED", "Login blev ikke gennemført.");
    }
    const identity = await exchangeEntraCode(codes[0], flow, config, now, options);
    const session = await createEntraSession(DB, identity, config, request, now);
    return redirect(`${config.origin}/`, [oidcFlowCookie(config, "", 0), session.cookie]);
  } catch (error) {
    const code = error instanceof AuthHttpError && error.code === "ENTRA_ACCESS_NOT_ASSIGNED"
      ? "access-not-assigned" : "login-failed";
    return redirect(`${config.origin}/login?entra=${code}`, [oidcFlowCookie(config, "", 0)]);
  }
}
