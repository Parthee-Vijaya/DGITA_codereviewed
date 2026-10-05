import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { EVIDENCE_SUITES, buildReleaseEvidence, evidenceCsv, redactTestSummary, validateControlRegister } from "../scripts/evidence-contract.mjs";
import redactedReporter from "../scripts/redacted-test-reporter.mjs";

const register = JSON.parse(readFileSync(new URL("../docs/governance/control-register.json", import.meta.url), "utf8"));
const source = { commit: "a".repeat(40), clean: true, node_version: "24.19.0", register_sha256: "b".repeat(64) };
const summary = { success: true, counts: { tests: 3, passed: 3, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 }, duration_ms: 123.5 };
const generatedAt = "2026-10-05T00:00:00.000Z";

test("selected controls have a risk, implementation or gap, proposed owner and valid source references", () => {
  validateControlRegister(register);
  for (const control of register.controls) {
    for (const path of [...control.implementation_refs, ...control.test_refs]) {
      assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
    }
  }
  for (const paths of Object.values(EVIDENCE_SUITES)) {
    for (const path of paths) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  }
});

test("reference-only evidence never implies an executed test or municipal acceptance", () => {
  const report = buildReleaseEvidence({ register, source: { ...source, clean: false }, generatedAt });
  assert.equal(report.measurements.length, 0);
  assert.equal(report.production_approval, false);
  assert.equal(report.automatic_score_increase, false);
  assert.equal(report.controls.every((control) => control.test_references.every((ref) => ref.evidence === "reference_only_not_run")), true);
  assert.equal(report.controls.every((control) => control.organisational_acceptance === "U" && control.control_acceptance === "not_assessed"), true);
});

test("actual measurements map only to selected suite references and strip unrequested data", () => {
  const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
  const dirtyRegister = structuredClone(register);
  dirtyRegister.controls[0].risk = canary;
  dirtyRegister.controls[0].owner.proposal = canary;
  const report = buildReleaseEvidence({ register: dirtyRegister, source: { ...source, token: canary }, generatedAt,
    measurements: [{ id: "privacy", exit_code: 0, summary: { ...summary, stack: canary }, stdout: canary, url: canary }] });
  assert.equal(report.measurements[0].result, "passed");
  assert.equal(report.controls.find((control) => control.id === "DGITA-C03").test_references.every((ref) => ref.evidence === "executed_in_selected_suite"), true);
  assert.equal(report.controls.find((control) => control.id === "DGITA-C01").test_references.every((ref) => ref.evidence === "reference_only_not_run"), true);
  assert.equal(JSON.stringify(report).includes(canary), false);
  assert.equal(evidenceCsv(report).includes(canary), false);
  assert.equal(JSON.stringify(report).includes("Testbruger"), false);
});

test("failed, skipped and incomplete runs cannot become passing evidence; dirty source cannot be measured", () => {
  const build = (measurement, src = source) => buildReleaseEvidence({ register, source: src, measurements: [measurement], generatedAt });
  const failed = { id: "privacy", exit_code: 1, summary: { ...summary, success: false, counts: { ...summary.counts, passed: 2, failed: 1 } } };
  assert.equal(build(failed).measurements[0].result, "failed_or_incomplete");
  const skipped = { id: "privacy", exit_code: 0, summary: { ...summary, counts: { ...summary.counts, passed: 2, skipped: 1 } } };
  assert.equal(build(skipped).measurements[0].result, "failed_or_incomplete");
  assert.throws(() => build(failed, { ...source, clean: false }));
  assert.throws(() => build({ ...failed, id: "not-a-suite" }));
  assert.throws(() => redactTestSummary({ ...summary, counts: { ...summary.counts, tests: 5 } }));
  assert.throws(() => redactTestSummary({ ...summary, success: true, counts: { ...summary.counts, passed: 2, failed: 1 } }));
  assert.throws(() => buildReleaseEvidence({ register, source: { ...source, commit: "unverified" }, generatedAt }));
  const traversal = structuredClone(register);
  traversal.controls[0].implementation_refs = ["docs/../../private.txt"];
  assert.throws(() => validateControlRegister(traversal));
});

test("redacted reporter discards test names, assertion errors and raw stdout/stderr events", async () => {
  const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
  const events = [
    { type: "test:stdout", data: { message: canary } },
    { type: "test:stderr", data: { message: canary } },
    { type: "test:fail", data: { name: canary, error: canary } },
    { type: "test:summary", data: { ...summary, file: canary } },
    { type: "test:summary", data: { ...summary, file: undefined, secret: canary } },
  ];
  let output = "";
  for await (const chunk of redactedReporter(events)) output += chunk;
  assert.equal(output.includes(canary), false);
  assert.deepEqual(JSON.parse(output), redactTestSummary(summary));
});

test("real child failure is recorded while synthetic test title, stdout, stderr and error contents stay redacted", () => {
  const base = new URL("../work/evidence-tests/", import.meta.url);
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(new URL("run-", base));
  const path = resolve(directory, "canary.test.mjs");
  const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
  writeFileSync(path, `import test from 'node:test';\ntest(${JSON.stringify(canary)}, () => { console.log(${JSON.stringify(canary)}); console.error(${JSON.stringify(canary)}); throw new Error(${JSON.stringify(canary)}); });\n`);
  try {
    const run = spawnSync(process.execPath, ["--test", "--test-reporter", new URL("../scripts/redacted-test-reporter.mjs", import.meta.url).pathname, path], {
      encoding: "utf8", env: { TZ: "UTC" }, timeout: 15_000, maxBuffer: 100_000,
    });
    assert.equal(run.status, 1);
    assert.equal((run.stdout + run.stderr).includes(canary), false);
    const result = JSON.parse(run.stdout);
    assert.equal(result.success, false);
    assert.equal(result.counts.tests, 1);
    assert.equal(result.counts.failed, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
