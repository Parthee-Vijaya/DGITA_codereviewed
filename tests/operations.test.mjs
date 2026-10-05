import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { portalSchemaStatements } from "../db/persistence.ts";
import { persistJobHeartbeat, HEARTBEAT_SCOPE } from "../features/operations/store.ts";
import { readOperationsStatus } from "../features/operations/status.ts";
import { operationsThresholds } from "../features/operations/policy.ts";
import { deliverOperationalAlarm } from "../features/operations/alarms.ts";
import { runScheduledMaintenance } from "../features/runtime/scheduled-maintenance.ts";
import { createOperationalLogger } from "../features/privacy/operational-log.ts";
import { scanUploadBytes } from "../features/application/malware-scan.ts";

function adapter(database) {
  return { prepare(sql) {
    const statement = database.prepare(sql);
    const wrap = (args = []) => ({
      bind: (...values) => wrap(values),
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    });
    return wrap();
  } };
}
function fixture(filename = ":memory:") {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys=ON");
  for (const sql of portalSchemaStatements) database.exec(sql);
  database.exec(`INSERT INTO portal_tenants(id,slug,name) VALUES ('test-one','test-one','Testkommune 1'),('test-two','test-two','Testkommune 2');
    INSERT INTO portal_users(id,tenant_id,identity_provider,external_subject,email,display_name)
    VALUES ('test-admin','test-one','dev','test-admin','admin@example.invalid','Testadministrator');
    INSERT INTO portal_user_roles(id,tenant_id,user_id,role) VALUES ('test-role','test-one','test-admin','admin')`);
  return { database, DB: adapter(database) };
}
const actor = { userId: "test-admin", subject: "test-admin", tenantId: "test-one", role: "admin", provider: "dev" };
const success = { schemaVersion: 1, status: "completed", durationMs: 30, configured: true, cleanupFailed: false };
const now = "2026-10-05T12:00:00.000Z";
const emptyCleanup = { pendingQuarantined: 0, verifyingDiscarded: 0, blobsDeleted: 0, blobsPendingRetry: 0 };
const emptyMail = { configured: true, tenants: 1, processed: 0, failed: 0, queueAgeSeconds: 0 };
const alarm = { jobFailed: true, cleanupFailed: false, queueLate: false, telemetryFailed: false, durationMs: 10 };

