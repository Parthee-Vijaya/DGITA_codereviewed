import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { includeInTestWorkspace } from "./ci-workspace-policy.mjs";
import { startProviderFixtures } from "../tests/runtime/provider-server.mjs";

const mode = process.argv[2];
if (!["e2e", "a11y", "next-e2e", "production"].includes(mode)) throw new Error("Usage: node scripts/ci-server.mjs e2e|a11y|next-e2e|production");
const workflowTest = mode !== "production";
const workerRuntime = mode === "e2e" || mode === "a11y";
const project = resolve(import.meta.dirname, "..");
const output = join(project, "work", "ci", mode);
const temporary = await mkdtemp(join(tmpdir(), `dgita-ci-${mode}-`));
const workspace = join(temporary, "workspace");
const children = new Set();
let cleaned = false;
let serverLog;
let testLog;
let providers;

function stopProcess(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    // Detached process groups include npm's child server and workers.
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) stopProcess(child);
  await delay(500);
  for (const child of children) stopProcess(child, "SIGKILL");
  if (providers) await providers.close();
  await Promise.all([serverLog, testLog].filter(Boolean).map((stream) => new Promise((done) => stream.end(done))));
  await rm(temporary, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

try {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "result.json"), JSON.stringify({ mode, status: "running", runtime: process.version }, null, 2));
  await cp(project, workspace, {
    recursive: true,
    filter: (path) => includeInTestWorkspace(relative(project, path), workerRuntime),
  });
  await symlink(join(project, "node_modules"), join(workspace, "node_modules"), "dir");
  const port = await new Promise((done, fail) => {
    const socket = createServer();
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", () => {
      const assignedPort = socket.address().port;
      socket.close((error) => error ? fail(error) : done(assignedPort));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  // CI exercises synthetic fixtures with fresh secrets and has no production credentials.
  const environment = {
    PATH: process.env.PATH,
    TMPDIR: tmpdir(),
    CI: "true",
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(project, "node_modules", ".cache", "ms-playwright"),
    NODE_ENV: workerRuntime ? "development" : "production",
    NEXT_TELEMETRY_DISABLED: "1",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_WRITE_LOGS: "false",
    DGITA_APP_ORIGIN: origin,
    NEXT_PUBLIC_SITE_URL: origin,
    DGITA_E2E_BASE_URL: origin,
    DGITA_ENABLE_DEV_LOGIN: workflowTest ? "true" : "false",
    DGITA_ENVIRONMENT: workflowTest ? "pilot" : "production",
    DGITA_APPROVAL_TOKEN_SECRET: randomBytes(32).toString("hex"),
  };
  if (mode === "next-e2e") {
    providers = await startProviderFixtures(origin);
    Object.assign(environment, {
      TURSO_DATABASE_URL: `file:${join(temporary, "synthetic.sqlite")}`,
      TURSO_AUTH_TOKEN: "synthetic-database-token",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_fixture_synthetic",
      DGITA_FIXTURE_ORIGIN: providers.origin,
      DGITA_E2E_PROVIDER_FIXTURES: "true",
      CRON_SECRET: randomBytes(32).toString("hex"),
      DGITA_MALWARE_SCAN_URL: "https://scanner.example.invalid/scan",
      DGITA_MALWARE_SCAN_TOKEN: randomBytes(32).toString("hex"),
      DGITA_GRAPH_TENANT_ID: "fixture-tenant", DGITA_GRAPH_CLIENT_ID: "fixture-client",
      DGITA_GRAPH_CLIENT_SECRET: "synthetic-client-secret", DGITA_GRAPH_SENDER: "portal@example.invalid",
      DGITA_MAIL_ALLOWED_RECIPIENTS: Array.from({ length: 100 }, (_, index) => `user-${index}@example.invalid`).join(","),
    });
  }
  if (workerRuntime) {
    const workerKeys = ["DGITA_ENVIRONMENT", "DGITA_ENABLE_DEV_LOGIN", "DGITA_APPROVAL_TOKEN_SECRET", "DGITA_APP_ORIGIN", "NEXT_PUBLIC_SITE_URL"];
    await writeFile(join(workspace, ".dev.vars"), workerKeys.map((key) => `${key}=${JSON.stringify(environment[key])}`).join("\n") + "\n", { mode: 0o600 });
  }
  function launch(command, args, log) {
    const child = spawn(command, args, { cwd: workspace, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    // Observe spawn failures immediately without producing an unhandled event.
    child.once("error", (error) => { child.spawnError = error; });
    return child;
  }
  serverLog = createWriteStream(join(output, "server.log"));
  const server = workerRuntime
    ? launch("npm", ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"], serverLog)
    : launch(process.execPath, [...(mode === "next-e2e" ? ["--import", join(project, "tests/runtime/provider-dispatch.mjs")] : []), join(project, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], serverLog);
  const readyBy = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < readyBy) {
    if (server.spawnError || server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Server stopped before readiness. Inspect work/ci/${mode}/server.log`, { cause: server.spawnError });
    }
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3_000) });
      if (response.status === 200 && (await response.text()).includes("D-GITA")) { ready = true; break; }
    } catch { /* Continue until the readiness deadline or server exit. */ }
    await delay(500);
  }
  assert.ok(ready, `Server readiness timed out; inspect work/ci/${mode}/server.log`);
  if (workflowTest) {
    testLog = createWriteStream(join(output, "tests.log"));
    const tests = launch("npm", mode === "a11y" ? ["exec", "--", "playwright", "test"] : ["run", "test:e2e"], testLog);
    const result = await new Promise((done) => {
      const timeout = setTimeout(() => { stopProcess(tests); done({ timeout: true }); }, 240_000);
      tests.once("error", (error) => { clearTimeout(timeout); done({ error }); });
      tests.once("exit", (code, signal) => { clearTimeout(timeout); done({ code, signal }); });
    });
    if (mode === "a11y") await cp(join(workspace, "work", "ci", "a11y"), output, { recursive: true }).catch(() => undefined);
    assert.equal(result.code, 0, `E2E failed (${JSON.stringify(result)}); inspect work/ci/${mode}/tests.log`);
    if (providers) {
      const report = providers.evidence;
      assert.equal(report.unexpectedRequests, 0);
      for (const field of ["blobWrites", "directBlobWrites", "blobReads", "scanClean", "scanRejected", "scanUnavailable", "mailAccepted", "approvalLinks"]) assert.ok(report[field] > 0, `Provider contract was not exercised: ${field}`);
      await writeFile(join(output, "providers.json"), JSON.stringify({ type: "local HTTP fixtures; no cloud acceptance", ...report }, null, 2));
    }
  } else {
    const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const health = await request("/api/healthz");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.match(health.headers.get("cache-control") || "", /no-store/u);
    const readiness = await request("/api/readyz");
    assert.equal(readiness.status, 503, "Production without bindings must fail readiness.");
    const login = await request("/login");
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("x-content-type-options"), "nosniff");
    assert.equal(login.headers.get("x-frame-options"), "DENY");
    assert.match(login.headers.get("content-security-policy") || "", /frame-ancestors 'none'/u);
    const portal = await request("/");
    assert.equal(portal.status, 307);
    assert.equal(new URL(portal.headers.get("location"), origin).pathname, "/login");
    const cases = await request("/api/cases");
    assert.equal(cases.status, 401);
    assert.match(cases.headers.get("cache-control") || "", /no-store/u);
    const devLogin = await request("/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(devLogin.status, 403);
    assert.equal((await devLogin.json()).code, "TEST_LOGIN_DISABLED");
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ mode, status: "passed", runtime: process.version, completedAt: new Date().toISOString() }, null, 2));
  console.log(`${mode}: passed (isolated workspace, local server, synthetic data).`);
} catch (error) {
  if (providers) await writeFile(join(output, "providers.json"), JSON.stringify(providers.evidence, null, 2));
  await writeFile(join(output, "result.json"), JSON.stringify({ mode, status: "failed", runtime: process.version }, null, 2));
  throw error;
} finally {
  await cleanup();
}
