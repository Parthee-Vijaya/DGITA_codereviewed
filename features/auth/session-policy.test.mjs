import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.DGITA_APP_ORIGIN = "http://localhost:3000";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-session-test";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-session-test";

const { createDevSession, getActorFromCookieHeader } = await import("./server.ts");
const { devLoginPolicy, sessionCookie, expiredSessionCookie } = await import("./primitives.ts");
const { permitsDemoSeed } = await import("../runtime/environment.ts");

test("a previously issued admin test session stops working immediately at the kill switch", async () => {
  const session = await createDevSession(new Request("http://localhost:3000/api/auth/dev-login"), "admin");
  assert.equal((await getActorFromCookieHeader(session.cookie)).role, "admin");
  process.env.DGITA_ENABLE_DEV_LOGIN = "false";
  assert.equal(await getActorFromCookieHeader(session.cookie), null);
  process.env.DGITA_ENABLE_DEV_LOGIN = "true";
  process.env.DGITA_ENVIRONMENT = "production";
  assert.equal(await getActorFromCookieHeader(session.cookie), null);
  process.env.DGITA_ENVIRONMENT = "pilot";
});

test("production and unknown stages reject test login even on localhost", () => {
  for (const stage of ["production", "prodution"]) {
    assert.equal(devLoginPolicy("http://localhost:3000", {
      DGITA_ENVIRONMENT: stage, DGITA_ENABLE_DEV_LOGIN: "true",
    }).enabled, false);
  }
  assert.equal(devLoginPolicy("http://localhost:3000", { DGITA_ENABLE_DEV_LOGIN: "false" }).enabled, false);
});

test("demo seeding requires explicit pilot intent and is forbidden in production", () => {
  assert.equal(permitsDemoSeed({}), false);
  assert.equal(permitsDemoSeed({ DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true" }), true);
  assert.equal(permitsDemoSeed({ DGITA_ENVIRONMENT: "production", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "true" }), false);
  assert.equal(permitsDemoSeed({ DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "false" }), false);
});


test("public pilot origin cannot inherit the local access-code exemption from an internal Next URL", async () => {
  const environment = { DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true",
    DGITA_APP_ORIGIN: "https://pilot.example.invalid" };
  const request = new Request("http://localhost:3000/api/auth/dev-login");
  assert.deepEqual(devLoginPolicy(request.url, environment), {
    enabled: false, accessCodeRequired: true, configurationValid: false,
  });
  await assert.rejects(createDevSession(request, "admin", environment), { status: 503 });
  const configured = { ...environment, DGITA_TEST_ACCESS_SECRET: "synthetic-pilot-secret" };
  await assert.rejects(createDevSession(request, "admin", configured), { status: 403 });
  const session = await createDevSession(request, "admin", configured, "synthetic-pilot-secret");
  assert.match(session.cookie, /; Secure(?:;|$)/u);
  assert.match(expiredSessionCookie(request.url, configured), /; Secure(?:;|$)/u);
});

test("Vercel platform context always requires the public pilot access code and secure cookie", () => {
  for (const platform of [{ VERCEL: "1" }, { VERCEL_URL: "synthetic.vercel.app" }]) {
    const environment = { DGITA_ENABLE_DEV_LOGIN: "true", ...platform };
    assert.equal(devLoginPolicy("http://localhost:3000", environment).configurationValid, false);
    assert.match(sessionCookie("synthetic", "http://localhost:3000", 60, environment), /; Secure(?:;|$)/u);
  }
  assert.deepEqual(devLoginPolicy("http://localhost:3000", { DGITA_ENVIRONMENT: "pilot",
    DGITA_ENABLE_DEV_LOGIN: "true", DGITA_APP_ORIGIN: "http://localhost:3000" }), {
    enabled: true, accessCodeRequired: false, configurationValid: true,
  });
});

test("pilot login fails closed without a valid explicit origin even through internal loopback URLs", async () => {
  const request = new Request("http://localhost:3000/api/auth/dev-login");
  for (const stage of [undefined, "pilot"]) {
    for (const origin of [undefined, "", "not a URL", "file://localhost/", "http://name:pass@localhost/", "http://localhost/path", "http://localhost/?next=public", "http://localhost/#fragment"]) {
      const environment = { DGITA_ENVIRONMENT: stage, DGITA_ENABLE_DEV_LOGIN: "true", DGITA_APP_ORIGIN: origin,
        DGITA_TEST_ACCESS_SECRET: "synthetic-explicit-origin-check" };
      assert.deepEqual(devLoginPolicy(request.url, environment), {
        enabled: false, accessCodeRequired: true, configurationValid: false,
      });
      await assert.rejects(createDevSession(request, "admin", environment, environment.DGITA_TEST_ACCESS_SECRET),
        { code: "TEST_LOGIN_CONFIGURATION_ERROR" });
    }
  }
  assert.equal(devLoginPolicy(request.url, { DGITA_ENVIRONMENT: "local" }).enabled, true);
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.deepEqual(devLoginPolicy(request.url, { DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_APP_ORIGIN: origin }), {
      enabled: true, accessCodeRequired: false, configurationValid: true,
    });
  }
});

test("the dev-login endpoint cannot mint admin cookies for an originless self-hosted pilot", async () => {
  const { POST } = await import("../../app/api/auth/dev-login/route.ts");
  const { preparePortalData } = await import("../workspace/server-repository.ts");
  const DB = await preparePortalData();
  const before = await DB.prepare("SELECT count(*) AS n FROM portal_sessions").first("n");
  const original = process.env.DGITA_APP_ORIGIN;
  try {
    delete process.env.DGITA_APP_ORIGIN;
    const response = await POST(new Request("http://localhost:3000/api/auth/dev-login", {
      method: "POST", headers: { host: "public-selfhosted.example.invalid", origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "TEST_LOGIN_CONFIGURATION_ERROR");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(await DB.prepare("SELECT count(*) AS n FROM portal_sessions").first("n"), before);
  } finally {
    if (original === undefined) delete process.env.DGITA_APP_ORIGIN;
    else process.env.DGITA_APP_ORIGIN = original;
  }
});