async function sink(handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) { body += chunk; if (body.length > 4096) { request.destroy(); return; } }
    requests.push({ json: JSON.parse(body), authorized: request.headers.authorization === `Bearer ${"x".repeat(32)}` });
    if (handler) handler(response); else { response.writeHead(204); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { requests, environment: { DGITA_ENVIRONMENT: "local", DGITA_OPERATIONS_ALARM_URL: `http://127.0.0.1:${server.address().port}/alarm`, DGITA_OPERATIONS_ALARM_TOKEN: "x".repeat(32) },
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

test("durable heartbeat survives reopen, preserves newer failure and never writes under recovery quarantine", async () => {
  mkdirSync(new URL("../work/operations-tests/", import.meta.url), { recursive: true });
  const directory = mkdtempSync(new URL("../work/operations-tests/db-", import.meta.url));
  const filename = resolve(directory, "metrics.sqlite");
  let { database, DB } = fixture(filename);
  try {
    const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
    await persistJobHeartbeat(DB, { ...success, rawError: canary }, now);
    database.close(); database = new DatabaseSync(filename); DB = adapter(database);
    const saved = database.prepare("SELECT version FROM portal_bootstrap_state WHERE tenant_id='test-one' AND scope=?").get(HEARTBEAT_SCOPE);
    assert.equal(JSON.stringify(saved).includes(canary), false);
    assert.deepEqual(JSON.parse(saved.version), success);
    await persistJobHeartbeat(DB, { ...success, status: "failed" }, now);
    assert.equal((await persistJobHeartbeat(DB, success, now)).status, "superseded");
    assert.equal((await persistJobHeartbeat(DB, success, "2026-10-05T11:00:00.000Z")).status, "superseded");
    assert.equal(JSON.parse(database.prepare("SELECT version FROM portal_bootstrap_state WHERE tenant_id='test-one' AND scope=?").get(HEARTBEAT_SCOPE).version).status, "failed");
    database.exec("INSERT INTO portal_bootstrap_state(tenant_id,scope,version) VALUES ('test-one','recovery-quarantine','synthetic')");
    await assert.rejects(persistJobHeartbeat(DB, success, "2026-10-05T13:00:00.000Z"));
    assert.equal(database.prepare("SELECT MAX(completed_at) AS last FROM portal_bootstrap_state WHERE scope=?").get(HEARTBEAT_SCOPE).last, now);
    await assert.rejects(readOperationsStatus(DB, actor, {}, Date.parse(now)), { status: 403 });
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("operator status uses live admin mandate and exposes only own tenant aggregates", async () => {
  const { database, DB } = fixture();
  try {
    const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
    for (const [id, tenant, status, error] of [["one", "test-one", "queued", null], ["two", "test-one", "failed", "MAIL_DELIVERY_STATE_UNKNOWN"], ["foreign", "test-two", "queued", null]]) {
      database.prepare(`INSERT INTO portal_mail_outbox(id,tenant_id,recipient_email,template_key,subject,text_body,html_body,idempotency_key,status,last_error,created_at)
        VALUES (?,?,?,'test',?,?,?, ?,?,?, '2026-10-05T11:40:00.000Z')`).run(id, tenant, canary, canary, canary, canary, id, status, error);
    }
    await persistJobHeartbeat(DB, success, "2026-10-05T11:00:00.000Z");
    const result = await readOperationsStatus(DB, actor, { DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS: "1800", DGITA_MAIL_QUEUE_ALARM_SECONDS: "600" }, Date.parse(now));
    assert.equal(result.mail.unresolved, 2); assert.equal(result.mail.uncertain, 1); assert.equal(result.mail.queueAgeSeconds, 1200);
    assert.equal(result.job.missing, true); assert.equal(result.mail.queueLate, true);
    assert.equal(result.backup.status, "unknown");
    assert.equal(JSON.stringify(result).includes(canary), false);
    assert.equal(JSON.stringify(result).includes("test-two"), false);
    await assert.rejects(readOperationsStatus(DB, { ...actor, role: "user" }, {}, Date.parse(now)), { status: 403 });
    await assert.rejects(readOperationsStatus(DB, { ...actor, tenantId: "test-two" }, {}, Date.parse(now)), { status: 403 });
    database.exec("DELETE FROM portal_user_roles WHERE id='test-role'");
    await assert.rejects(readOperationsStatus(DB, actor, {}, Date.parse(now)), { status: 403 });
  } finally { database.close(); }
});

test("missing or invalid interval and queue thresholds remain unknown rather than inventing an SLO", async () => {
  const { database, DB } = fixture();
  try {
    await persistJobHeartbeat(DB, success, "2026-10-01T11:00:00.000Z");
    for (const environment of [{}, { DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS: "-1", DGITA_MAIL_QUEUE_ALARM_SECONDS: "bad" }]) {
      const result = await readOperationsStatus(DB, actor, environment, Date.parse(now));
      assert.equal(result.job.missing, "unknown"); assert.equal(result.mail.queueLate, "unknown");
      assert.equal(result.scanner.historicalFailureTotal, "unknown");
    }
    database.prepare("DELETE FROM portal_bootstrap_state WHERE scope=?").run(HEARTBEAT_SCOPE);
    const absent = await readOperationsStatus(DB, actor, { DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS: "86400" }, Date.parse(now));
    assert.equal(absent.job.missing, true); assert.equal(absent.job.observation, "not_observed");
    assert.deepEqual(operationsThresholds({ DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS: "86400" }), { expectedJobIntervalSeconds: 86400, queueAlarmSeconds: null });
  } finally { database.close(); }
});

test("scanner failure metrics contain outcome and time but never provider/token/document data", async () => {
  const lines = [];
  const log = createOperationalLogger((line) => lines.push(line));
  const bytes = new TextEncoder().encode(`synthetic-private-${crypto.randomUUID()}`);
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const secret = "synthetic-private-token-" + "x".repeat(32);
  const environment = { DGITA_ENVIRONMENT: "production", DGITA_MALWARE_SCAN_URL: "https://scanner.example.invalid/scan", DGITA_MALWARE_SCAN_TOKEN: secret };
  await assert.rejects(scanUploadBytes(bytes, checksum, environment, { log, fetch: async () => { throw new Error(secret); } }), { code: "MALWARE_SCAN_UNAVAILABLE" });
  await assert.rejects(scanUploadBytes(bytes, checksum, environment, { log, timeoutMs: 5, fetch: async () => new Promise(() => {}) }), { code: "MALWARE_SCAN_UNAVAILABLE" });
  assert.equal(await scanUploadBytes(bytes, checksum, environment, { log, fetch: async () => Response.json({ verdict: "clean", sha256: checksum }) }), "clean");
  assert.deepEqual(lines.map((line) => JSON.parse(line).event), ["scanner.failed", "scanner.failed", "scanner.completed"]);
  assert.equal(lines.join().includes(secret), false); assert.equal(lines.join().includes(new TextDecoder().decode(bytes)), false);
  assert.equal(lines.join().includes(checksum), false);
});

test("an actual local HTTP test sink receives a redacted alarm and transport faults remain bounded", async () => {
  const target = await sink();
  try {
    const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
    assert.equal(await deliverOperationalAlarm({ ...alarm, rawError: canary }, target.environment), "delivered");
    assert.equal(target.requests.length, 1); assert.equal(target.requests[0].authorized, true);
    assert.equal(JSON.stringify(target.requests).includes(canary), false);
    assert.equal(JSON.stringify(target.requests).includes(target.environment.DGITA_OPERATIONS_ALARM_TOKEN), false);
    assert.equal(await deliverOperationalAlarm(alarm, { ...target.environment, DGITA_ENVIRONMENT: "production" }), "invalid_configuration");
    assert.equal(await deliverOperationalAlarm(alarm, {}), "not_configured");
    assert.equal(await deliverOperationalAlarm(alarm, { ...target.environment, DGITA_OPERATIONS_ALARM_URL: target.environment.DGITA_OPERATIONS_ALARM_URL + "?secret=blocked" }), "invalid_configuration");
  } finally { await target.close(); }
  const hanging = await sink(() => {});
  try {
    const started = performance.now();
    assert.equal(await deliverOperationalAlarm(alarm, { ...hanging.environment, DGITA_OPERATIONS_ALARM_TIMEOUT_MS: "100" }), "failed");
    assert.ok(performance.now() - started < 3000);
  } finally { await hanging.close(); }
});

test("DB telemetry outage reports an alarm and preserves mail execution without disclosing the error", async () => {
  const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`; const lines = []; let mailCalls = 0; let notice;
  const result = await runScheduledMaintenance({ cleanup: async () => emptyCleanup, mail: async () => { mailCalls++; return emptyMail; },
    persist: async () => { throw new Error(canary); }, environment: async () => ({}),
    notify: async (input) => { notice = input; return "delivered"; }, log: createOperationalLogger((line) => lines.push(line)) });
  assert.equal(mailCalls, 1); assert.equal(result.telemetryPersisted, false); assert.equal(result.alarm, true);
  assert.equal(notice.telemetryFailed, true); assert.equal(JSON.stringify(result).includes(canary), false); assert.equal(lines.join().includes(canary), false);
});

test("50 concurrent synthetic jobs preserve heartbeat and deliver each expected local fault alarm", async () => {
  const { database, DB } = fixture(); const target = await sink(); const durations = []; const lines = [];
  try {
    let mailCalls = 0; let cleanupCalls = 0;
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => (async () => {
      const localStart = performance.now();
      const result = await runScheduledMaintenance({
        cleanup: async () => { cleanupCalls++; if (index % 7 === 0) throw new Error("Synthetic cleanup fault"); return emptyCleanup; },
        mail: async () => { mailCalls++; await new Promise((done) => setTimeout(done, index % 3)); return { ...emptyMail, failed: index % 5 === 0 ? 1 : 0 }; },
        persist: (record, completedAt) => persistJobHeartbeat(DB, record, completedAt),
        environment: async () => ({ ...target.environment, DGITA_MAIL_QUEUE_ALARM_SECONDS: "600" }),
        log: createOperationalLogger((line) => lines.push(line)),
      });
      durations.push(performance.now() - localStart); return result;
    })()));
    const expectedAlarms = Array.from({ length: 50 }, (_, index) => index).filter((index) => index % 5 === 0 || index % 7 === 0).length;
    assert.equal(cleanupCalls, 50); assert.equal(mailCalls, 50);
    assert.equal(results.filter((item) => item.alarm).length, expectedAlarms);
    assert.equal(target.requests.length, expectedAlarms); assert.equal(target.requests.every((item) => item.authorized), true);
    assert.equal(results.every((item) => ["written", "superseded"].includes(item.telemetryStatus)), true);
    assert.equal(results.every((item) => item.telemetryPersisted === (item.telemetryStatus === "written")), true);
    assert.equal(database.prepare("SELECT count(*) AS n FROM portal_bootstrap_state WHERE scope=?").get(HEARTBEAT_SCOPE).n, 2);
    const sorted = durations.toSorted((a, b) => a - b);
    const evidence = { schemaVersion: 1, scope: "local_synthetic_50_calls", calls: 50, mailCalls, cleanupCalls, expectedAlarms,
      observedHttpAlarms: target.requests.length, totalDurationMs: Math.ceil(performance.now() - started),
      p95DurationMs: Math.ceil(sorted[Math.ceil(sorted.length * .95) - 1]), maxDurationMs: Math.ceil(sorted.at(-1)),
      realProviderCapacityVerified: false, productionApproval: false };
    mkdirSync(new URL("../work/operations-tests/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../work/operations-tests/load-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
    assert.equal(lines.some((line) => line.includes("Synthetic cleanup fault")), false);
  } finally { database.close(); await target.close(); }
});


test("the operator endpoint rejects anonymous callers with a non-cacheable response", async () => {
  const { GET } = await import("../app/api/operations/status/route.ts");
  const response = await GET(new Request("http://localhost/api/operations/status"));
  assert.equal(response.status, 401);
  assert.ok(response.headers.get("Cache-Control").includes("no-store"));
  assert.equal((await response.json()).code, "AUTH_REQUIRED");
});


test("a tenantless heartbeat write is not reported as persisted", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const sql of portalSchemaStatements) database.exec(sql);
    await assert.rejects(persistJobHeartbeat(adapter(database), success, now));
  } finally { database.close(); }
});
