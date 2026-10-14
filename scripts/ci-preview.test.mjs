import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requirePreviewConfiguration, requirePreviewApplicationEnvironment } from "./ci-preview-policy.mjs";

const sourceSha = "a".repeat(40);
const digest = "b".repeat(64);
function policy() {
  return Object.fromEntries(["preview", "pilot", "production"].map((name) => [name, {
    projectId: `prj_${name}`, databaseUrl: `libsql://${name}.example.invalid`, blobStoreId: `store_${name}`, appOrigin: `https://${name}.vercel.app`,
  }]));
}
function environment() {
  return {
    RELEASE_SHA: sourceSha, RELEASE_ENVIRONMENT: "preview", DGITA_DEPLOYMENT_ENABLED: "true",
    VERCEL_TOKEN: "synthetic-fixture", VERCEL_ORG_ID: "team_fixture", VERCEL_PROJECT_ID: "prj_preview",
    DGITA_PREVIEW_ISOLATION_APPROVED: "true", DGITA_PREVIEW_RESOURCE_POLICY: JSON.stringify(policy()),
    DEPLOYMENT_URL: "https://preview.vercel.app", ARTIFACT_SHA: digest, GITHUB_RUN_ID: "1234",
  };
}
function configuration() {
  return {
    TURSO_DATABASE_URL: policy().preview.databaseUrl, BLOB_STORE_ID: "store_preview", DGITA_APP_ORIGIN: "https://preview.vercel.app", NEXT_PUBLIC_SITE_URL: "https://preview.vercel.app",
    DGITA_ENABLE_DEMO_SEED: "true", DGITA_MAIL_ALLOWED_RECIPIENTS: "",
  };
}
const project = { projectId: "prj_preview", orgId: "team_fixture" };
const fixture = fileURLToPath(new URL("./ci-release-fixture.mjs", import.meta.url));
function verifyDeployment(data, env = environment()) {
  return spawnSync(process.execPath, [fixture, "deployment"], { env, encoding: "utf8", input: JSON.stringify([data]) });
}
function deployment() {
  return { id: "dpl_fixture", projectId: "prj_preview", readyState: "READY", target: null, meta: { dgitaSourceSha: sourceSha, dgitaArtifactSha: digest, dgitaWorkflowRun: "1234", dgitaEnvironment: "preview" } };
}

