import assert from "node:assert/strict";
import test from "node:test";
import { demoApplicationState, initialApplicationState, legacyDemoApplicationState, getStepErrors, getStepWarnings, getFinanceTotal, pruneHiddenAnswers } from "./engine.ts";
import { PROCUREMENT_FIELDS, PROCUREMENT_TEXT_LIMITS, DATA_CATEGORY_OPTIONS, isPersonalDataCategories, personalDataCategoryLabels, parseContractValue, normalizeProcurementChanges } from "./procurement.ts";
import { isApplicationFormState, normalizePersistedApplicationFormState } from "./state-validation.ts";
import { normalizeApplicationSnapshotJson } from "../cases/detail-helpers.ts";

const state = (overrides = {}) => ({ ...structuredClone(demoApplicationState), ...overrides });
const procurementErrors = (value) => getStepErrors(value, 4).filter((error) => PROCUREMENT_FIELDS.includes(error.field));

test("legacy drafts remain readable and saveable with unanswered additive fields", () => {
  const original = JSON.stringify(legacyDemoApplicationState);
  assert.equal(isApplicationFormState(legacyDemoApplicationState), true);
  for (const field of [...PROCUREMENT_FIELDS, "personalDataCategories"]) assert.equal(Object.hasOwn(legacyDemoApplicationState, field), false);
  for (let read = 0; read < 3; read += 1) {
    const normalized = normalizeApplicationSnapshotJson(original, initialApplicationState);
    assert.deepEqual(normalized.personalDataCategories, []);
    assert.equal(normalized.dataClassification, legacyDemoApplicationState.dataClassification);
    assert.equal(normalized.contractValueStatus, "");
    assert.equal(normalized.contractCoverage, "");
    assert.equal(normalized.estimatedContractValueExVat, "");
    const correction = normalizePersistedApplicationFormState(JSON.parse(original));
    assert.equal(isApplicationFormState(correction), true);
    assert.deepEqual(procurementErrors(correction).map((error) => error.field), ["contractValueStatus", "contractCoverage"]);
    assert.ok(getStepErrors(correction, 5).some((error) => error.field === "personalDataCategories"));
  }
  assert.equal(JSON.stringify(legacyDemoApplicationState), original);
});

test("person data categories accept independent combinations and remain separate from classification", () => {
  for (const categories of [[], ["unknown"], ["ordinary", "ordinary"], "ordinary", null, 3, {}]) {
    const draft = state({ personalDataCategories: categories });
    assert.ok(getStepErrors(draft, 5).some((error) => error.field === "personalDataCategories"));
    assert.equal(isApplicationFormState(draft), Array.isArray(categories) && categories.length === 0);
  }
  const all = DATA_CATEGORY_OPTIONS.map((option) => option.value);
  assert.equal(isPersonalDataCategories(all), true);
  const draft = state({ personalDataCategories: all });
  assert.deepEqual(getStepErrors(draft, 5), []);
  assert.deepEqual(personalDataCategoryLabels(all), DATA_CATEGORY_OPTIONS.map((option) => option.label));
  assert.ok(getStepErrors({ ...draft, dataClassification: "" }, 5).some((error) => error.field === "dataClassification"));
  const no = normalizeProcurementChanges({ ...draft, personalData: "nej" });
  assert.deepEqual(no.personalDataCategories, []);
  assert.equal(Object.hasOwn(pruneHiddenAnswers({ ...draft, personalData: "nej" }), "personalDataCategories"), false);
  assert.deepEqual(draft.personalDataCategories, all);
});

test("manual total accepts bounded Danish amounts including zero and rejects malformed amounts", () => {
  for (const [raw, expected] of [["0", 0], ["0,00", 0], ["125.000,50", 125000.5], [" 1234,5 ", 1234.5], ["1.000.000.000.000,00", 1e12]]) {
    assert.equal(parseContractValue(raw), expected);
    assert.deepEqual(procurementErrors(state({ estimatedContractValueExVat: raw })), []);
  }
  for (const raw of [undefined, null, 1, "", " ", "-1", "1.25", "12,345", "1,234.00", "Infinity", "1e6", "1000000000000,01", "123,", ".50", "12 000", "9".repeat(33)]) {
    assert.equal(parseContractValue(raw), null, String(raw));
    assert.ok(procurementErrors(state({ estimatedContractValueExVat: raw })).some((error) => error.field === "estimatedContractValueExVat"));
  }
  const independent = state({ oneTimeCost: "1", yearlyCost: "2", otherCost: "3", estimatedContractValueExVat: "9000000" });
  assert.equal(getFinanceTotal(independent), 6);
  assert.equal(pruneHiddenAnswers(independent).estimatedContractValueExVat, "9000000");
});

test("estimated totals require basis and options; period is optional and bounded", () => {
  assert.deepEqual(procurementErrors(state({ contractValueNote: " ", contractOptionsDescription: "" })).map((error) => error.field), ["contractOptionsDescription", "contractValueNote"]);
  for (const contractDurationMonths of ["", "1", "36", "1200"]) assert.deepEqual(procurementErrors(state({ contractDurationMonths, contractOptionsDescription: "Ingen" })), []);
  for (const contractDurationMonths of ["0", "-12", "12,5", "1.5", "1201", "1e2", "01"]) assert.ok(procurementErrors(state({ contractDurationMonths })).some((error) => error.field === "contractDurationMonths"));
  const draft = state({ contractCoverage: "existing-agreement", agreementReference: "" });
  assert.deepEqual(procurementErrors(draft).map((error) => error.field), ["agreementReference"]);
  draft.agreementReference = "Journal 2026-0001 / aftale 42";
  assert.deepEqual(procurementErrors(draft), []);
});

test("declared uncertainty can proceed and hidden estimates never carry into snapshots or reads", () => {
  const draft = state({ contractValueStatus: "needs-clarification", contractCoverage: "needs-clarification", estimatedContractValueExVat: "-1", contractDurationMonths: "0", agreementReference: "old reference" });
  assert.deepEqual(procurementErrors(draft), []);
  assert.match(getStepWarnings(draft, 4)[0].message, /Afklar kontraktværdi og aftaleform/);
  const cleared = normalizeProcurementChanges(draft);
  for (const key of ["estimatedContractValueExVat", "contractDurationMonths", "contractOptionsDescription", "contractValueNote", "agreementReference"]) {
    assert.equal(cleared[key], "");
    assert.equal(Object.hasOwn(pruneHiddenAnswers(draft), key), false);
    assert.equal(normalizeApplicationSnapshotJson(JSON.stringify(draft), initialApplicationState)[key], "");
  }
  assert.equal(draft.estimatedContractValueExVat, "-1");
});

test("strict draft shapes permit incomplete answers but reject unsupported fields, values and lengths", () => {
  assert.equal(isApplicationFormState(initialApplicationState), true);
  for (const [field, limit] of Object.entries(PROCUREMENT_TEXT_LIMITS)) {
    assert.equal(isApplicationFormState(state({ [field]: "x".repeat(limit) })), true);
    for (const value of [null, {}, 123, "x".repeat(limit + 1)]) assert.equal(isApplicationFormState(state({ [field]: value })), false, field);
  }
  for (const contractValueStatus of [null, true, "approved", {}]) assert.equal(isApplicationFormState(state({ contractValueStatus })), false);
  for (const contractCoverage of [null, true, "approved", {}]) assert.equal(isApplicationFormState(state({ contractCoverage })), false);
  assert.equal(isApplicationFormState(state({ procurementApproved: true })), false);
});
