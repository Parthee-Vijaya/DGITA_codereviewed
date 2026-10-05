import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-session-test";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-session-test";

const { createDevSession, getActorFromCookieHeader } = await import("./server.ts");
const { devLoginPolicy } = await import("./primitives.ts");
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
