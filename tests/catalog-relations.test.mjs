import assert from "node:assert/strict";
import test from "node:test";
import catalog from "../features/catalog/data/system-catalog.json" with { type: "json" };
import { catalogEntryRevision, relationFromSystem, normalizeRelationChanges } from "../features/catalog/relations.ts";
import { catalogFreshnessLabel, CATALOG_METADATA } from "../features/catalog/metadata.ts";
import { canonicalCatalogSelection } from "../features/catalog/selection.ts";
import { demoApplicationState, getStepErrors, pruneHiddenAnswers } from "../features/application/engine.ts";
import { isApplicationFormState, normalizePersistedApplicationFormState } from "../features/application/state-validation.ts";

const system = catalog.find((entry) => entry.usedInKalundborg);
const state = (extra = {}) => ({ ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualSystemName: "Testsystem", ...extra });
const selected = () => state({ replacesExisting: "ja", replacementSystem: system.name, replacementCatalogRelation: relationFromSystem(system), acquisitionType: "tilkøb", relatedSystem: system.name, relatedCatalogRelation: relationFromSystem(system) });

test("relations carry stable ids and labels through draft serialization and submitted snapshots", () => {
  const draft = selected();
  const restored = normalizePersistedApplicationFormState(JSON.parse(JSON.stringify(draft)));
  assert.ok(isApplicationFormState(restored));
  assert.deepEqual(restored.replacementCatalogRelation, relationFromSystem(system));
  assert.deepEqual(restored.relatedCatalogRelation, relationFromSystem(system));
  assert.equal(getStepErrors(restored, 0).length, 0);
  assert.equal(getStepErrors(restored, 2).length, 0);
  const snapshot = pruneHiddenAnswers(canonicalCatalogSelection(restored, { validateRelations: true }));
  assert.equal(snapshot.replacementSystem, system.name);
  assert.equal(snapshot.replacementCatalogRelation.id, system.id);
  assert.equal(snapshot.relatedCatalogRelation.id, system.id);
});

test("legacy text is preserved without fabricated ids and requires an explicit relation on a new submission", () => {
  const old = state({ replacesExisting: "ja", replacementSystem: "Tidligere fritekstsvar", acquisitionType: "tilkøb", relatedSystem: "Lokalt fagsystem" });
  delete old.replacementCatalogRelation;
  delete old.relatedCatalogRelation;
  const bytes = JSON.stringify(old);
  assert.ok(isApplicationFormState(old), "old clients can still save a draft");
  const restored = normalizePersistedApplicationFormState(old);
  assert.equal(restored.replacementSystem, "Tidligere fritekstsvar");
  assert.equal(restored.relatedSystem, "Lokalt fagsystem");
  assert.equal(restored.replacementCatalogRelation, null);
  assert.equal(restored.relatedCatalogRelation, null);
  assert.match(getStepErrors(restored, 0).find(e => e.field === "replacementSystem").message, /kun gemt som tekst/);
  assert.match(getStepErrors(restored, 2).find(e => e.field === "relatedSystem").message, /manuel registrering/);
  assert.equal(JSON.stringify(old), bytes, "reading and normalization never rewrite the historical snapshot");
});

test("manual relations need a name and an explicit reason; incomplete drafts remain structurally valid", () => {
  const draft = state({ replacesExisting: "ja", replacementSystem: "Lokalt system", replacementCatalogRelation: { kind: "manual", reason: " " } });
  assert.ok(isApplicationFormState(draft));
  assert.match(getStepErrors(draft, 0).find(e => e.field === "replacementSystem").message, /Begrund/);
  draft.replacementCatalogRelation.reason = "Systemet findes kun i den lokale oversigt.";
  assert.equal(getStepErrors(draft, 0).length, 0);
  assert.equal(canonicalCatalogSelection(draft, { validateRelations: true }), draft);
  draft.replacementCatalogRelation.reason = "x".repeat(2001);
  assert.equal(isApplicationFormState(draft), false);
  draft.replacementCatalogRelation = { kind: "manual", reason: "Forklaring", id: "invented" };
  assert.equal(isApplicationFormState(draft), false);
});

