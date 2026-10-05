/** Release evidence is an allowlisted projection, never a raw-log archive. */
export const EVIDENCE_SUITES = Object.freeze({
  privacy: Object.freeze([
    "tests/privacy-fixtures.test.mjs",
    "tests/privacy-inventory.test.mjs",
    "tests/privacy-logging.test.mjs",
    "tests/retention-preview.test.mjs",
  ]),
  governance: Object.freeze(["tests/governance-evidence.test.mjs"]),
});

const COUNT_KEYS = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites"];
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const sourcePath = (value) => typeof value === "string" && /^(?:features|app|db|scripts|tests|docs|\.github)\/[A-Za-z0-9_./\[\]-]{1,240}$/u.test(value) && !value.includes("..");
function invalid() { throw new Error("Invalid release evidence input."); }

export function redactTestSummary(summary) {
  if (!summary || typeof summary.success !== "boolean" || !summary.counts ||
      !Number.isFinite(summary.duration_ms) || summary.duration_ms < 0 || summary.duration_ms > 86_400_000) invalid();
  const counts = {};
  for (const key of COUNT_KEYS) {
    if (!count(summary.counts[key])) invalid();
    counts[key] = summary.counts[key];
  }
  if (counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo !== counts.tests) invalid();
  if (summary.success && (counts.failed > 0 || counts.cancelled > 0)) invalid();
  return { success: summary.success, counts, duration_ms: Math.round(summary.duration_ms) };
}

export function validateControlRegister(register) {
  if (register?.schema_version !== 1 || !Array.isArray(register.controls) || register.controls.length < 1 || register.controls.length > 200) invalid();
  const ids = new Set();
  for (const control of register.controls) {
    if (!/^DGITA-C\d{2,3}$/u.test(control.id) || ids.has(control.id)) invalid();
    ids.add(control.id);
    if (!Array.isArray(control.implementation_refs) || !Array.isArray(control.test_refs) ||
        [...control.implementation_refs, ...control.test_refs].some((path) => !sourcePath(path))) invalid();
    if (control.test_refs.some((path) => !path.endsWith(".test.mjs"))) invalid();
    if (control.owner?.appointed !== false || control.owner?.acceptance !== "U" || control.organisational_acceptance !== "U") invalid();
    if (typeof control.risk !== "string" || !control.risk || typeof control.control !== "string" || !control.control ||
        typeof control.owner.proposal !== "string" || !control.owner.proposal || typeof control.remaining_gap !== "string" || !control.remaining_gap ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(control.review?.technical_record_date) || control.review.human_review_date !== null) invalid();
  }
  return register;
}

export function buildReleaseEvidence({ register, source, measurements = [], generatedAt }) {
  validateControlRegister(register);
  if (!/^[a-f0-9]{40}$/u.test(source?.commit) || typeof source.clean !== "boolean" ||
      !digest(source.register_sha256) || !/^24\.\d+\.\d+$/u.test(source.node_version) ||
      typeof generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt)) invalid();
  if (!Array.isArray(measurements) || measurements.length > Object.keys(EVIDENCE_SUITES).length) invalid();
  const seen = new Set();
  const results = measurements.map((measurement) => {
    const files = EVIDENCE_SUITES[measurement.id];
    if (!files || seen.has(measurement.id) || !source.clean) invalid();
    seen.add(measurement.id);
    const summary = redactTestSummary(measurement.summary);
    if (!Number.isInteger(measurement.exit_code) || measurement.exit_code < 0 || measurement.exit_code > 255) invalid();
    const passed = measurement.exit_code === 0 && summary.success && summary.counts.tests > 0 &&
      summary.counts.passed === summary.counts.tests;
    return { id: measurement.id, kind: "executed_local_test", runner: "node-test", test_files: [...files],
      result: passed ? "passed" : "failed_or_incomplete", exit_code: measurement.exit_code, ...summary };
  });
  return {
    schema_version: 1, generated_at: generatedAt,
    source: { commit: source.commit, clean: source.clean, node_version: source.node_version, register_sha256: source.register_sha256 },
    scope: "selected_local_synthetic_tests",
    external_acceptance: "U", production_approval: false, automatic_score_increase: false,
    measurements: results,
    controls: register.controls.map((control) => ({
      id: control.id,
      organisational_acceptance: "U", owner_status: "proposed_not_appointed",
      implementation_references: [...control.implementation_refs],
      test_references: control.test_refs.map((path) => {
        const run = results.find((item) => item.test_files.includes(path));
        return { path, evidence: run ? "executed_in_selected_suite" : "reference_only_not_run",
          ...(run ? { suite: run.id, suite_result: run.result } : {}) };
      }),
      // A passing suite is not a blanket acceptance of the mapped control.
      control_acceptance: "not_assessed",
    })),
    limits: ["No raw logs, test names, environment values, URLs, tokens or personal records are exported.",
      "Source references are not executed evidence; suite results are aggregate local measurements.",
      "No live CI, SARIF, cloud integration, municipal acceptance or certification was verified by this generator."],
  };
}

export function evidenceCsv(evidence) {
  const rows = [["control_id", "test_reference", "evidence_kind", "suite", "suite_result", "organisational_acceptance"]];
  for (const control of evidence.controls) {
    const refs = control.test_references.length ? control.test_references : [{ path: "", evidence: "no_test_reference" }];
    for (const ref of refs) rows.push([control.id, ref.path, ref.evidence, ref.suite ?? "", ref.suite_result ?? "", "U"]);
  }
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
}
