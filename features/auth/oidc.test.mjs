import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { exportJWK, generateKeyPair, SignJWT, base64url } from "jose";
import { createLibsqlD1Adapter, enableLibsqlForeignKeys } from "../../db/vercel-persistence.ts";
import { portalSchemaStatements } from "../../db/persistence.ts";
import {
  OIDC_FLOW_TTL_SECONDS, readEntraConfig, readEntraFlow, startEntraFlow,
  verifyEntraIdToken, consumeEntraState,
} from "./oidc.ts";
import { createEntraSession, handleEntraCallback, handleEntraStart } from "./oidc-server.ts";
import { hashSessionToken, readSessionToken } from "./primitives.ts";
import { GET as providerStatus } from "../../app/api/auth/entra/status/route.ts";

const tenantId = "11111111-2222-3333-4444-555555555555";
const objectId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const clientId = "12345678-1234-1234-1234-123456789abc";
const environment = {
  DGITA_ENVIRONMENT: "production",
  DGITA_APP_ORIGIN: "https://portal.example.invalid",
  DGITA_ENTRA_TENANT_ID: tenantId,
  DGITA_ENTRA_PORTAL_TENANT_ID: "municipality-a",
  DGITA_ENTRA_CLIENT_ID: clientId,
  DGITA_ENTRA_CLIENT_SECRET: "synthetic-client-secret-never-used-outside-tests",
  DGITA_OIDC_STATE_SECRET: "isolated-test-cookie-key-0123456789-ABCDEF",
  DGITA_ENTRA_REDIRECT_URI: "https://portal.example.invalid/api/auth/entra/callback",
};
const config = readEntraConfig(environment);
const now = new Date("2026-10-05T10:00:00Z");
const seconds = Math.floor(now.getTime() / 1000);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "synthetic-signing-key", use: "sig", alg: "RS256" };
const identity = { tenantId, objectId, subject: `${tenantId}:${objectId}` };

async function database() {
  const client = createClient({ url: ":memory:" });
  await enableLibsqlForeignKeys(client);
  const DB = createLibsqlD1Adapter(client);
  await DB.batch(portalSchemaStatements.map((sql) => DB.prepare(sql)));
  return { DB, close: () => client.close() };
}

async function provision(DB, { role = "user", userStatus = "active", tenantStatus = "active", provider = "entra", portalTenantId = config.portalTenantId, subject = identity.subject } = {}) {
  await DB.prepare("INSERT INTO portal_tenants (id, slug, name, status) VALUES (?, ?, 'Syntetisk kommune', ?)")
    .bind(portalTenantId, portalTenantId, tenantStatus).run();
  await DB.prepare("INSERT INTO portal_users (id, tenant_id, identity_provider, external_subject, email, display_name, status) VALUES ('synthetic-user', ?, ?, ?, 'synthetic@example.invalid', 'Syntetisk bruger', ?)")
    .bind(portalTenantId, provider, subject, userStatus).run();
  if (role) await DB.prepare("INSERT INTO portal_user_roles (id, tenant_id, user_id, role) VALUES ('synthetic-role', ?, 'synthetic-user', ?)").bind(portalTenantId, role).run();
}

async function sign(nonce, overrides = {}, key = privateKey) {
  return new SignJWT({
    iss: config.issuer, aud: config.clientId, sub: "opaque-pairwise-subject", tid: tenantId, oid: objectId,
    nonce, ver: "2.0", iat: seconds, nbf: seconds - 1, exp: seconds + 3600,
    // Deliberately elevated and unrelated claims: DB provisioning remains authoritative.
    roles: ["admin"], email: "administrator@example.invalid", ...overrides,
  }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(key);
}

async function flowRequest({ stateOverride, query = "", cookieOverride } = {}) {
  const started = await startEntraFlow(config, now);
  const authorize = new URL(started.location);
  const state = stateOverride ?? authorize.searchParams.get("state");
  const cookie = cookieOverride ?? started.cookie.split(";")[0];
  const request = new Request(`${config.redirectUri}?state=${state}&code=synthetic-code${query}`, { headers: { cookie } });
  return { started, authorize, request, nonce: authorize.searchParams.get("nonce") };
}

function networkFor(idToken, authorize) {
  const exchanges = [];
  const network = { fetch: async (url, init) => {
    if (String(url) === config.jwksUrl) return Response.json({ keys: [jwk] });
    assert.equal(String(url), config.tokenUrl);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("client_id"), config.clientId);
    assert.equal(body.get("client_secret"), config.clientSecret);
    assert.equal(body.get("redirect_uri"), config.redirectUri);
    if (authorize) {
      const challenge = base64url.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")))));
      assert.equal(challenge, authorize.searchParams.get("code_challenge"));
    }
    exchanges.push(body.get("code"));
    return Response.json({ id_token: idToken, access_token: "must-not-be-stored" });
  } };
  return { network, exchanges };
}

