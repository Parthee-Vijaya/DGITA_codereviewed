import assert from "node:assert/strict";
import test from "node:test";

process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "test-login-rate-limit-database-token";
process.env.BLOB_READ_WRITE_TOKEN = "test-login-rate-limit-blob-token";
process.env.DGITA_TRUSTED_PROXY = "vercel";

const {
  TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  TEST_LOGIN_RATE_LIMIT_WINDOW_MS,
  clearTestLoginRateLimit,
  consumeTestLoginRateLimit,
  testLoginRateLimitSubject,
} = await import("./test-login-rate-limit.ts");
const { AuthHttpError, authErrorResponse } = await import("./http.ts");

function publicRequest(ip, extraHeaders = {}) {
  return new Request("https://portal.example.dk/api/auth/dev-login", {
    method: "POST",
    headers: {
      "x-vercel-id": "arn1::test",
      "x-vercel-forwarded-for": ip,
      ...extraHeaders,
    },
  });
}

test("offentligt testlogin begrænses atomisk pr. Vercel-klient", { concurrency: false }, async () => {
  const request = publicRequest("203.0.113.10");
  const startedAt = new Date("2026-08-30T10:00:00.000Z");

  for (let index = 0; index < TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; index += 1) {
    await assert.doesNotReject(
      consumeTestLoginRateLimit(request, startedAt),
    );
  }
  await assert.rejects(
    consumeTestLoginRateLimit(request, startedAt),
    (error) =>
      error instanceof AuthHttpError &&
      error.status === 429 &&
      error.code === "TEST_LOGIN_RATE_LIMITED" &&
      new Headers(error.headers).get("retry-after") === "900",
  );

  const response = authErrorResponse(
    new AuthHttpError(
      429,
      "TEST_LOGIN_RATE_LIMITED",
      "Vent.",
      { "Retry-After": "900" },
    ),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "900");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("vellykket kodekontrol kan nulstille tælleren, og vinduet udløber", { concurrency: false }, async () => {
  const request = publicRequest("203.0.113.11");
  const startedAt = new Date("2026-08-30T11:00:00.000Z");
  const subjectHash = await consumeTestLoginRateLimit(request, startedAt);
  await clearTestLoginRateLimit(subjectHash);

  for (let index = 0; index < TEST_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; index += 1) {
    await consumeTestLoginRateLimit(request, startedAt);
  }
  await assert.doesNotReject(
    consumeTestLoginRateLimit(
      request,
      new Date(startedAt.getTime() + TEST_LOGIN_RATE_LIMIT_WINDOW_MS),
    ),
  );
});

test("platform-IP pseudonymiseres, og spoofet standardheader ignoreres", async () => {
  const first = publicRequest("203.0.113.12", {
    "x-forwarded-for": "198.51.100.44",
  });
  const samePlatformIp = publicRequest("203.0.113.12", {
    "x-forwarded-for": "192.0.2.99",
  });
  const otherPlatformIp = publicRequest("203.0.113.13");

  assert.match(await testLoginRateLimitSubject(first), /^[a-f0-9]{64}$/);
  assert.equal(
    await testLoginRateLimitSubject(first),
    await testLoginRateLimitSubject(samePlatformIp),
  );
  assert.notEqual(
    await testLoginRateLimitSubject(first),
    await testLoginRateLimitSubject(otherPlatformIp),
  );
});

test("forged provider headers cannot rotate the rate-limit key on an untrusted host", async () => {
  const first = publicRequest("203.0.113.40", { "cf-ray": "fake", "cf-connecting-ip": "203.0.113.45" });
  const second = publicRequest("203.0.113.41", { "cf-ray": "other", "cf-connecting-ip": "203.0.113.46" });
  assert.equal(await testLoginRateLimitSubject(first, {}), await testLoginRateLimitSubject(second, {}));
});
