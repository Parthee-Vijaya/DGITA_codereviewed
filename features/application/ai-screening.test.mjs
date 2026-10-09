import assert from "node:assert/strict";
import test from "node:test";
import { demoApplicationState, initialApplicationState, legacyDemoApplicationState, getStepErrors, getStepWarnings, isFieldVisible, pruneHiddenAnswers } from "./engine.ts";
import { aiUsageLabel, hasAiScreeningDetails, isSafeAiAssessmentUrl, normalizeAiScreeningChanges } from "./ai-screening.ts";
import { isApplicationFormState, normalizePersistedApplicationFormState } from "./state-validation.ts";
import { normalizeApplicationSnapshotJson } from "../cases/detail-helpers.ts";

const state = (overrides = {}) => ({ ...structuredClone(demoApplicationState), ...overrides });
const errors = (draft) => getStepErrors(draft, 5).filter((error) => error.field.startsWith("ai"));

test("legacy AI answers remain unanswered and can still be saved without rewriting historical bytes", () => {
  const original = JSON.stringify(legacyDemoApplicationState);
  assert.equal(Object.hasOwn(legacyDemoApplicationState, "aiUsage"), false);
  assert.equal(isApplicationFormState(legacyDemoApplicationState), true);
  assert.equal(initialApplicationState.aiUsage, "");
  assert.equal(aiUsageLabel(undefined), "Ikke besvaret");
  for (let read = 0; read < 3; read += 1) {
    const detail = normalizeApplicationSnapshotJson(original, initialApplicationState);
    assert.equal(detail.aiUsage, "");
    assert.equal(detail.aiPurpose, "");
    assert.equal(detail.aiAssessmentUrl, "");
    const correction = normalizePersistedApplicationFormState(JSON.parse(original));
    assert.equal(correction.aiUsage, "");
    assert.equal(errors(correction)[0].field, "aiUsage");
  }
  assert.equal(JSON.stringify(legacyDemoApplicationState), original);
});

test("new submissions require an explicit answer and a manual purpose for Yes or Unknown", () => {
  for (const usage of [undefined, ""]) assert.equal(errors(state({ aiUsage: usage }))[0].field, "aiUsage");
  for (const aiUsage of ["ja", "ved-ikke"]) {
    const draft = state({ aiUsage, aiPurpose: " \t " });
    assert.equal(hasAiScreeningDetails(aiUsage), true);
    assert.equal(isFieldVisible("aiPurpose", draft), true);
    assert.deepEqual(errors(draft).map((error) => error.field), ["aiPurpose"]);
    draft.aiPurpose = "Lav tekstudkast til internt vejledningsmateriale med menneskelig kontrol.";
    assert.deepEqual(errors(draft), []);
    const before = JSON.stringify(draft);
    const warnings = getStepWarnings(draft, 5);
    assert.match(warnings.find((warning) => warning.field === "aiUsage").message, /ikke en juridisk klassifikation eller godkendelse/);
    if (aiUsage === "ved-ikke") assert.match(warnings[0].message, /Kontakt kommunens/);
    assert.equal(JSON.stringify(draft), before);
  }
});

test("AI state rejects forged answer types and overlong fields but accepts incomplete drafts", () => {
  for (const aiUsage of [null, true, "maybe", {}, []]) assert.equal(isApplicationFormState(state({ aiUsage })), false);
  for (const aiPurpose of [null, 42, {}, "x".repeat(4001)]) assert.equal(isApplicationFormState(state({ aiPurpose })), false);
  for (const aiAssessmentUrl of [null, 42, {}, "x".repeat(2049)]) assert.equal(isApplicationFormState(state({ aiAssessmentUrl })), false);
  assert.equal(isApplicationFormState(state({ aiUsage: "ved-ikke", aiPurpose: "", aiAssessmentUrl: "Afventer link" })), true);
});

test("assessment references accept only web URLs without credentials and remain optional", () => {
  for (const url of ["https://municipality.example.invalid/assessment/123", "http://intranet.example.invalid/ai", " https://example.invalid/ai "]) {
    assert.equal(isSafeAiAssessmentUrl(url), true);
    assert.deepEqual(errors(state({ aiUsage: "ja", aiPurpose: "Tekstudkast", aiAssessmentUrl: url })), []);
  }
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///private/test", "//example.invalid", "https://user:password@example.invalid/ai", "https://example.invalid/\npath", "Uafklaret", "https://example.invalid/" + "a".repeat(2048)]) {
    assert.equal(isSafeAiAssessmentUrl(url), false);
    assert.equal(errors(state({ aiUsage: "ved-ikke", aiPurpose: "Ukendt tekstfunktion", aiAssessmentUrl: url }))[0].field, "aiAssessmentUrl");
  }
  assert.equal(isSafeAiAssessmentUrl(undefined), false);
  assert.deepEqual(errors(state({ aiUsage: "ja", aiPurpose: "Tekstudkast", aiAssessmentUrl: "" })), []);
});

test("No clears obsolete answers immediately and submission pruning excludes forged hidden details", () => {
  const before = state({ aiUsage: "ja", aiPurpose: "Gammelt formål", aiAssessmentUrl: "https://example.invalid/old" });
  const after = normalizeAiScreeningChanges(before, { ...before, aiUsage: "nej" });
  assert.equal(after.aiPurpose, "");
  assert.equal(after.aiAssessmentUrl, "");
  assert.equal(before.aiPurpose, "Gammelt formål");
  const forged = { ...before, aiUsage: "nej", aiAssessmentUrl: "javascript:alert(1)" };
  assert.deepEqual(errors(forged), []);
  const snapshot = pruneHiddenAnswers(forged);
  assert.equal(snapshot.aiUsage, "nej");
  assert.equal(Object.hasOwn(snapshot, "aiPurpose"), false);
  assert.equal(Object.hasOwn(snapshot, "aiAssessmentUrl"), false);
  const unknown = { ...before, aiUsage: "ved-ikke" };
  assert.equal(normalizeAiScreeningChanges(before, unknown).aiPurpose, before.aiPurpose);
  assert.equal(pruneHiddenAnswers(unknown).aiPurpose, before.aiPurpose);
});
