import assert from "node:assert/strict";
import test from "node:test";

// Exercise the actual API route using a local session and an isolated database.
Object.assign(process.env, {
  DGITA_ENVIRONMENT: "local",
  DGITA_ENABLE_DEV_LOGIN: "true",
  DGITA_ENABLE_DEMO_SEED: "true",
  TURSO_DATABASE_URL: ":memory:",
  TURSO_AUTH_TOKEN: "validation-test-only",
  BLOB_READ_WRITE_TOKEN: "validation-test-only",
  DGITA_APPROVAL_TOKEN_SECRET: "validation-test-only-approval-secret-123456789",
});
const { demoApplicationState, getAllErrors } = await import("./engine.ts");
const { createDevSession } = await import("../auth/server.ts");
const { POST } = await import("../../app/api/drafts/route.ts");
const { preparePortalData } = await import("../workspace/server-repository.ts");
const DB = await preparePortalData();
const baseUrl = "http://localhost:3001";
const session = await createDevSession(new Request(`${baseUrl}/api/auth/dev-login`), "user");
const cookie = session.cookie.split(";", 1)[0];

function state(overrides = {}) {
  return {
    ...structuredClone(demoApplicationState),
    knownSystem: "nej", selectedSystem: null, catalogQuery: "",
    manualSystemName: "Testsystem til validering", consent: true,
    ...overrides,
  };
}
async function post(body) {
  const response = await POST(new Request(`${baseUrl}/api/drafts`, {
    method: "POST", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test("API gemmer ufærdige kladder, men afviser indsendelse med samme fejl som formularen", async () => {
  const draft = state({
    purpose: " \t ", manualSystemName: " ", acquisitionMethod: "ukendt",
    supplierCvr: "123", descriptionUrl: "javascript:alert(1)",
    startDate: "2026-02-30", endDate: "afventer", implementationUsers: "999",
    oneTimeCost: "-1", crossDepartments: [" "],
  });
  const id = crypto.randomUUID();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const result = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(result.status, 422, JSON.stringify(result.body));
  assert.deepEqual(result.body.errors, getAllErrors(draft));
  assert.equal(await DB.prepare("SELECT status FROM portal_applications WHERE id = ?").bind(id).first("status"), "draft");
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM portal_application_versions WHERE application_id = ?").bind(id).first("n"), 0);
});

test("API tillader fortsat gratis anskaffelse med nul kroner", async () => {
  const result = await post({
    id: crypto.randomUUID(), status: "submitted",
    draft: state({ acquisitionMethod: "Gratis", hasBudget: "ja", budgetAmount: "0", oneTimeCost: "0", yearlyCost: "0,00", otherCost: "0" }),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, "submitted");
  assert.equal(result.body.versionNumber, 1);
});

test("API persists catalog relations but rejects stale or forged choices when submitted", async () => {
  const { default: catalog } = await import("../catalog/data/system-catalog.json", { with: { type: "json" } });
  const { relationFromSystem } = await import("../catalog/relations.ts");
  const system = catalog.find((entry) => entry.usedInKalundborg);
  for (const patch of [{ id: "not-in-catalog" }, { name: "Forged label" }, { revision: "stale" }]) {
    const draft = state({ replacesExisting: "ja", replacementSystem: system.name, replacementCatalogRelation: { ...relationFromSystem(system), ...patch } });
    const id = crypto.randomUUID();
    const saved = await post({ id, draft, status: "draft" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const submitted = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
    assert.equal(submitted.status, 422, JSON.stringify(submitted.body));
    assert.match(submitted.body.error, /Søg og vælg systemet igen/);
    assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM portal_application_versions WHERE application_id = ?").bind(id).first("n"), 0);
  }
  const draft = state({ replacesExisting: "ja", replacementSystem: system.name, replacementCatalogRelation: relationFromSystem(system), acquisitionType: "tilkøb", relatedSystem: system.name, relatedCatalogRelation: relationFromSystem(system) });
  const id = crypto.randomUUID();
  const submitted = await post({ id, draft, status: "submitted" });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const snapshot = JSON.parse(await DB.prepare("SELECT snapshot_json FROM portal_application_versions WHERE application_id = ?").bind(id).first("snapshot_json"));
  assert.deepEqual(snapshot.replacementCatalogRelation, relationFromSystem(system));
  assert.deepEqual(snapshot.relatedCatalogRelation, relationFromSystem(system));
});

test("API preserves legacy text drafts and requires a manual explanation before a new submission", async () => {
  const draft = state({ replacesExisting: "ja", replacementSystem: "Legacy system", acquisitionType: "tilkøb", relatedSystem: "Lokalt system" });
  delete draft.replacementCatalogRelation;
  delete draft.relatedCatalogRelation;
  const id = crypto.randomUUID();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const rejected = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  assert.match(rejected.body.error, /kun gemt som tekst/);
  draft.replacementCatalogRelation = { kind: "manual", reason: " " };
  draft.relatedCatalogRelation = { kind: "manual", reason: "Findes ikke i kataloget" };
  assert.equal((await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion })).status, 422);
  draft.replacementCatalogRelation.reason = "Udgået lokalt system";
  const submitted = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
});

test("API saves a legacy draft but requires an AI answer for a new submitted version", async () => {
  const draft = state();
  for (const key of ["aiUsage", "aiPurpose", "aiAssessmentUrl"]) delete draft[key];
  const id = crypto.randomUUID();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const submitted = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(submitted.status, 422);
  assert.deepEqual(submitted.body.errors.map((error) => error.field), ["aiUsage"]);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM portal_application_versions WHERE application_id = ?").bind(id).first("n"), 0);
});

test("API validates AI purpose and safe references, then freezes them without automatic approval", async () => {
  const draft = state({ aiUsage: "ved-ikke", aiPurpose: "", aiAssessmentUrl: "javascript:alert(1)" });
  const id = crypto.randomUUID();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const invalid = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors.map((error) => error.field), ["aiPurpose", "aiAssessmentUrl"]);
  draft.aiPurpose = "Afklare om en tekstfunktion bruger AI, før den anvendes til vejledningsudkast.";
  draft.aiAssessmentUrl = "https://municipality.example.invalid/assessment/123";
  const submitted = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.status, "submitted");
  const serialized = await DB.prepare("SELECT snapshot_json FROM portal_application_versions WHERE application_id = ?").bind(id).first("snapshot_json");
  const snapshot = JSON.parse(serialized);
  assert.equal(snapshot.aiUsage, "ved-ikke");
  assert.equal(snapshot.aiPurpose, draft.aiPurpose);
  assert.equal(snapshot.aiAssessmentUrl, draft.aiAssessmentUrl);
  assert.equal(Object.hasOwn(snapshot, "aiClassification"), false);
  assert.equal(await DB.prepare("SELECT status FROM portal_applications WHERE id = ?").bind(id).first("status"), "submitted");
  const mutation = await post({ id, draft: { ...draft, aiUsage: "nej" }, status: "draft", expectedRowVersion: submitted.body.rowVersion });
  assert.equal(mutation.status, 409);
  assert.equal(await DB.prepare("SELECT snapshot_json FROM portal_application_versions WHERE application_id = ?").bind(id).first("snapshot_json"), serialized);
});

test("API rejects forged AI answer types and prunes hidden details for No", async () => {
  for (const aiUsage of ["maybe", {}, null]) {
    assert.equal((await post({ id: crypto.randomUUID(), draft: state({ aiUsage }), status: "draft" })).status, 400);
  }
  const id = crypto.randomUUID();
  const submitted = await post({ id, draft: state({ aiUsage: "nej", aiPurpose: "Skal udelades", aiAssessmentUrl: "javascript:alert(1)" }), status: "submitted" });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const snapshot = JSON.parse(await DB.prepare("SELECT snapshot_json FROM portal_application_versions WHERE application_id = ?").bind(id).first("snapshot_json"));
  assert.equal(snapshot.aiUsage, "nej");
  assert.equal(Object.hasOwn(snapshot, "aiPurpose"), false);
  assert.equal(Object.hasOwn(snapshot, "aiAssessmentUrl"), false);
});
