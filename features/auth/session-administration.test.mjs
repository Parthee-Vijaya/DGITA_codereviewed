import assert from "node:assert/strict";
import test from "node:test";
process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-session-lifecycle";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-session-lifecycle";
process.env.DGITA_SESSION_MAX_SECONDS = "3600";
process.env.DGITA_SESSION_IDLE_SECONDS = "120";

const { ensurePortalSchema, getPersistenceBindings } = await import("../../db/persistence.ts");
const { createSessionToken, hashSessionToken } = await import("./primitives.ts");
const { resolveSessionActor } = await import("./session-actor.ts");
const { revokeUserSessions } = await import("./session-administration.ts");
await ensurePortalSchema();
const { DB } = await getPersistenceBindings();
const now = new Date("2026-10-05T12:00:00.000Z");
const at = (seconds) => new Date(now.getTime() + seconds * 1000).toISOString();
for (const tenant of ["local-one", "local-two"]) {
  await DB.prepare("INSERT INTO portal_tenants (id,slug,name) VALUES (?,?,?)").bind(tenant, tenant, "Testkommune").run();
  for (const role of ["user", "admin"]) {
    const id = `${tenant}-${role}`;
    await DB.prepare("INSERT INTO portal_users (id,tenant_id,identity_provider,external_subject,email,display_name) VALUES (?,?,'dev',?,?,?)")
      .bind(id, tenant, id, `${role}@example.invalid`, "Testbruger").run();
    await DB.prepare("INSERT INTO portal_user_roles (id,tenant_id,user_id,role) VALUES (?,?,?,?)").bind(id, tenant, id, role).run();
  }
}
function actor(tenant, role) {
  return { userId: `${tenant}-${role}`, tenantId: tenant, subject: `${tenant}-${role}`, role,
    provider: "dev", displayName: "Testbruger", email: `${role}@example.invalid`, initials: "TB", municipality: "Testkommune" };
}
async function session({ tenant = "local-one", role = "user", created = -600, seen = -10, expires = 3600 } = {}) {
  const token = createSessionToken(); const id = crypto.randomUUID();
  await DB.prepare(`INSERT INTO portal_sessions
    (id,tenant_id,user_id,token_hash,provider,created_at,expires_at,last_seen_at)
    VALUES (?,?,?,?,'dev',?,?,?)`).bind(id, tenant, `${tenant}-${role}`, await hashSessionToken(token), at(created), at(expires), at(seen)).run();
  return { id, token, cookie: `dgita_session=${token}` };
}

test("idle and absolute boundaries reject sessions without reviving their activity", async () => {
  for (const options of [{ seen: -120 }, { created: -3600 }, { expires: 0 }]) {
    const item = await session(options);
    const before = await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(item.id).first();
    assert.equal(await resolveSessionActor(item.cookie, now), null);
    assert.deepEqual(await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(item.id).first(), before);
  }
  assert.equal((await resolveSessionActor((await session({ seen: -119 })).cookie, now)).userId, "local-one-user");
});

test("activity writes are throttled and concurrent requests cannot move activity backwards", async () => {
  const recent = await session({ seen: -10 });
  await resolveSessionActor(recent.cookie, now);
  assert.equal((await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(recent.id).first()).last_seen_at, at(-10));
  const stale = await session({ seen: -100 });
  const responses = await Promise.all([resolveSessionActor(stale.cookie, new Date(at(1))), resolveSessionActor(stale.cookie, now)]);
  assert.ok(responses.every(Boolean));
  const touched = (await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(stale.id).first()).last_seen_at;
  assert.ok(touched === at(0) || touched === at(1));
  await resolveSessionActor(stale.cookie, new Date(at(-1)));
  assert.equal((await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(stale.id).first()).last_seen_at, touched);
});

