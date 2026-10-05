import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { requireCodeqlEvidence } from "./ci-release-codeql.mjs";

const fixture = fileURLToPath(new URL("./ci-release-fixture.mjs", import.meta.url));
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
  return spawnSync(process.execPath, [fixture, mode], {
    env, encoding: "utf8", input: JSON.stringify(mode === "source" ? data : [data]),
  });
}
function codeqlResponses() {
  const analyses = ["javascript-typescript", "actions"].map((language, index) => ({
    id: index + 100, category: `/language:${language}`, commit_sha: sourceSha, ref: "refs/heads/main",
    tool: { name: "CodeQL" }, analysis_key: ".github/workflows/ci.yml:codeql", error: "", rules_count: 20, results_count: index === 0 ? 1 : 0,
  }));
  return [analyses, ...analyses.map((analysis) => ({
    version: "2.1.0", runs: [{
      tool: { driver: { name: "CodeQL" }, extensions: [{ rules: [{ id: "fixture/security", defaultConfiguration: { level: "warning" }, properties: { "security-severity": "6.3", tags: ["security"] } }] }] },
      automationDetails: { id: `${analysis.category}/` },
      versionControlProvenance: [{ branch: "refs/heads/main", revisionId: sourceSha, repositoryUri: "https://github.com/owner/repo" }],
      results: analysis.results_count ? [{ ruleId: "fixture/security", rule: { id: "fixture/security", index: 0, toolComponent: { index: 0 } }, level: "warning" }] : [],
    }],
  }))];
}
function verifyEvidence(responses) {
  return requireCodeqlEvidence(async (path, accept) => {
    assert.ok(responses.length > 0, "Unexpected API request.");
    if (/^code-scanning\/analyses\/\d+$/u.test(path)) assert.equal(accept, "application/sarif+json");
    return responses.shift();
  }, { sourceSha, repository: "owner/repo" });
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
test("deployment outputs reject control characters, invalid identifiers and non-string values before writing", () => {
  const directory = mkdtempSync(join(tmpdir(), "dgita-release-output-"));
  const outputPath = join(directory, "output");
  try {
    for (const id of ["dpl_fixture\ninjected=true", "dpl_fixture\rinjected=true", "dpl_fixture\n", "dpl_fixture\r", "dpl_fixture=bad", "https://attacker.example", null, {}]) {
      writeFileSync(outputPath, "");
      const result = execute("deployment", { ...environment(), GITHUB_OUTPUT: outputPath }, { ...deployment(), id });
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(outputPath, "utf8"), "");
    }
    const result = execute("deployment", { ...environment(), GITHUB_OUTPUT: outputPath });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(outputPath, "utf8"), "deployment_id=dpl_fixture\n");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("source guard rejects an unprotected branch and unsuccessful exact-commit CI", () => {
  for (const scenario of ["unprotected", "wrong-ancestor", "failed-ci", "invalid-run-id", "missing-gate", "valid"]) {
    const responses = [
      { protected: scenario !== "unprotected", commit: { sha: sourceSha } },
      { merge_base_commit: { sha: scenario === "wrong-ancestor" ? "c".repeat(40) : sourceSha } },
      { workflow_runs: [{ id: scenario === "invalid-run-id" ? "10\rspoof=true" : 10, head_sha: sourceSha, head_branch: "main", event: "push", status: "completed", conclusion: scenario === "failed-ci" ? "failure" : "success" }] },
      { jobs: scenario === "missing-gate" ? [] : [{ name: "Required quality gate", conclusion: "success" }] },
      ...codeqlResponses(),
    ];
    const result = execute("source", environment(), responses);
    if (scenario === "valid") assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0);
  }
});

test("release CodeQL gate accepts exact-commit evidence with medium findings", async () => {
  await verifyEvidence(codeqlResponses());
});
test("release CodeQL gate follows analysis pagination and uses the latest matching analysis", async () => {
  const responses = codeqlResponses();
  const unrelated = Array.from({ length: 100 }, () => ({ ...responses[0][0], commit_sha: "f".repeat(40) }));
  await verifyEvidence([unrelated, ...responses]);
  const older = codeqlResponses();
  older[0].unshift({ ...older[0][0], id: 102, error: "analysis failed" });
  await assert.rejects(verifyEvidence(older), /execution error/u);
});
test("release CodeQL gate requires both categories on main at the exact SHA", async () => {
  for (const change of [
    (a) => { a.pop(); },
    (a) => { a[0].commit_sha = "c".repeat(40); },
    (a) => { a[0].ref = "refs/pull/3/merge"; },
    (a) => { a[0].analysis_key = ".github/workflows/other.yml:scan"; },
    (a) => { a[0].tool.name = "Other"; },
  ]) {
    const responses = codeqlResponses(); change(responses[0]);
    await assert.rejects(verifyEvidence(responses), /Missing exact-commit/u);
  }
});
test("release CodeQL gate blocks high, critical and error results including dismissed historical findings", async () => {
  for (const change of [
    (run) => { run.tool.extensions[0].rules[0].properties["security-severity"] = "7.0"; },
    (run) => { run.tool.extensions[0].rules[0].properties["security-severity"] = "9.8"; run.results[0].suppressions = [{ kind: "external", status: "accepted" }]; },
    (run) => { run.results[0].level = "error"; },
    (run) => { delete run.results[0].level; run.tool.extensions[0].rules[0].defaultConfiguration.level = "error"; },
  ]) {
    const responses = codeqlResponses(); change(responses[1].runs[0]);
    await assert.rejects(verifyEvidence(responses), /blocks release/u);
  }
});
test("release CodeQL gate fails closed on malformed, incomplete or mismatched evidence", async () => {
  for (const change of [
    (r) => { r[0] = {}; },
    (r) => { r[0][0].error = "analysis failed"; },
    (r) => { r[0][0].rules_count = 0; },
    (r) => { r[0][0].results_count = 2; },
    (r) => { r[1].version = "unknown"; },
    (r) => { r[1].runs = []; },
    (r) => { r[1].runs[0].versionControlProvenance[0].revisionId = "d".repeat(40); },
    (r) => { r[1].runs[0].versionControlProvenance[0].branch = "refs/heads/other"; },
    (r) => { r[1].runs[0].versionControlProvenance[0].repositoryUri = "https://github.com/other/repo"; },
    (r) => { r[1].runs[0].automationDetails.id = "/language:other/"; },
    (r) => { r[1].runs[0].invocations = [{ executionSuccessful: false }]; },
    (r) => { delete r[1].runs[0].results; },
    (r) => { r[1].runs[0].results[0].rule.index = 999; },
    (r) => { r[1].runs[0].results[0].rule.toolComponent.index = 999; },
    (r) => { r[1].runs[0].tool.extensions[0].rules[0].properties["security-severity"] = "unknown"; },
    (r) => { delete r[1].runs[0].tool.extensions[0].rules[0].properties["security-severity"]; },
  ]) {
    const responses = codeqlResponses(); change(responses);
    await assert.rejects(verifyEvidence(responses));
  }
});
test("source validation fails on missing CodeQL evidence, denied API access and malformed API JSON", () => {
  for (const failure of [[], { __httpStatus: 403 }, { __httpStatus: 503 }, { __rawBody: "{" }]) {
    const responses = [
      { protected: true, commit: { sha: sourceSha } }, { merge_base_commit: { sha: sourceSha } },
      { workflow_runs: [{ id: 10, head_sha: sourceSha, head_branch: "main", event: "push", status: "completed", conclusion: "success" }] },
      { jobs: [{ name: "Required quality gate", conclusion: "success" }] }, failure,
    ];
    assert.notEqual(execute("source", environment(), responses).status, 0);
  }
});
test("release CodeQL gate fails closed when fetching evidence fails", async () => {
  await assert.rejects(requireCodeqlEvidence(async () => { throw new Error("Network unavailable"); }, { sourceSha, repository: "owner/repo" }), /Network unavailable/u);
});
