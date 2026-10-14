import assert from "node:assert/strict";
import test from "node:test";
import { applicationKleSummaryRows, isApplicationKleSelection, MAX_APPLICATION_KLE_ENTRIES } from "./kle-selection.ts";
import { initialApplicationState, legacyDemoApplicationState, pruneHiddenAnswers, getAllErrors } from "./engine.ts";
import { isApplicationFormState, normalizePersistedApplicationFormState } from "./state-validation.ts";
import { SYNTHETIC_KLE_CATALOG } from "../kle/synthetic.ts";

function selection() {
  const { id, version, label, kind } = SYNTHETIC_KLE_CATALOG.source;
  const { uuid, code, title } = SYNTHETIC_KLE_CATALOG.entries[1];
  return { schemaVersion: 1, source: { id, version, label, kind }, entries: [{ uuid, code, title }] };
}

test("KLE remains optional, normalizes missing legacy answers and preserves independent legacy text", () => {
  const bytes = JSON.stringify(legacyDemoApplicationState);
  assert.equal(Object.hasOwn(legacyDemoApplicationState, "kleSelection"), false);
  assert.equal(isApplicationFormState(legacyDemoApplicationState), true);
  assert.equal(initialApplicationState.kleSelection, null);
  const normalized = normalizePersistedApplicationFormState(legacyDemoApplicationState);
  assert.equal(normalized.kleSelection, null);
  assert.deepEqual(normalized.kleTopics, legacyDemoApplicationState.kleTopics);
  assert.equal(getAllErrors(normalized).some((error) => error.field.startsWith("kle")), false);
  assert.equal(JSON.stringify(legacyDemoApplicationState), bytes);
  const state = { ...structuredClone(initialApplicationState), kleSelection: selection(), kleTopics: ["Eksisterende egen beskrivelse"] };
  assert.equal(isApplicationFormState(state), true);
  assert.deepEqual(pruneHiddenAnswers(state).kleSelection, state.kleSelection);
  assert.deepEqual(pruneHiddenAnswers(state).kleTopics, state.kleTopics);
  assert.deepEqual(normalizePersistedApplicationFormState(pruneHiddenAnswers(state)).kleSelection, state.kleSelection);
});

test("KLE snapshots reject unknown keys, malformed types, duplicates and excessive data", () => {
  const valid = selection();
  for (const malformed of [
    null, [], {}, { ...valid, schemaVersion: 2 }, { ...valid, extra: true },
    { ...valid, source: { ...valid.source, acceptedForUse: true } },
    { ...valid, source: { ...valid.source, id: "" } },
    { ...valid, source: { ...valid.source, kind: "official" } },
    { ...valid, source: { ...valid.source, version: "x".repeat(201) } },
    { ...valid, entries: [{ ...valid.entries[0], description: "unexpected" }] },
    { ...valid, entries: [{ ...valid.entries[0], title: "x".repeat(501) }] },
    { ...valid, entries: [{ ...valid.entries[0], title: "title\nsecond line" }] },
    { ...valid, entries: [{ ...valid.entries[0], uuid: "not-a-uuid" }] },
    { ...valid, entries: [valid.entries[0], { ...valid.entries[0], code: "DEMO.10" }] },
    { ...valid, entries: [valid.entries[0], { ...valid.entries[0], uuid: "00000000-0000-4000-8000-000000000099" }] },
    { ...valid, entries: Array.from({ length: MAX_APPLICATION_KLE_ENTRIES + 1 }, (_, index) => ({ uuid: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, code: `DEMO.${index}`, title: "Eksempel" })) },
  ]) assert.equal(isApplicationKleSelection(malformed), false, JSON.stringify(malformed));
  assert.equal(isApplicationKleSelection(valid), true);
  assert.equal(isApplicationKleSelection({ ...valid, entries: [] }), true);
  assert.equal(isApplicationFormState({ ...structuredClone(initialApplicationState), kleSelection: {} }), false);
});

test("KLE summaries show the stored source and exact selected codes without inventing missing choices", () => {
  for (const empty of [undefined, null, { ...selection(), entries: [] }]) assert.deepEqual(applicationKleSummaryRows(empty), []);
  const rows = applicationKleSummaryRows(selection());
  assert.match(rows[0][1], /2026-10-14\.1.*eksempeldata/u);
  assert.match(rows[1][1], /DEMO\.00\.01 – Eksempel – lokal driftsopgave/u);
});