test("passive notification polling never extends idle expiry", async () => {
  const item = await session({ seen: -100 });
  for (const seconds of [0, 5, 10, 15]) assert.ok(await resolveSessionActor(item.cookie, new Date(at(seconds)), { recordActivity: false }));
  assert.equal(await resolveSessionActor(item.cookie, new Date(at(20)), { recordActivity: false }), null);
  const realNow = Date.now();
  const lastSeen = new Date(realNow - 90_000).toISOString();
  await DB.prepare("UPDATE portal_sessions SET created_at = ?, last_seen_at = ?, expires_at = ? WHERE id = ?")
    .bind(new Date(realNow - 300_000).toISOString(), lastSeen, new Date(realNow + 3_600_000).toISOString(), item.id).run();
  const { GET } = await import("../../app/api/notifications/route.ts");
  const response = await GET(new Request("http://localhost/api/notifications", { headers: { cookie: item.cookie } }));
  assert.equal(response.status, 200);
  assert.equal((await DB.prepare("SELECT last_seen_at FROM portal_sessions WHERE id = ?").bind(item.id).first()).last_seen_at, lastSeen);
});

test("self/admin revocation affects all existing target sessions and preserves tenant isolation", async () => {
  const first = await session(); const second = await session();
  const other = await session({ tenant: "local-two" });
  await assert.rejects(revokeUserSessions(actor("local-one", "user"), "local-one-admin", now), { status: 403 });
  await assert.rejects(revokeUserSessions(actor("local-one", "admin"), "local-two-user", now), { status: 404 });
  assert.ok((await revokeUserSessions(actor("local-one", "admin"), "local-one-user", now)).revoked >= 2);
  assert.equal(await resolveSessionActor(first.cookie, now), null);
  assert.equal(await resolveSessionActor(second.cookie, now), null);
  assert.ok(await resolveSessionActor(other.cookie, now));
  assert.equal((await revokeUserSessions(actor("local-one", "admin"), "local-one-user", now)).revoked, 0);
  const fresh = await session();
  assert.ok(await resolveSessionActor(fresh.cookie, now));
  assert.equal((await revokeUserSessions(actor("local-one", "user"), undefined, now)).ownSessions, true);
  assert.equal(await resolveSessionActor(fresh.cookie, now), null);
  const audit = await DB.prepare("SELECT * FROM portal_audit_events WHERE event_type = 'auth.sessions_revoked'").all();
  assert.equal(audit.results.length, 3);
  assert.ok(!JSON.stringify(audit).includes(first.token));
  assert.ok(audit.results.every((entry) => entry.tenant_id === "local-one" && entry.payload_json === "{}"));
});

test("failed audit append rolls back revocation; inactive users remain denied", async () => {
  const item = await session({ tenant: "local-two" });
  await DB.prepare("CREATE TRIGGER test_audit_failure BEFORE INSERT ON portal_audit_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run();
  try { await assert.rejects(revokeUserSessions(actor("local-two", "admin"), "local-two-user", now)); }
  finally { await DB.prepare("DROP TRIGGER test_audit_failure").run(); }
  assert.ok(await resolveSessionActor(item.cookie, now));
  await DB.prepare("UPDATE portal_users SET status = 'inactive' WHERE id = 'local-two-user'").run();
  assert.equal(await resolveSessionActor(item.cookie, now), null);
});

test("session-revocation endpoint enforces authentication/origin and expires own cookie", async () => {
  const { POST } = await import("../../app/api/auth/sessions/revoke/route.ts");
  const { createDevSession, getActorFromCookieHeader } = await import("./server.ts");
  const issued = await createDevSession(new Request("http://localhost/api/auth/dev-login"), "user");
  const call = (cookie, origin, body = {}) => POST(new Request("http://localhost/api/auth/sessions/revoke", {
    method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  assert.equal((await call("", "http://localhost")).status, 401);
  assert.equal((await call(issued.cookie, "https://attacker.example.invalid")).status, 403);
  assert.equal((await call(issued.cookie, "http://localhost", { userId: "local-two-user" })).status, 403);
  assert.ok(await getActorFromCookieHeader(issued.cookie));
  const result = await call(issued.cookie, "http://localhost");
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /Max-Age=0/u);
  assert.equal((await result.json()).ownSessions, true);
  assert.equal(await getActorFromCookieHeader(issued.cookie), null);
});