test("preview accepts only explicitly inventoried isolated project, database, store and origin", () => {
  assert.equal(requirePreviewConfiguration(environment()).projectId, "prj_preview");
  requirePreviewApplicationEnvironment(environment(), configuration(), project);
  for (const key of ["projectId", "databaseUrl", "blobStoreId", "appOrigin"]) {
    for (const existing of ["pilot", "production"]) {
      const resources = policy(); resources.preview[key] = resources[existing][key];
      assert.throws(() => requirePreviewConfiguration({ ...environment(), DGITA_PREVIEW_RESOURCE_POLICY: JSON.stringify(resources) }), /different/u);
    }
  }
});
test("preview fails closed without approval, complete inventory or matching project", () => {
  for (const update of [
    { DGITA_PREVIEW_ISOLATION_APPROVED: "false" }, { DGITA_PREVIEW_RESOURCE_POLICY: "" },
    { DGITA_PREVIEW_RESOURCE_POLICY: "{}" }, { DGITA_PREVIEW_RESOURCE_POLICY: "null" },
    { DGITA_PREVIEW_RESOURCE_POLICY: JSON.stringify({ ...policy(), production: null }) },
    { VERCEL_PROJECT_ID: "prj_pilot" },
  ]) assert.throws(() => requirePreviewConfiguration({ ...environment(), ...update }));
});
test("preview compares actual pulled resources and denies credential-based Blob override", () => {
  for (const update of [
    { TURSO_DATABASE_URL: policy().pilot.databaseUrl }, { BLOB_STORE_ID: "store_production" },
    { DGITA_APP_ORIGIN: policy().pilot.appOrigin }, { NEXT_PUBLIC_SITE_URL: policy().pilot.appOrigin }, { BLOB_READ_WRITE_TOKEN: "synthetic-legacy-token" },
    { DGITA_ENABLE_DEMO_SEED: "false" }, { TURSO_DATABASE_URL: "file:/tmp/test.sqlite" },
    { TURSO_DATABASE_URL: "libsql://credentials@preview.example.invalid" },
    { DGITA_APP_ORIGIN: "https://preview.vercel.app@attacker.example.invalid" },
  ]) assert.throws(() => requirePreviewApplicationEnvironment(environment(), { ...configuration(), ...update }, project));
  for (const wrong of [{ ...project, projectId: "prj_pilot" }, { ...project, orgId: "team_other" }, null]) {
    assert.throws(() => requirePreviewApplicationEnvironment(environment(), configuration(), wrong));
  }
});
test("preview cannot activate existing mail, IAM, scanner or cron integrations", () => {
  for (const key of ["DGITA_GRAPH_CLIENT_SECRET", "DGITA_GRAPH_SENDER", "DGITA_ENTRA_CLIENT_ID", "DGITA_FK_ISSUER", "DGITA_MALWARE_SCAN_URL", "CRON_SECRET", "DGITA_MAIL_ALLOWED_RECIPIENTS"]) {
    const value = "synthetic-do-not-print";
    assert.throws(() => requirePreviewApplicationEnvironment(environment(), { ...configuration(), [key]: value }, project), (error) => !error.message.includes(value));
  }
});
test("preview deployment requires explicit preview target and exact project, SHA, digest and run", () => {
  const result = verifyDeployment(deployment());
  assert.equal(result.status, 0, result.stderr);
  for (const mutate of [
    (d) => { d.target = "production"; }, (d) => { d.target = "staging"; }, (d) => { delete d.target; },
    (d) => { d.projectId = "prj_pilot"; }, (d) => { d.readyState = "BUILDING"; },
    (d) => { d.meta.dgitaSourceSha = "c".repeat(40); }, (d) => { d.meta.dgitaArtifactSha = "d".repeat(64); },
    (d) => { d.meta.dgitaWorkflowRun = "5678"; }, (d) => { d.meta.dgitaEnvironment = "pilot"; },
  ]) { const data = deployment(); mutate(data); assert.notEqual(verifyDeployment(data).status, 0); }
});
test("preview URL output rejects injection, foreign hosts and credentials before writing", () => {
  const directory = mkdtempSync(join(tmpdir(), "dgita-preview-output-"));
  const output = join(directory, "output");
  const script = fileURLToPath(new URL("./ci-preview-url.mjs", import.meta.url));
  try {
    for (const value of ["https://preview.vercel.app\nurl=https://attacker.example", "https://preview.vercel.app\n", "https://attacker.example", "https://preview.vercel.app@attacker.example", "https://preview.vercel.app:443", "https://preview.vercel.app?anything"]) {
      writeFileSync(output, "");
      const result = spawnSync(process.execPath, [script], { env: { DEPLOYMENT_URL: value, GITHUB_OUTPUT: output }, encoding: "utf8" });
      assert.notEqual(result.status, 0); assert.equal(readFileSync(output, "utf8"), "");
    }
    const result = spawnSync(process.execPath, [script], { env: { DEPLOYMENT_URL: "https://preview.vercel.app", GITHUB_OUTPUT: output }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(readFileSync(output, "utf8"), "url=https://preview.vercel.app\n");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("application guard reads the preview file and rejects production runtime values", () => {
  const directory = mkdtempSync(join(tmpdir(), "dgita-preview-environment-"));
  const script = fileURLToPath(new URL("./ci-release.mjs", import.meta.url));
  const file = join(directory, ".vercel", ".env.preview.local");
  const config = { ...configuration(), DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_APPROVAL_TOKEN_SECRET: "synthetic-preview-secret-32-characters", TURSO_AUTH_TOKEN: "synthetic-database-token", DGITA_TEST_ACCESS_SECRET: "synthetic-test-code" };
  try {
    mkdirSync(join(directory, ".vercel"));
    writeFileSync(join(directory, ".vercel", "project.json"), JSON.stringify(project));
    // The old production file must never be used as a fallback.
    writeFileSync(join(directory, ".vercel", ".env.production.local"), "DGITA_ENVIRONMENT=production\n");
    const execute = () => spawnSync(process.execPath, [script, "application-environment"], { env: environment(), cwd: directory, encoding: "utf8" });
    for (const update of [{}, { DGITA_ENVIRONMENT: "production" }, { DGITA_ENABLE_DEV_LOGIN: "false" }, { DGITA_TEST_ACCESS_SECRET: "" }]) {
      writeFileSync(file, Object.entries({ ...config, ...update }).map(([key, value]) => `${key}=${value}`).join("\n"));
      const result = execute();
      if (Object.keys(update).length === 0) assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
    }
    rmSync(file);
    assert.notEqual(execute().status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("preview workflow keeps target selection and credentials out of user input and has no promotion path", () => {
  const workflow = readFileSync(new URL("../.github/workflows/preview-vercel.yml", import.meta.url), "utf8");
  assert.match(workflow, /RELEASE_ENVIRONMENT: preview/u);
  assert.match(workflow, /name: preview/u);
  assert.match(workflow, /pull --yes --environment=preview/u);
  assert.match(workflow, /deploy --prebuilt --skip-domain/u);
  assert.doesNotMatch(workflow, /--prod|--environment=production|\bpromote\b|inputs\.environment|--token=/u);
  assert.match(workflow, /ci-release\.mjs" source/u);
  assert.match(workflow, /DGITA_PREVIEW_RESOURCE_POLICY/u);
});