test("submitted relations reject forged ids, label mismatches and outdated catalog revisions", () => {
  for (const patch of [{ id: "unknown-id" }, { name: "Invented name" }, { revision: "outdated-catalog" }]) {
    const draft = selected();
    Object.assign(draft.replacementCatalogRelation, patch);
    assert.equal(canonicalCatalogSelection(draft), draft, "draft saving remains permissive");
    assert.throws(() => canonicalCatalogSelection(draft, { validateRelations: true }), /Søg og vælg systemet igen/);
  }
  const draft = selected();
  draft.relatedSystem = "Forged label";
  assert.throws(() => canonicalCatalogSelection(draft, { validateRelations: true }), /stemmer ikke overens/);
  assert.notEqual(catalogEntryRevision(system), catalogEntryRevision({ ...system, localStatus: "ændret status" }));
  assert.notEqual(catalogEntryRevision(system), catalogEntryRevision({ ...system, name: "nyt navn" }));
});

test("switching the system or acquisition clears obsolete relations without discarding unrelated answers", () => {
  const draft = selected();
  const acquisitionChanged = normalizeRelationChanges(draft, { ...draft, acquisitionType: "nyanskaffelse" });
  assert.equal(acquisitionChanged.relatedSystem, "");
  assert.equal(acquisitionChanged.relatedCatalogRelation, null);
  assert.equal(acquisitionChanged.replacementSystem, system.name);
  const switches = [
    { knownSystem: "ja" }, { manualCatalogEntry: true }, { replacesExisting: "nej" },
  ];
  for (const patch of switches) {
    const changed = normalizeRelationChanges(draft, { ...draft, ...patch });
    assert.equal(changed.replacementSystem, "");
    assert.equal(changed.replacementCatalogRelation, null);
    assert.equal(changed.purpose, draft.purpose);
  }
  const catalogDraft = { ...draft, knownSystem: "ja", selectedSystem: system };
  const changed = normalizeRelationChanges(catalogDraft, { ...catalogDraft, selectedSystem: catalog.find(entry => entry.id !== system.id) });
  assert.equal(changed.relatedCatalogRelation, null);
  assert.equal(changed.replacementCatalogRelation, null);
  const unrelated = normalizeRelationChanges(draft, { ...draft, purpose: "Ny beskrivelse" });
  assert.deepEqual(unrelated.relatedCatalogRelation, draft.relatedCatalogRelation);
});

test("hidden relations are removed from new snapshots and cannot block submission", () => {
  const draft = { ...selected(), replacesExisting: "nej", acquisitionType: "nyanskaffelse" };
  const result = pruneHiddenAnswers(canonicalCatalogSelection(draft, { validateRelations: true }));
  for (const key of ["replacementSystem", "replacementCatalogRelation", "relatedSystem", "relatedCatalogRelation"]) assert.equal(Object.hasOwn(result, key), false);
});

test("freshness reports only supplied source metadata, never the current date or technical revision", () => {
  assert.equal(CATALOG_METADATA.sourceUpdatedAt, null);
  assert.equal(catalogFreshnessLabel(), "Katalogets opdateringsdato er ikke oplyst.");
  assert.equal(catalogFreshnessLabel({ sourceUpdatedAt: "invalid" }), "Katalogets opdateringsdato er ikke oplyst.");
  assert.match(catalogFreshnessLabel({ sourceUpdatedAt: "2026-01-15T12:00:00Z" }), /15.1.2026/);
});


test("typing or correcting a manual system name preserves previously chosen relations", () => {
  let current = { ...selected(), manualSystemName: "" };
  for (const name of ["S", "Sy", "System", "Systemnavn", "Systemnavn med rettet stavning"]) {
    current = normalizeRelationChanges(current, { ...current, manualSystemName: name });
    assert.equal(current.replacementSystem, system.name);
    assert.deepEqual(current.replacementCatalogRelation, relationFromSystem(system));
    assert.equal(current.relatedSystem, system.name);
    assert.deepEqual(current.relatedCatalogRelation, relationFromSystem(system));
  }
});
