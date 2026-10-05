import { previewRetention } from "../features/privacy/retention-preview.ts";

// This approval is deliberately a synthetic test input, not a municipal policy.
const synthetic = {
  now: "2026-10-05T12:00:00.000Z",
  legalHold: { state: "clear", reviewedAt: "2026-10-05T11:00:00.000Z", validUntil: "2026-10-06T11:00:00.000Z" },
  policy: {
    schemaVersion: "dgita-retention-policy-v1", version: "synthetic-v1", disposition: "review_only",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: "2027-01-01T00:00:00.000Z",
    approval: { state: "approved", policyVersion: "synthetic-v1", approvedAt: "2025-12-31T00:00:00.000Z", decisionReference: "SYNTHETIC-EXERCISE-001" },
    rules: [{ classification: "synthetic-procurement", retainDaysAfterClosure: 30 }],
  },
  caseEvidence: { status: "closed", closedAt: "2026-09-01T12:00:00.000Z", versionNumber: 2, snapshotSha256: "a".repeat(64), classification: "synthetic-procurement" },
};
const scenarios = [
  ["active-hold", { ...synthetic, legalHold: { state: "active" } }, "blocked"],
  ["unknown-hold", { ...synthetic, legalHold: { state: "unknown" } }, "blocked"],
  ["unknown-policy", { ...synthetic, policy: null }, "blocked"],
  ["unclosed-case", { ...synthetic, caseEvidence: { ...synthetic.caseEvidence, status: "under_review" } }, "blocked"],
  ["before-deadline", { ...synthetic, caseEvidence: { ...synthetic.caseEvidence, closedAt: "2026-10-01T12:00:00.000Z" } }, "retain"],
  ["elapsed-approved-synthetic-policy", synthetic, "review_proposal"],
];
const results = scenarios.map(([scenario, input, expected]) => {
  const result = previewRetention(input);
  return { scenario, expected, result, passed: result.action === expected && result.destructive === false };
});
process.stdout.write(JSON.stringify({ schema_version: 1, scope: "synthetic_calculation_only", municipal_policy_approved: false,
  database_access: false, destructive: false, results }, null, 2) + "\n");
if (results.some((result) => !result.passed)) process.exitCode = 1;