test("Entra is enabled only for a complete tenant-specific, separately keyed canonical configuration", () => {
  assert.ok(config);
  for (const field of ["DGITA_ENTRA_TENANT_ID", "DGITA_ENTRA_CLIENT_ID", "DGITA_ENTRA_PORTAL_TENANT_ID", "DGITA_ENTRA_CLIENT_SECRET", "DGITA_OIDC_STATE_SECRET", "DGITA_ENTRA_REDIRECT_URI", "DGITA_APP_ORIGIN"]) {
    assert.equal(readEntraConfig({ ...environment, [field]: undefined }), null, field);
  }
  for (const change of [
    { DGITA_ENTRA_TENANT_ID: "common" }, { DGITA_ENTRA_ISSUER: "https://evil.example.invalid/v2.0" },
    { DGITA_ENTRA_REDIRECT_URI: "https://evil.example.invalid/api/auth/entra/callback" },
    { DGITA_ENTRA_REDIRECT_URI: `${config.redirectUri}?next=https://evil.example.invalid` },
    { DGITA_APP_ORIGIN: "https://portal.example.invalid/untrusted/path" },
    { DGITA_OIDC_STATE_SECRET: environment.DGITA_ENTRA_CLIENT_SECRET },
    { DGITA_OIDC_STATE_SECRET: "x".repeat(32) },
  ]) assert.equal(readEntraConfig({ ...environment, ...change }), null);
  assert.equal(readEntraConfig({ ...environment, DGITA_APP_ORIGIN: "http://localhost:3000", DGITA_ENTRA_REDIRECT_URI: "http://localhost:3000/api/auth/entra/callback" }), null);
  assert.ok(readEntraConfig({ ...environment, DGITA_ENVIRONMENT: "local", DGITA_APP_ORIGIN: "http://localhost:3000", DGITA_ENTRA_REDIRECT_URI: "http://localhost:3000/api/auth/entra/callback" }));
});

