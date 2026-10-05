import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

const mode = process.argv[2];
const environment = process.env;
const sourceSha = environment.RELEASE_SHA ?? "";
const target = environment.RELEASE_ENVIRONMENT;
assert.match(sourceSha, /^[a-f0-9]{40}$/u, "Release requires a complete lowercase commit SHA.");
assert.ok(["pilot", "production"].includes(target), "Choose pilot or production.");
async function output(name, value) {
  assert.ok(!String(value).includes("\n"));
  if (environment.GITHUB_OUTPUT) await appendFile(environment.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${environment.GITHUB_REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${environment.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, `GitHub release validation failed: HTTP ${response.status}`);
  return response.json();
}
async function requireVerifiedSource() {
  assert.equal(environment.GITHUB_REF, "refs/heads/main", "Run the release workflow from main.");
  assert.match(environment.GITHUB_REPOSITORY ?? "", /^[\w.-]+\/[\w.-]+$/u);
  const branch = await github("branches/main");
  assert.equal(branch.protected, true, "main must be protected before deployment.");
  const comparison = await github(`compare/${sourceSha}...${branch.commit.sha}`);
  assert.equal(comparison.merge_base_commit?.sha, sourceSha, "Release commit must belong to main.");
  const history = await github(`actions/workflows/ci.yml/runs?head_sha=${sourceSha}&event=push&branch=main&per_page=100`);
  const run = history.workflow_runs.filter((item) => item.head_sha === sourceSha && item.head_branch === "main" && item.event === "push").sort((a, b) => b.id - a.id)[0];
  assert.ok(run && run.status === "completed" && run.conclusion === "success", "Latest main CI run for this exact commit must succeed.");
  const jobs = await github(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  assert.ok(jobs.jobs.some((job) => job.name === "Required quality gate" && job.conclusion === "success"), "Required quality gate is missing or unsuccessful.");
  await output("sha", sourceSha);
  await output("ci_run", String(run.id));
  console.log(`Verified release source ${sourceSha}; quality run ${run.id}.`);
}
function requireDeploymentConfiguration() {
  assert.equal(environment.DGITA_DEPLOYMENT_ENABLED, "true", "Configure and explicitly enable this GitHub deployment environment first.");
  assert.ok(environment.VERCEL_TOKEN, "Missing environment-scoped VERCEL_TOKEN.");
  assert.match(environment.VERCEL_ORG_ID ?? "", /^[\w-]+$/u, "Missing VERCEL_ORG_ID.");
  assert.match(environment.VERCEL_PROJECT_ID ?? "", /^prj_[\w-]+$/u, "Missing VERCEL_PROJECT_ID.");
  if (target === "production") assert.equal(environment.DGITA_PRODUCTION_APPROVED, "true", "Municipal production acceptance is required before deploying production code.");
}
async function readApplicationEnvironment() {
  const configuration = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
  assert.equal(configuration.DGITA_ENVIRONMENT, target, "Vercel project must have the matching explicit DGITA_ENVIRONMENT.");
  assert.equal(configuration.DGITA_ENABLE_DEV_LOGIN, target === "pilot" ? "true" : "false", "Pilot test login and production login isolation must be explicit.");
  assert.equal(new URL(configuration.DGITA_APP_ORIGIN).protocol, "https:");
  assert.ok(configuration.DGITA_APPROVAL_TOKEN_SECRET?.length >= 32, "Configure an approval-token secret.");
  assert.ok(configuration.TURSO_DATABASE_URL && configuration.TURSO_AUTH_TOKEN, "Configure the database.");
  assert.ok(configuration.BLOB_READ_WRITE_TOKEN || configuration.BLOB_STORE_ID, "Configure private Blob storage.");
  if (target === "pilot") assert.ok(configuration.DGITA_TEST_ACCESS_SECRET?.length >= 8, "Configure a pilot access code.");
  if (target === "production") {
    for (const key of ["DGITA_ENTRA_TENANT_ID", "DGITA_ENTRA_CLIENT_ID", "DGITA_ENTRA_CLIENT_SECRET", "DGITA_ENTRA_PORTAL_TENANT_ID", "DGITA_ENTRA_REDIRECT_URI", "DGITA_OIDC_STATE_SECRET"]) {
      assert.ok(configuration[key], `Configure production identity: ${key}`);
    }
    assert.notEqual(configuration.DGITA_ENABLE_DEMO_SEED, "true", "Demo seed cannot be enabled in production.");
  }
  if (target === "production") {
    execFileSync(process.execPath, ["scripts/check-production-config.mjs"], { env: { ...environment, ...configuration }, stdio: "inherit" });
  }
  return configuration;
}
async function verifyDeployment() {
  requireDeploymentConfiguration();
  const url = new URL(environment.DEPLOYMENT_URL);
  assert.ok(url.protocol === "https:" && /^[a-z0-9-]+\.vercel\.app$/u.test(url.hostname) && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && !url.port, "Unexpected deployment URL.");
  const query = new URLSearchParams({ teamId: environment.VERCEL_ORG_ID });
  const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(url.hostname)}?${query}`, {
    headers: { Authorization: `Bearer ${environment.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, `Vercel deployment lookup failed: HTTP ${response.status}`);
  const deployment = await response.json();
  assert.equal(deployment.projectId, environment.VERCEL_PROJECT_ID);
  assert.equal(deployment.readyState, "READY");
  assert.equal(deployment.target, "production", "Promote only staged production builds; previews can trigger a rebuild.");
  assert.equal(deployment.meta?.dgitaSourceSha, sourceSha);
  assert.equal(deployment.meta?.dgitaWorkflowRun, environment.GITHUB_RUN_ID);
  assert.equal(deployment.meta?.dgitaEnvironment, target);
  assert.match(environment.ARTIFACT_SHA ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(deployment.meta?.dgitaArtifactSha, environment.ARTIFACT_SHA);
  await output("deployment_id", deployment.id);
  return url.origin;
}
async function smoke() {
  const origin = await verifyDeployment();
  const config = await readApplicationEnvironment();
  const headers = environment.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": environment.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { ...headers, ...options.headers }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const health = await request("/api/healthz");
  assert.equal(health.status, 200, "Deployment liveness failed.");
  assert.deepEqual(await health.json(), { status: "ok" });
  const readiness = await request("/api/readyz");
  assert.equal(readiness.status, 200, "Configured deployment must pass database and schema readiness.");
  assert.deepEqual(await readiness.json(), { status: "ready" });
  const login = await request("/login");
  assert.equal(login.status, 200);
  assert.ok((await login.text()).includes("D-GITA"));
  const cases = await request("/api/cases");
  assert.equal(cases.status, 401);
  const testLogin = await request("/api/auth/dev-login", {
    method: "POST", headers: { Origin: config.DGITA_APP_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "user", ...(target === "pilot" ? { accessCode: config.DGITA_TEST_ACCESS_SECRET } : {}) }),
  });
  assert.equal(testLogin.status, target === "pilot" ? 200 : 403);
  const result = await testLogin.json();
  if (target === "pilot") assert.equal(result.authenticated, true);
  else assert.equal(result.code, "TEST_LOGIN_DISABLED");
  console.log(`Deployment smoke passed for ${target}; no credentials or session data logged.`);
}
async function artifactDigest() {
  const hash = createHash("sha256");
  async function visit(path, relative = "") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = `${relative}/${entry.name}`;
      hash.update(`${name}\0`);
      const child = join(path, entry.name);
      if (entry.isDirectory()) { hash.update("directory\0"); await visit(child, name); }
      else if (entry.isSymbolicLink()) hash.update(`link\0${await readlink(child)}\0`);
      else { hash.update("file\0"); hash.update(createHash("sha256").update(await readFile(child)).digest()); }
    }
  }
  await visit(".vercel/output");
  await output("artifact_sha", hash.digest("hex"));
}
if (mode === "source") await requireVerifiedSource();
else if (mode === "configuration") { requireDeploymentConfiguration(); }
else if (mode === "application-environment") await readApplicationEnvironment();
else if (mode === "artifact") await artifactDigest();
else if (mode === "deployment") await verifyDeployment();
else if (mode === "smoke") await smoke();
else throw new Error("Unknown release validation mode.");
