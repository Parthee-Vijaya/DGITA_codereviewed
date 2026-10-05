import {
  ensurePortalSchema,
  getPersistenceBindings,
} from "../../db/persistence";
import { AuthHttpError } from "./http";
import { readRuntimeEnvironment, type RuntimeEnvironment } from "../runtime/environment";

export const TEST_LOGIN_RATE_LIMIT_SCOPE = "test-login";
export const TEST_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
export const TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const TEST_LOGIN_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1_000;

type RateLimitRow = {
  attempt_count: number;
  window_started_at: number;
};

/**
 * Reserves one anonymous public test-login attempt before the password is
 * verified. The atomic upsert prevents parallel requests from bypassing the
 * limit. Call clearTestLoginRateLimit after a successful password check.
 */
export async function consumeTestLoginRateLimit(
  request: Request,
  now = new Date(),
) {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const subjectHash = await testLoginRateLimitSubject(request);
  const nowMs = now.getTime();
  const windowCutoff = nowMs - TEST_LOGIN_RATE_LIMIT_WINDOW_MS;
  const retentionCutoff = nowMs - TEST_LOGIN_RATE_LIMIT_RETENTION_MS;

  const results = await DB.batch<RateLimitRow>([
    DB.prepare(
      `INSERT INTO portal_auth_rate_limits
         (scope, subject_hash, window_started_at, attempt_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, subject_hash) DO UPDATE SET
         attempt_count = CASE
           WHEN portal_auth_rate_limits.window_started_at <= ? THEN 1
           ELSE MIN(
             portal_auth_rate_limits.attempt_count + 1,
             ?
           )
         END,
         window_started_at = CASE
           WHEN portal_auth_rate_limits.window_started_at <= ?
             THEN excluded.window_started_at
           ELSE portal_auth_rate_limits.window_started_at
         END,
         updated_at = excluded.updated_at`,
    ).bind(
      TEST_LOGIN_RATE_LIMIT_SCOPE,
      subjectHash,
      nowMs,
      nowMs,
      windowCutoff,
      TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS + 1,
      windowCutoff,
    ),
    DB.prepare(
      `SELECT attempt_count, window_started_at
       FROM portal_auth_rate_limits
       WHERE scope = ? AND subject_hash = ?
       LIMIT 1`,
    ).bind(TEST_LOGIN_RATE_LIMIT_SCOPE, subjectHash),
    DB.prepare(
      `DELETE FROM portal_auth_rate_limits
       WHERE updated_at < ? AND NOT (scope = ? AND subject_hash = ?)`,
    ).bind(
      retentionCutoff,
      TEST_LOGIN_RATE_LIMIT_SCOPE,
      subjectHash,
    ),
  ]);

  const row = results[1]?.results[0];
  if (!row) {
    throw new AuthHttpError(
      503,
      "TEST_LOGIN_RATE_LIMIT_UNAVAILABLE",
      "Testlogin kunne ikke sikkerhedskontrolleres.",
    );
  }

  if (Number(row.attempt_count) > TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (Number(row.window_started_at) +
          TEST_LOGIN_RATE_LIMIT_WINDOW_MS -
          nowMs) /
          1_000,
      ),
    );
    throw new AuthHttpError(
      429,
      "TEST_LOGIN_RATE_LIMITED",
      "Der har været for mange loginforsøg. Prøv igen senere.",
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  return subjectHash;
}

export async function clearTestLoginRateLimit(subjectHash: string) {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  await DB.prepare(
    `DELETE FROM portal_auth_rate_limits
     WHERE scope = ? AND subject_hash = ?`,
  )
    .bind(TEST_LOGIN_RATE_LIMIT_SCOPE, subjectHash)
    .run();
}

export async function testLoginRateLimitSubject(request: Request, environment?: RuntimeEnvironment) {
  const origin = new URL(request.url).origin;
  const platformAddress = trustedClientAddress(request, environment ?? await readRuntimeEnvironment());
  const payload = new TextEncoder().encode(
    `${origin}\n${platformAddress}`,
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", payload),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function trustedClientAddress(request: Request, environment: RuntimeEnvironment) {
  // Platform-looking HTTP headers alone are attacker-controlled on a direct
  // Node host. The trusted proxy must also be identified by server configuration.
  if (environment.VERCEL === "1" || environment.DGITA_TRUSTED_PROXY === "vercel") {
    return normalizedAddress(
      request.headers.get("x-vercel-forwarded-for"),
    );
  }
  if (environment.DGITA_TRUSTED_PROXY === "cloudflare") {
    return normalizedAddress(request.headers.get("cf-connecting-ip"));
  }
  return "unknown";
}

function normalizedAddress(value: string | null) {
  const address = value?.split(",", 1)[0]?.trim();
  return address ? address.slice(0, 128) : "unknown";
}
