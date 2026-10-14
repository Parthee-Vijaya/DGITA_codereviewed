import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyKleReview, evaluateKleReview, getKleConfirmationBinding, getKleInputBinding, isKleReview, KLE_LIMITS } from "../features/kle/domain.ts";
import { SYNTHETIC_KLE_CATALOG, SYNTHETIC_KL_TASK_CATALOG } from "../features/kle/synthetic.ts";

const catalog = SYNTHETIC_KLE_CATALOG;
const tasks = SYNTHETIC_KL_TASK_CATALOG;
const reference = (entry) => ({ uuid: entry.uuid, code: entry.code });
const draft = (index = 1) => ({ ...createEmptyKleReview(), selectedCodes: [reference(catalog.entries[index])], localTaskDescription: "En lokal opgave til afprøvning." });
const assess = (review, source = catalog, taskSource = tasks) => ({
  ...review,
  localAssessment: { level: "high", rationale: "Lokal vurdering af følgerne ved utilgængelighed.", inputBinding: getKleInputBinding(review, source, taskSource) },
});
const confirm = (review, source = catalog, taskSource = tasks) => ({
  ...review,
  confirmation: { inputBinding: getKleConfirmationBinding(review, source, taskSource), confirmedBy: "test-user", confirmedAt: "2026-10-14T10:00:00.000Z" },
});

test("synthetic examples produce deterministic direct/possible/no-match states without a production approval", () => {
  assert.equal(evaluateKleReview(draft(1), catalog, tasks).state, "direct");
  assert.equal(evaluateKleReview(draft(2), catalog, tasks).state, "possible");
  const unmatched = evaluateKleReview(draft(3), catalog, tasks);
  assert.equal(unmatched.state, "no-match");
  assert.equal(unmatched.synthetic, true);
  assert.equal(unmatched.sourceReadyForProduction, false);
  assert.equal(Object.hasOwn(unmatched, "outsideNis2"), false);
  assert.equal(Object.hasOwn(unmatched, "approved"), false);
  assert.ok(catalog.entries.every((entry) => entry.code.startsWith("DEMO.")));
});

test("one KLE code preserves all matching tasks and explicit possible matches", () => {
  const review = draft();
  review.selectedCodes.push(reference(catalog.entries[2]));
  const result = evaluateKleReview(review, catalog, tasks);
  assert.equal(result.state, "direct");
  assert.deepEqual(result.matches.map((match) => match.taskId), ["demo-task-1", "demo-task-2", "demo-task-3"]);
  assert.equal(result.matches[2].match, "possible");
  assert.equal(result.confirmationCurrent, false);
});

test("groups never inherit a child match and code equality alone is insufficient", () => {
  const group = evaluateKleReview(draft(0), catalog, tasks);
  assert.equal(group.state, "no-match");
  assert.deepEqual(group.matches, []);
  const wrongUuid = draft();
  wrongUuid.selectedCodes[0].uuid = catalog.entries[2].uuid;
  const result = evaluateKleReview(wrongUuid, catalog, tasks);
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.matches, []);
});

test("leading zero code strings are preserved and different codes are not coerced", () => {
  const realFormatSource = structuredClone(catalog);
  const realFormatTasks = structuredClone(tasks);
  realFormatSource.entries[1].code = "00.01.01";
  for (const task of realFormatTasks.tasks) for (const item of task.codeReferences) if (item.code === "DEMO.00.01") item.code = "00.01.01";
  const review = { ...draft(), selectedCodes: [reference(realFormatSource.entries[1])] };
  const evaluation = evaluateKleReview(review, realFormatSource, realFormatTasks);
  assert.equal(evaluation.state, "direct");
  assert.ok(evaluation.matches.every((match) => match.code === "00.01.01"));
  assert.match(getKleInputBinding(review, realFormatSource, realFormatTasks), /00\.01\.01/u);
  review.selectedCodes[0].code = "0.1.1";
  assert.equal(evaluateKleReview(review, realFormatSource, realFormatTasks).state, "incomplete");
});

test("legacy free text remains unconfirmed and cannot substitute for a selected code", () => {
  const legacy = ["Digital drift", "Systemadministration", "Digital drift"];
  const review = createEmptyKleReview(legacy);
  assert.deepEqual(review.legacyTopics, ["Digital drift", "Systemadministration"]);
  assert.equal(legacy.length, 3);
  assert.deepEqual(review.selectedCodes, []);
  assert.equal(isKleReview(review), true);
  assert.equal(evaluateKleReview(review, catalog, tasks).state, "incomplete");
  assert.equal(evaluateKleReview(review, catalog, tasks).confirmationCurrent, false);
});