test("status route activates the Entra button only on its configured origin and exposes one boolean", async () => {
  const keys = [...Object.keys(environment), "DGITA_ENTRA_ISSUER"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    delete process.env.DGITA_ENTRA_ISSUER;
    const request = new Request(`${config.origin}/api/auth/entra/status`);
    const enabled = await providerStatus(request);
    assert.deepEqual(await enabled.json(), { enabled: true });
    assert.match(enabled.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await (await providerStatus(new Request("https://other.example.invalid/api/auth/entra/status"))).json(), { enabled: false });
    delete process.env.DGITA_ENTRA_CLIENT_SECRET;
    assert.deepEqual(await (await providerStatus(request)).json(), { enabled: false });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("authorization uses PKCE S256 and unique state/nonce, never exposes verifier or client secret", async () => {
  const first = await flowRequest();
  const second = await flowRequest();
  const params = first.authorize.searchParams;
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("response_mode"), "query");
  assert.equal(params.get("scope"), "openid profile email");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.notEqual(params.get("state"), second.authorize.searchParams.get("state"));
  assert.notEqual(params.get("nonce"), second.nonce);
  assert.ok(!first.started.location.includes(config.clientSecret));
  assert.match(first.started.cookie, /^__Host-dgita_entra_flow=/);
  for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) assert.ok(first.started.cookie.includes(flag));
  const flow = await readEntraFlow(first.request, config, now);
  assert.ok(!first.started.cookie.includes(flow.verifier));
  assert.equal(first.started.cookie.includes("Domain="), false);
});

test("state is bound to this browser, canonical client/tenant/origin and ten-minute lifetime", async () => {
  const { request } = await flowRequest();
  for (const cfg of [{ ...config, clientId: tenantId }, { ...config, portalTenantId: "other" }, { ...config, stateSecret: "different-cookie-encryption-secret-012345" }, { ...config, origin: "https://other.example.invalid" }]) {
    await assert.rejects(readEntraFlow(request, cfg, now), { code: "ENTRA_INVALID_STATE" });
  }
  const missingCookie = new Request(request.url);
  const duplicatedState = new Request(`${request.url}&state=another`, { headers: request.headers });
  await assert.rejects(readEntraFlow(missingCookie, config, now), { code: "ENTRA_INVALID_STATE" });
  await assert.rejects(readEntraFlow(duplicatedState, config, now), { code: "ENTRA_INVALID_STATE" });
  const wrongState = await flowRequest({ stateOverride: "a".repeat(43) });
  await assert.rejects(readEntraFlow(wrongState.request, config, now), { code: "ENTRA_INVALID_STATE" });
  await assert.rejects(readEntraFlow(request, config, new Date(now.getTime() + OIDC_FLOW_TTL_SECONDS * 1000)), { code: "ENTRA_INVALID_STATE" });
});

test("cross-site initiation and hostile hosts are rejected", async () => {
  await assert.rejects(handleEntraStart(new Request(`${config.origin}/api/auth/entra/start`, { headers: { "sec-fetch-site": "cross-site" } }), environment, now), { code: "ENTRA_INVALID_ORIGIN" });
  await assert.rejects(handleEntraStart(new Request("https://evil.example.invalid/api/auth/entra/start"), environment, now), { code: "ENTRA_ORIGIN_MISMATCH" });
  const response = await handleEntraStart(new Request(`${config.origin}/api/auth/entra/start`, { headers: { "sec-fetch-site": "same-origin" } }), environment, now);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /^https:\/\/login\.microsoftonline\.com\//);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("ID token signature/JWKS and stable tid/oid are verified; roles/email are discarded", async () => {
  const { nonce } = await flowRequest();
  const token = await sign(nonce);
  const { network } = networkFor(token);
  assert.deepEqual(await verifyEntraIdToken(token, nonce, config, now, network), identity);
});

for (const [name, changed] of [
  ["issuer", { iss: "https://evil.example.invalid" }],
  ["audience", { aud: "other-app" }],
  ["multiple audiences", { aud: [clientId, "other-app"] }],
  ["authorized party", { azp: "other-app" }],
  ["tenant", { tid: "99999999-2222-3333-4444-555555555555" }],
  ["object identifier", { oid: "not-a-guid" }],
  ["expired token", { exp: seconds - 1 }],
  ["future issued token", { iat: seconds + 120 }],
  ["old issued token", { iat: seconds - 720 }],
  ["not-yet-valid token", { nbf: seconds + 120 }],
  ["missing expiry", { exp: undefined }],
  ["missing oid", { oid: undefined }],
  ["v1 token", { ver: "1.0" }],
  ["nonce", { nonce: "wrong-nonce" }],
]) test(`ID token rejects ${name}`, async () => {
  const { nonce } = await flowRequest();
  const token = await sign(nonce, changed);
  await assert.rejects(verifyEntraIdToken(token, nonce, config, now, networkFor(token).network), { code: "ENTRA_INVALID_ID_TOKEN" });
});

test("ID token rejects untrusted signing keys and non-allowlisted algorithms", async () => {
  const { nonce } = await flowRequest();
  const other = await generateKeyPair("RS256");
  const invalid = await sign(nonce, {}, other.privateKey);
  await assert.rejects(verifyEntraIdToken(invalid, nonce, config, now, networkFor(invalid).network), { code: "ENTRA_INVALID_ID_TOKEN" });
  const hmac = await new SignJWT({ iss: config.issuer, aud: config.clientId }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("synthetic-hmac-key-for-rejection"));
  await assert.rejects(verifyEntraIdToken(hmac, nonce, config, now, networkFor(hmac).network), { code: "ENTRA_INVALID_ID_TOKEN" });
});

test("copied state cookies can be consumed only once, including concurrent callbacks", async () => {
  const { DB, close } = await database();
  try {
    const { request } = await flowRequest();
    const flow = await readEntraFlow(request, config, now);
    const results = await Promise.allSettled([consumeEntraState(DB, flow, now), consumeEntraState(DB, flow, now)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const row = await DB.prepare("SELECT * FROM portal_oidc_used_states").first();
    assert.equal(row.state_hash, await hashSessionToken(flow.state));
    assert.ok(!JSON.stringify(row).includes(flow.verifier));
    await DB.prepare("INSERT INTO portal_oidc_used_states (state_hash, expires_at) VALUES ('old-synthetic-state', '2000-01-01T00:00:00.000Z')").run();
    const next = await flowRequest();
    await consumeEntraState(DB, await readEntraFlow(next.request, config, now), now);
    assert.equal(await DB.prepare("SELECT * FROM portal_oidc_used_states WHERE state_hash = 'old-synthetic-state'").first(), null);
  } finally { close(); }
});

for (const [name, options] of [
  ["missing role", { role: null }], ["unknown role", { role: "superadmin" }],
  ["approver-only role", { role: "approver" }], ["inactive user", { userStatus: "disabled" }],
  ["inactive tenant", { tenantStatus: "disabled" }], ["test identity", { provider: "dev" }],
  ["other municipality", { portalTenantId: "municipality-b" }],
  ["email instead of stable subject", { subject: "administrator@example.invalid" }],
]) test(`administrator provisioning rejects ${name}`, async () => {
  const { DB, close } = await database();
  try {
    await provision(DB, options);
    await assert.rejects(createEntraSession(DB, identity, config, new Request(config.redirectUri), now), { code: "ENTRA_ACCESS_NOT_ASSIGNED" });
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM portal_sessions").first()).count, 0);
  } finally { close(); }
});

test("callback succeeds with a real signed mock IdP, rotates session and ignores elevated token roles", async () => {
  const { DB, close } = await database();
  try {
    await provision(DB);
    const { request, nonce, authorize } = await flowRequest({ query: "&next=https://evil.example.invalid&role=admin" });
    const old = await createEntraSession(DB, identity, config, new Request(config.redirectUri), now);
    const oldToken = readSessionToken(old.cookie);
    const cookie = `${request.headers.get("cookie")}; ${old.cookie.split(";")[0]}`;
    const callback = new Request(request.url, { headers: { cookie } });
    const token = await sign(nonce);
    const { network, exchanges } = networkFor(token, authorize);
    const response = await handleEntraCallback(callback, environment, { now, database: DB, ...network });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${config.origin}/`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some((c) => c.startsWith("__Host-dgita_entra_flow=") && c.includes("Max-Age=0")));
    const session = cookies.find((c) => c.startsWith("dgita_session="));
    assert.ok(session.includes("Secure") && session.includes("HttpOnly"));
    const sessionToken = readSessionToken(session);
    const stored = await DB.prepare("SELECT * FROM portal_sessions WHERE token_hash = ?").bind(await hashSessionToken(sessionToken)).first();
    assert.equal(stored.provider, "entra");
    assert.equal(stored.user_id, "synthetic-user");
    assert.deepEqual(JSON.parse(stored.roles_snapshot_json), ["user"]);
    assert.ok(!JSON.stringify(stored).includes(token));
    const revoked = await DB.prepare("SELECT revoked_at FROM portal_sessions WHERE token_hash = ?").bind(await hashSessionToken(oldToken)).first();
    assert.equal(revoked.revoked_at, now.toISOString());
    const replay = await handleEntraCallback(callback, environment, { now, database: DB, ...network });
    assert.equal(replay.headers.get("location"), `${config.origin}/login?entra=login-failed`);
    assert.equal(exchanges.length, 1, "replay rejected before a second token exchange");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM portal_user_roles").first()).count, 1);
  } finally { close(); }
});

test("callback consumes state before provider failure and exposes no upstream error or token", async () => {
  const { DB, close } = await database();
  try {
    const { request } = await flowRequest();
    let calls = 0;
    const options = { now, database: DB, fetch: async () => { calls++; return Response.json({ error: "secret-provider-diagnostic" }, { status: 400 }); } };
    const response = await handleEntraCallback(request, environment, options);
    assert.equal(response.headers.get("location"), `${config.origin}/login?entra=login-failed`);
    assert.equal(await response.text(), "");
    await handleEntraCallback(request, environment, options);
    assert.equal(calls, 1);
  } finally { close(); }
});

test("valid identity without provisioning receives only a constant access-denied redirect", async () => {
  const { DB, close } = await database();
  try {
    const { request, nonce } = await flowRequest();
    const response = await handleEntraCallback(request, environment, { now, database: DB, ...networkFor(await sign(nonce)).network });
    assert.equal(response.headers.get("location"), `${config.origin}/login?entra=access-not-assigned`);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM portal_users").first()).count, 0);
  } finally { close(); }
});
