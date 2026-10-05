import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./ci-release.mjs", import.meta.url).href;
const sourceSha = "a".repeat(40);
const digest = "b".repeat(64);
function environment() {
  return {
    RELEASE_SHA: sourceSha, RELEASE_ENVIRONMENT: "production", DGITA_DEPLOYMENT_ENABLED: "true", DGITA_PRODUCTION_APPROVED: "true",
    VERCEL_TOKEN: "synthetic-fixture", VERCEL_ORG_ID: "team_fixture", VERCEL_PROJECT_ID: "prj_fixture",
    DEPLOYMENT_URL: "https://dgita-fixture.vercel.app", ARTIFACT_SHA: digest, GITHUB_RUN_ID: "1234", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "owner/repo", GH_TOKEN: "synthetic-fixture",
  };
}
function deployment() {
  return { id: "dpl_fixture", projectId: "prj_fixture", readyState: "READY", target: "production", meta: { dgitaSourceSha: sourceSha, dgitaArtifactSha: digest, dgitaWorkflowRun: "1234", dgitaEnvironment: "production" } };
}
function execute(mode, env = environment(), data = deployment()) {
  const code = `globalThis.fetch = async (url) => { if (!new URL(url).hostname.endsWith('vercel.com')) throw new Error('Unexpected network host'); return Response.json(${JSON.stringify(data)}); }; process.argv[2] = ${JSON.stringify(mode)}; await import(${JSON.stringify(script)});`;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], { env, encoding: "utf8" });
}

test("deployment guard accepts the verified staged production artifact", () => {
  const result = execute("deployment"); assert.equal(result.status, 0, result.stderr);
});
test("deployment guard rejects different projects, commits, digests, runs and previews", () => {
  const changes = [
    (d) => { d.projectId = "prj_other"; },
    (d) => { d.target = "preview"; },
    (d) => { d.readyState = "BUILDING"; },
    (d) => { d.meta.dgitaSourceSha = "c".repeat(40); },
    (d) => { d.meta.dgitaArtifactSha = "d".repeat(64); },
    (d) => { d.meta.dgitaWorkflowRun = "5678"; },
    (d) => { d.meta.dgitaEnvironment = "pilot"; },
  ];
  for (const change of changes) { const data = deployment(); change(data); assert.notEqual(execute("deployment", environment(), data).status, 0); }
});
test("release guard rejects missing approvals, partial hashes, untrusted URLs and credentials", () => {
  for (const change of [
    (e) => { delete e.DGITA_DEPLOYMENT_ENABLED; },
    (e) => { delete e.DGITA_PRODUCTION_APPROVED; },
    (e) => { e.RELEASE_SHA = "abcdef"; },
    (e) => { e.DEPLOYMENT_URL = "https://attacker.example"; },
    (e) => { e.DEPLOYMENT_URL = "https://dgita-fixture.vercel.app@attacker.example"; },
    (e) => { delete e.VERCEL_TOKEN; },
  ]) { const env = environment(); change(env); assert.notEqual(execute("deployment", env).status, 0); }
});
test("source guard rejects an unprotected branch and unsuccessful exact-commit CI", () => {
  for (const scenario of ["unprotected", "wrong-ancestor", "failed-ci", "missing-gate", "valid"]) {
    const responses = [
      { protected: scenario !== "unprotected", commit: { sha: sourceSha } },
      { merge_base_commit: { sha: scenario === "wrong-ancestor" ? "c".repeat(40) : sourceSha } },
      { workflow_runs: [{ id: 10, head_sha: sourceSha, head_branch: "main", event: "push", status: "completed", conclusion: scenario === "failed-ci" ? "failure" : "success" }] },
      { jobs: scenario === "missing-gate" ? [] : [{ name: "Required quality gate", conclusion: "success" }] },
    ];
    const code = `const results=${JSON.stringify(responses)}; globalThis.fetch=async()=>Response.json(results.shift()); process.argv[2]='source'; await import(${JSON.stringify(script)});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { env: environment(), encoding: "utf8" });
    if (scenario === "valid") assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0);
  }
});
