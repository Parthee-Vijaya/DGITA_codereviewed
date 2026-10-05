import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.argv[2];
if (!["e2e", "production"].includes(mode)) throw new Error("Usage: node scripts/ci-server.mjs e2e|production");
const project = resolve(import.meta.dirname, "..");
const output = join(project, "work", "ci", mode);
const temporary = await mkdtemp(join(tmpdir(), `dgita-ci-${mode}-`));
const workspace = join(temporary, "workspace");
const children = new Set();
let cleaned = false;
let serverLog;
let testLog;

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
  const excluded = new Set([".git", "node_modules", "work", "outputs", ".wrangler", ".vinext", "dist", ".vercel", ".codex", ".claude"]);
  if (mode === "e2e") excluded.add(".next");
  await cp(project, workspace, {
    recursive: true,
    filter(path) {
      const segments = relative(project, path).split(sep);
      if (segments.some((part) => excluded.has(part))) return false;
      if (segments[0] === ".next" && segments[1] === "cache") return false;
      // Do not copy local credentials, database state, or developer env files.
      return !/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/u.test(basename(path));
    },
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
    NODE_ENV: mode === "production" ? "production" : "development",
    NEXT_TELEMETRY_DISABLED: "1",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_WRITE_LOGS: "false",
    DGITA_APP_ORIGIN: origin,
    NEXT_PUBLIC_SITE_URL: origin,
    DGITA_E2E_BASE_URL: origin,
    DGITA_ENABLE_DEV_LOGIN: mode === "e2e" ? "true" : "false",
    DGITA_ENVIRONMENT: mode === "e2e" ? "pilot" : "production",
    DGITA_APPROVAL_TOKEN_SECRET: randomBytes(32).toString("hex"),
  };
  if (mode === "e2e") {
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
  const server = mode === "e2e"
    ? launch("npm", ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"], serverLog)
    : launch(process.execPath, [join(project, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port), "--hostname", "127.0.0.1"], serverLog);
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
  if (mode === "e2e") {
    testLog = createWriteStream(join(output, "tests.log"));
    const tests = launch("npm", ["run", "test:e2e"], testLog);
    const result = await new Promise((done) => {
      const timeout = setTimeout(() => { stopProcess(tests); done({ timeout: true }); }, 240_000);
      tests.once("error", (error) => { clearTimeout(timeout); done({ error }); });
      tests.once("exit", (code, signal) => { clearTimeout(timeout); done({ code, signal }); });
    });
    assert.equal(result.code, 0, `E2E failed (${JSON.stringify(result)}); inspect work/ci/e2e/tests.log`);
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
  await writeFile(join(output, "result.json"), JSON.stringify({ mode, status: "failed", runtime: process.version }, null, 2));
  throw error;
} finally {
  await cleanup();
}
