import assert from "node:assert/strict";
import test from "node:test";

import { demoApplicationState, initialApplicationState } from "./engine.ts";
import {
  isApplicationFormState,
  normalizePersistedApplicationFormState,
} from "./state-validation.ts";

function clone(value = initialApplicationState) {
  return structuredClone(value);
}

test("hele den forventede dgita-v1-struktur accepteres", () => {
  assert.equal(isApplicationFormState(clone()), true);
  assert.equal(isApplicationFormState(clone(demoApplicationState)), true);

  const selected = clone();
  selected.selectedSystem = {
    id: "kitos-1",
    name: "Fagsystem",
    supplier: "Leverandør",
    rightsHolder: "Rettighedshaver",
    source: "both",
    usedInKalundborg: true,
    localSystemId: "local-1",
  };
  selected.attachments.contract.push({
    id: "019c7a82-0181-7457-9c4a-8ebf2ce0121f",
    kind: "contract",
    name: "kontrakt.pdf",
    size: 1234,
    type: "application/pdf",
    status: "uploaded",
  });
  assert.equal(isApplicationFormState(selected), true);
});

test("manglende, ukendte og type-invalid felter afvises", () => {
  const missing = clone();
  delete missing.catalogQuery;
  assert.equal(isApplicationFormState(missing), false);

  const unknown = { ...clone(), injected: "gem mig ikke" };
  assert.equal(isApplicationFormState(unknown), false);

  assert.equal(isApplicationFormState({ ...clone(), consent: "ja" }), false);
  assert.equal(isApplicationFormState({ ...clone(), knownSystem: "måske" }), false);
  assert.equal(isApplicationFormState({ ...clone(), acquisitionType: "leasing" }), false);
  assert.equal(isApplicationFormState({ ...clone(), kleTopics: ["KLE", 42] }), false);
});

test("katalogvalg og alle bilagsgrupper valideres rekursivt", () => {
  const badCatalog = clone();
  badCatalog.selectedSystem = {
    id: "kitos-1",
    name: "Fagsystem",
    supplier: "Leverandør",
    rightsHolder: "Rettighedshaver",
    source: "ukendt",
    usedInKalundborg: true,
  };
  assert.equal(isApplicationFormState(badCatalog), false);

  const missingBucket = clone();
  delete missingBucket.attachments.architecture;
  assert.equal(isApplicationFormState(missingBucket), false);

  const wrongKind = clone();
  wrongKind.attachments.contract.push({
    id: "file-1",
    kind: "architecture",
    name: "kontrakt.pdf",
    size: 100,
    type: "application/pdf",
    status: "uploaded",
  });
  assert.equal(isApplicationFormState(wrongKind), false);

  const invalidAttachment = clone();
  invalidAttachment.attachments.contract.push({
    id: "file-2",
    kind: "contract",
    name: "kontrakt.pdf",
    size: Number.NaN,
    type: "application/pdf",
    status: "ready",
  });
  assert.equal(isApplicationFormState(invalidAttachment), false);
});

test("et beskåret, indsendt snapshot gendannes som en sikker rettelseskladde", () => {
  const sparseSnapshot = clone(demoApplicationState);
  delete sparseSnapshot.replacementSystem;
  delete sparseSnapshot.relatedSystem;
  sparseSnapshot.internalStorageKey = "må-ikke-lække";

  const normalized = normalizePersistedApplicationFormState(sparseSnapshot);
  assert.ok(normalized);
  assert.equal(normalized.replacementSystem, "");
  assert.equal(normalized.relatedSystem, "");
  assert.equal(Object.hasOwn(normalized, "internalStorageKey"), false);
  assert.equal(isApplicationFormState(normalized), true);
});


test("ufærdige og semantisk ugyldige svar må stadig gemmes som kladde", () => {
  const draft = clone();
  Object.assign(draft, {
    purpose: " ", acquisitionMethod: "Under afklaring", startDate: "2026-02-30",
    supplierCvr: "123", descriptionUrl: "afventer link", budgetAmount: "ukendt",
  });
  assert.equal(isApplicationFormState(draft), true);
  assert.deepEqual(normalizePersistedApplicationFormState(draft), draft);
});