test("unavailable source, retired code, duplicate catalogue identity and blank local task stay incomplete", () => {
  for (const sourceName of ["catalog", "tasks"]) {
    const changedCatalog = structuredClone(catalog);
    const changedTasks = structuredClone(tasks);
    (sourceName === "catalog" ? changedCatalog : changedTasks).source.status = "unavailable";
    const result = evaluateKleReview(draft(), changedCatalog, changedTasks);
    assert.equal(result.state, "incomplete");
    assert.deepEqual(result.matches, []);
    assert.equal(result.sourceReadyForProduction, false);
  }
  assert.equal(evaluateKleReview(draft(4), catalog, tasks).state, "incomplete");
  const ambiguous = structuredClone(catalog);
  ambiguous.entries.push({ ...ambiguous.entries[1], title: "Tvetydig registrering" });
  assert.equal(evaluateKleReview(draft(), ambiguous, tasks).state, "incomplete");
  for (const change of [{ uuid: catalog.entries[2].uuid }, { code: "DEMO.00.99" }]) {
    const ambiguousIdentity = structuredClone(catalog);
    ambiguousIdentity.entries.push({ ...ambiguousIdentity.entries[1], ...change });
    assert.equal(evaluateKleReview(draft(), ambiguousIdentity, tasks).state, "incomplete");
  }
  assert.equal(evaluateKleReview({ ...draft(), localTaskDescription: " \n " }, catalog, tasks).state, "incomplete");
});

test("confirmation and local assessment become stale after input or either source changes", () => {
  const original = confirm(assess(draft()));
  const before = JSON.stringify(original);
  assert.equal(isKleReview(original), true);
  assert.equal(evaluateKleReview(original, catalog, tasks).assessmentCurrent, true);
  assert.equal(evaluateKleReview(original, catalog, tasks).confirmationCurrent, true);
  for (const changed of [
    { ...original, localTaskDescription: "Ændret formål" },
    { ...original, selectedCodes: [reference(catalog.entries[2])] },
    { ...original, legacyTopics: ["Ny historisk kontekst"] },
  ]) {
    const result = evaluateKleReview(changed, catalog, tasks);
    assert.equal(result.assessmentCurrent, false);
    assert.equal(result.confirmationCurrent, false);
  }
  for (const target of ["catalog", "tasks"]) {
    const changedCatalog = structuredClone(catalog);
    const changedTasks = structuredClone(tasks);
    (target === "catalog" ? changedCatalog : changedTasks).source.version = "next-version";
    const result = evaluateKleReview(original, changedCatalog, changedTasks);
    assert.equal(result.assessmentCurrent, false);
    assert.equal(result.confirmationCurrent, false);
  }
  assert.equal(JSON.stringify(original), before);
});

test("rationale and criticality edits invalidate confirmation while assessment still refers to the same input", () => {
  const original = confirm(assess(draft()));
  for (const changes of [{ rationale: "Et nyt begrundet skøn." }, { level: "low" }]) {
    const changed = { ...original, localAssessment: { ...original.localAssessment, ...changes } };
    const result = evaluateKleReview(changed, catalog, tasks);
    assert.equal(result.assessmentCurrent, true);
    assert.equal(result.confirmationCurrent, false);
  }
  const changed = { ...original, localAssessment: { ...original.localAssessment, rationale: " " } };
  assert.equal(evaluateKleReview(changed, catalog, tasks).assessmentCurrent, false);
  assert.equal(evaluateKleReview(changed, catalog, tasks).confirmationCurrent, false);
});

test("changed matching content invalidates confirmation even if a source reused its version by mistake", () => {
  const original = confirm(assess(draft()));
  const changedTasks = structuredClone(tasks);
  changedTasks.tasks[0].title = "En anden opgave";
  assert.equal(evaluateKleReview(original, catalog, changedTasks).confirmationCurrent, false);
  const changedCatalog = structuredClone(catalog);
  changedCatalog.entries[1].retired = true;
  assert.equal(evaluateKleReview(original, changedCatalog, tasks).confirmationCurrent, false);
});

