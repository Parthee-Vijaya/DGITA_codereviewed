import assert from "node:assert/strict";
import test from "node:test";
import { previewRetention } from "../features/privacy/retention-preview.ts";

const fixture = () => ({
  now: "2026-10-05T12:00:00.000Z",
  legalHold: { state: "clear", reviewedAt: "2026-10-05T11:00:00.000Z", validUntil: "2026-10-06T11:00:00.000Z" },
  policy: {
    schemaVersion: "dgita-retention-policy-v1", version: "synthetic-v1", disposition: "review_only",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: "2027-01-01T00:00:00.000Z",
    approval: { state: "approved", policyVersion: "synthetic-v1", approvedAt: "2025-12-31T00:00:00.000Z", decisionReference: "SYNTHETIC-EXERCISE-001" },
    rules: [{ classification: "synthetic-procurement", retainDaysAfterClosure: 30 }],
  },
  caseEvidence: { status: "closed", closedAt: "2026-09-01T12:00:00.000Z", versionNumber: 2, snapshotSha256: "a".repeat(64), classification: "synthetic-procurement" },
});

function expectBlocked(input, reason) {
  assert.deepEqual(previewRetention(input), { action: "blocked", destructive: false, reason });
}

test("active legal hold always blocks even with absent, unapproved or elapsed policy", () => {
  for (const policy of [undefined, { approval: { state: "draft" } }, fixture().policy]) {
    expectBlocked({ ...fixture(), policy, legalHold: { state: "active" } }, "LEGAL_HOLD_ACTIVE");
  }
});

test("unknown, absent, expired and future hold evidence fail closed", () => {
  for (const legalHold of [undefined, null, {}, { state: "unknown" }]) expectBlocked({ ...fixture(), legalHold }, "LEGAL_HOLD_UNKNOWN");
  for (const legalHold of [
    { state: "clear" },
    { state: "clear", reviewedAt: "2026-10-04T11:00:00.000Z", validUntil: fixture().now },
    { state: "clear", reviewedAt: "2026-10-06T11:00:00.000Z", validUntil: "2026-10-07T11:00:00.000Z" },
  ]) expectBlocked({ ...fixture(), legalHold }, "LEGAL_HOLD_REVIEW_STALE");
});

test("missing policy, draft approval and mismatched approved version cannot propose disposition", () => {
  expectBlocked({ ...fixture(), policy: undefined }, "POLICY_UNKNOWN");
  const draft = fixture(); draft.policy.approval.state = "draft"; expectBlocked(draft, "POLICY_NOT_APPROVED");
  const mismatch = fixture(); mismatch.policy.approval.policyVersion = "synthetic-v0"; expectBlocked(mismatch, "POLICY_VERSION_MISMATCH");
});

test("policy validity, explicit review-only purpose and complete decision metadata are required", () => {
  for (const change of [
    (p) => { p.disposition = "delete"; },
    (p) => { p.schemaVersion = "future-version"; },
    (p) => { delete p.approval.decisionReference; },
    (p) => { p.approval.approvedAt = "2028-01-01T00:00:00.000Z"; },
  ]) { const input = fixture(); change(input.policy); expectBlocked(input, "POLICY_INVALID"); }
  const expired = fixture(); expired.policy.effectiveUntil = expired.now; expectBlocked(expired, "POLICY_NOT_EFFECTIVE");
  const future = fixture(); future.policy.effectiveFrom = "2026-11-01T00:00:00.000Z"; expectBlocked(future, "POLICY_NOT_EFFECTIVE");
});

test("ambiguous classifications, default catchalls and invalid retention intervals are rejected", () => {
  for (const days of [-1, 1.5, 36_526, Infinity, "30"]) {
    const input = fixture(); input.policy.rules[0].retainDaysAfterClosure = days; expectBlocked(input, "POLICY_INVALID");
  }
  const duplicate = fixture(); duplicate.policy.rules.push({ ...duplicate.policy.rules[0] }); expectBlocked(duplicate, "POLICY_INVALID");
  const wildcard = fixture(); wildcard.policy.rules[0].classification = "*"; expectBlocked(wildcard, "POLICY_INVALID");
  const missing = fixture(); missing.caseEvidence.classification = "not-classified"; expectBlocked(missing, "CLASSIFICATION_NOT_COVERED");
});

test("current closed state, canonical close time and version evidence are mandatory", () => {
  for (const change of [
    (c) => { c.status = "draft"; },
    (c) => { delete c.closedAt; },
    (c) => { c.closedAt = "2026-11-01T00:00:00.000Z"; },
    (c) => { c.closedAt = "2026-02-30T00:00:00.000Z"; },
    (c) => { c.versionNumber = 0; },
    (c) => { c.snapshotSha256 = "not-a-hash"; },
  ]) { const input = fixture(); change(input.caseEvidence); expectBlocked(input, "CLOSURE_NOT_EVIDENCED"); }
});

test("deadline arithmetic is UTC and includes exact elapsed boundary without deleting", () => {
  const input = fixture(); input.policy.rules[0].retainDaysAfterClosure = 34;
  assert.deepEqual(previewRetention(input), { action: "review_proposal", reason: "REVIEW_REQUIRED", destructive: false,
    policyVersion: "synthetic-v1", eligibleAt: input.now });
  input.caseEvidence.closedAt = "2026-09-01T12:00:00.001Z";
  assert.equal(previewRetention(input).action, "retain");
  assert.equal(previewRetention(input).eligibleAt, "2026-10-05T12:00:00.001Z");
  const zero = fixture(); zero.policy.rules[0].retainDaysAfterClosure = 0;
  assert.equal(previewRetention(zero).action, "review_proposal");
});

test("malformed inputs, noncanonical time and executable getters are blocked without leaking contents", () => {
  for (const input of [undefined, null, [], "raw"]) expectBlocked(input, "INVALID_INPUT");
  for (const now of [undefined, "2026-10-05", "2026-10-05T14:00:00.000+02:00", "invalid"]) expectBlocked({ ...fixture(), now }, "INVALID_TIME");
  let getterCalled = false;
  const hostile = { ...fixture(), get extra() { getterCalled = true; throw new Error("private synthetic input"); } };
  expectBlocked(hostile, "INVALID_INPUT");
  assert.equal(getterCalled, false);
});

test("calculation is deterministic, side-effect free and omits synthetic case/person payloads", () => {
  const input = fixture();
  const canary = `synthetic-person-${crypto.randomUUID()}@example.invalid`;
  input.caseEvidence.person = canary; input.caseEvidence.content = canary; input.token = canary;
  const before = JSON.stringify(input);
  const first = previewRetention(input); const second = previewRetention(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(first).includes(canary), false);
  assert.equal(first.destructive, false);
});
