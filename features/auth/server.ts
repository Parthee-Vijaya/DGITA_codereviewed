import { resolveSessionActor, type SessionActivityOptions } from "./session-actor";
import { readSessionPolicy } from "./session-lifecycle";
import {
  ensurePortalSchema,
  getPersistenceBindings,
} from "../../db/persistence";
import {
  type WorkspaceRole,
} from "../workspace/model";
import { AuthHttpError } from "./http";
import { resolvePilotViewer } from "../workspace/pilot-profile";
import {
  createSessionToken,
  devLoginPolicy,
  hashSessionToken,
  readSessionToken,
  sessionCookie,
  type AuthEnvironment,
} from "./primitives";
import {
  type AuthProvider,
  type ServerActor,
} from "./types";
import { assertTestLoginAccess } from "./test-access";
import {
  clearTestLoginRateLimit,
  consumeTestLoginRateLimit,
} from "./test-login-rate-limit";
import { readRuntimeEnvironment } from "../runtime/environment";

type UserIdRow = {
  id: string;
};

export type CreatedSession = {
  actor: ServerActor;
  cookie: string;
  expiresAt: string;
};

const DB_ROLE_BY_ACTOR_ROLE: Record<WorkspaceRole, string> = {
  user: "user",
  consultant: "dgita_consultant",
  admin: "admin",
};

export async function getAuthEnvironment(): Promise<AuthEnvironment> {
  return readRuntimeEnvironment();
}

export async function getActor(request: Request, options: SessionActivityOptions = {}) {
  return resolveSessionActor(request.headers.get("cookie"), new Date(), options);
}

export async function getActorFromHeaders(headers: Pick<Headers, "get">) {
  return getActorFromCookieHeader(headers.get("cookie"));
}

export async function getActorFromCookieHeader(cookieHeader: string | null, now = new Date()): Promise<ServerActor | null> {
  return resolveSessionActor(cookieHeader, now);
}

export async function requireActor(request: Request, options: SessionActivityOptions = {}): Promise<ServerActor> {
  const actor = await getActor(request, options);
  if (!actor) {
    throw new AuthHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Du skal være logget ind for at fortsætte.",
    );
  }
  return actor;
}

export async function createDevSession(
  request: Request,
  role: WorkspaceRole,
  environment?: AuthEnvironment,
  accessCode?: string,
): Promise<CreatedSession> {
  const runtimeEnvironment = environment ?? (await getAuthEnvironment());
  const policy = devLoginPolicy(request.url, runtimeEnvironment);
  let currentProvider: AuthProvider | null = null;
  if (
    policy.enabled &&
    policy.accessCodeRequired &&
    readSessionToken(request.headers.get("cookie"))
  ) {
    const currentActor = await getActor(request);
    currentProvider = currentActor?.provider ?? null;
  }
  const rateLimitSubject =
    policy.enabled &&
    policy.accessCodeRequired &&
    currentProvider !== "dev"
      ? await consumeTestLoginRateLimit(request)
      : null;
  await assertTestLoginAccess(
    request.url,
    runtimeEnvironment,
    accessCode,
    currentProvider,
  );
  if (rateLimitSubject) {
    await clearTestLoginRateLimit(rateLimitSubject);
  }

  // A test session must be usable on its first request, before the workspace
  // page has been visited. The seed itself is gated by the runtime policy.
  const { preparePortalData } = await import("../workspace/server-repository");
  const DB = await preparePortalData();
  const viewer = await resolvePilotViewer(DB, role);
  const sessionPolicy = readSessionPolicy(runtimeEnvironment);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + sessionPolicy.maximumSeconds * 1_000,
  ).toISOString();
  const proposedUserId = viewer.subject;

  await DB.batch([
    DB.prepare(
      `INSERT INTO portal_tenants
         (id, slug, name, authority_code, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug,
         name = excluded.name,
         status = 'active',
         updated_at = excluded.updated_at`,
    ).bind(
      viewer.tenantId,
      viewer.tenantId,
      viewer.municipality,
      null,
      nowIso,
      nowIso,
    ),
    DB.prepare(
      `INSERT INTO portal_users
         (id, tenant_id, identity_provider, external_subject, email,
          display_name, status, created_at, updated_at, last_login_at)
       VALUES (?, ?, 'dev', ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(tenant_id, identity_provider, external_subject) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         status = 'active',
         updated_at = excluded.updated_at,
         last_login_at = excluded.last_login_at`,
    ).bind(
      proposedUserId,
      viewer.tenantId,
      viewer.subject,
      viewer.email,
      viewer.displayName,
      nowIso,
      nowIso,
      nowIso,
    ),
  ]);

  const storedUser = await DB.prepare(
    `SELECT id FROM portal_users
     WHERE tenant_id = ?
       AND identity_provider = 'dev'
       AND external_subject = ?
     LIMIT 1`,
  )
    .bind(viewer.tenantId, viewer.subject)
    .first<UserIdRow>();
  if (!storedUser) {
    throw new AuthHttpError(
      503,
      "SESSION_CREATION_FAILED",
      "Testsessionen kunne ikke oprettes.",
    );
  }

  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const sessionId = crypto.randomUUID();
  const roleId = `dev:${viewer.tenantId}:${viewer.subject}:${role}`;
  const dbRole = DB_ROLE_BY_ACTOR_ROLE[role];
  const currentToken = readSessionToken(request.headers.get("cookie"));
  const currentTokenHash = currentToken
    ? await hashSessionToken(currentToken)
    : null;

  const writes = [
    DB.prepare(
      `INSERT INTO portal_user_roles
         (id, tenant_id, user_id, role, created_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, user_id, role) DO NOTHING`,
    ).bind(
      roleId,
      viewer.tenantId,
      storedUser.id,
      dbRole,
      nowIso,
      storedUser.id,
    ),
    DB.prepare(
      `INSERT INTO portal_sessions
         (id, tenant_id, user_id, token_hash, provider,
          provider_session_id, roles_snapshot_json, created_at, expires_at,
          last_seen_at, revoked_at, ip_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, 'dev', NULL, ?, ?, ?, ?, NULL, NULL, NULL)`,
    ).bind(
      sessionId,
      viewer.tenantId,
      storedUser.id,
      tokenHash,
      JSON.stringify([dbRole]),
      nowIso,
      expiresAt,
      nowIso,
    ),
  ];
  if (currentTokenHash) {
    writes.unshift(
      DB.prepare(
        `UPDATE portal_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      ).bind(nowIso, currentTokenHash),
    );
  }
  await DB.batch(writes);

  return {
    actor: {
      ...viewer,
      userId: storedUser.id,
      provider: "dev",
    },
    cookie: sessionCookie(token, request.url, sessionPolicy.maximumSeconds),
    expiresAt,
  };
}

export async function revokeSession(
  cookieHeader: string | null,
  now = new Date(),
) {
  const token = readSessionToken(cookieHeader);
  if (!token) return false;

  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const result = await DB.prepare(
    `UPDATE portal_sessions
     SET revoked_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(now.toISOString(), await hashSessionToken(token))
    .run();
  return (result.meta.changes ?? 0) > 0;
}