test("selection order and source order do not invalidate the same reviewed content", () => {
  const review = draft();
  review.selectedCodes.push(reference(catalog.entries[2]));
  const original = confirm(assess(review));
  const reordered = { ...original, selectedCodes: [...original.selectedCodes].reverse() };
  const reorderedCatalog = { ...catalog, entries: [...catalog.entries].reverse() };
  const reorderedTasks = { ...tasks, tasks: [...tasks.tasks].reverse() };
  assert.equal(evaluateKleReview(reordered, reorderedCatalog, reorderedTasks).confirmationCurrent, true);
});

test("maximum escaped text stays bounded and readable after server confirmation", () => {
  const review = {
    ...createEmptyKleReview(),
    selectedCodes: catalog.entries.filter((entry) => !entry.retired).map(reference),
    localTaskDescription: "\\".repeat(KLE_LIMITS.text),
    legacyTopics: Array.from({ length: KLE_LIMITS.legacyTopics }, (_, index) => String(index).padStart(2, "0") + "\\".repeat(KLE_LIMITS.legacyTopic - 2)),
  };
  review.localAssessment = {
    level: "high",
    rationale: '"'.repeat(KLE_LIMITS.text),
    inputBinding: getKleInputBinding(review, catalog, tasks),
  };
  assert.equal(isKleReview(review), true);
  assert.equal(evaluateKleReview(review, catalog, tasks).assessmentCurrent, true);
  const confirmed = confirm(review);
  assert.ok(confirmed.confirmation.inputBinding.length <= KLE_LIMITS.binding);
  assert.equal(JSON.parse(confirmed.confirmation.inputBinding).bindingVersion, 1);
  const reloaded = JSON.parse(JSON.stringify(confirmed));
  assert.equal(isKleReview(reloaded), true);
  assert.equal(evaluateKleReview(reloaded, catalog, tasks).confirmationCurrent, true);
});

test("confirmation does not parse untrusted assessment bindings and marks them stale", () => {
  const current = assess(draft());
  for (const inputBinding of ["not JSON", "{", "", "\\".repeat(KLE_LIMITS.binding)]) {
    const review = { ...current, localAssessment: { ...current.localAssessment, inputBinding } };
    assert.equal(isKleReview(review), true);
    const binding = getKleConfirmationBinding(review, catalog, tasks);
    assert.equal(JSON.parse(binding).localAssessment.assessmentInputCurrent, false);
    assert.notEqual(binding, getKleConfirmationBinding(current, catalog, tasks));
    assert.equal(evaluateKleReview(confirm(review), catalog, tasks).confirmationCurrent, false);
  }
});

test("runtime validation rejects unknown fields, malformed metadata, duplicates and excessive payloads", () => {
  const valid = confirm(assess(draft()));
  const invalid = [
    null, [], { ...valid, schemaVersion: 2 }, { ...valid, approved: true },
    { ...valid, localTaskDescription: "x".repeat(KLE_LIMITS.text + 1) },
    { ...valid, localTaskDescription: "\u0000" },
    { ...valid, selectedCodes: [valid.selectedCodes[0], valid.selectedCodes[0]] },
    { ...valid, selectedCodes: Array.from({ length: KLE_LIMITS.selectedCodes + 1 }, (_, i) => ({ uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, code: `DEMO.99.${i}` })) },
    { ...valid, selectedCodes: [{ ...valid.selectedCodes[0], title: "Injected" }] },
    { ...valid, selectedCodes: [{ ...valid.selectedCodes[0], uuid: "bad-id" }] },
    { ...valid, selectedCodes: [{ ...valid.selectedCodes[0], code: 0 }] },
    { ...valid, legacyTopics: ["x", "x"] },
    { ...valid, legacyTopics: ["x".repeat(KLE_LIMITS.legacyTopic + 1)] },
    { ...valid, localAssessment: { ...valid.localAssessment, level: "approved" } },
    { ...valid, localAssessment: { ...valid.localAssessment, rationale: 1 } },
    { ...valid, localAssessment: { ...valid.localAssessment, actor: "spoofed" } },
    { ...valid, confirmation: { ...valid.confirmation, confirmedBy: "" } },
    { ...valid, confirmation: { ...valid.confirmation, confirmedAt: "2026-02-31T10:00:00.000Z" } },
    { ...valid, confirmation: { ...valid.confirmation, confirmedAt: "yesterday" } },
    { ...valid, confirmation: { ...valid.confirmation, inputBinding: "x".repeat(KLE_LIMITS.binding + 1) } },
    { ...valid, confirmation: { ...valid.confirmation, approved: true } },
  ];
  for (const value of invalid) {
    assert.equal(isKleReview(value), false);
    assert.equal(evaluateKleReview(value, catalog, tasks).state, "incomplete");
  }
});
