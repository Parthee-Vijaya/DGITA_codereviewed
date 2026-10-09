import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

Object.assign(process.env, {
  DGITA_ENVIRONMENT: "local", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "true",
  TURSO_DATABASE_URL: ":memory:", TURSO_AUTH_TOKEN: "detail-relations-test-only",
  BLOB_READ_WRITE_TOKEN: "detail-relations-test-only",
  DGITA_APPROVAL_TOKEN_SECRET: "detail-relations-test-only-secret-material",
});
const { preparePortalData, resolveActorUserId } = await import("../features/workspace/server-repository.ts");
const { saveApplicationDraft, submitApplication } = await import("../features/application/server-repository.ts");
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const { getCaseDetail } = await import("../features/cases/detail-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { relationFromSystem } = await import("../features/catalog/relations.ts");
const { default: catalog } = await import("../features/catalog/data/system-catalog.json", { with: { type: "json" } });
const DB = await preparePortalData();
const actor = { ...DEMO_VIEWERS.user, provider: "dev" };
actor.userId = await resolveActorUserId(DB, actor);
const [approver] = await listApproversForActor(actor);
const system = catalog.find(entry => entry.usedInKalundborg);
function state() {
  return { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualSystemName: "Syntetisk detaljeprøve", catalogQuery: "",
    approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true,
    replacesExisting: "ja", replacementSystem: system.name, replacementCatalogRelation: relationFromSystem(system),
    acquisitionType: "tilkøb", relatedSystem: "Lokalt system", relatedCatalogRelation: { kind: "manual", reason: "Kilden indeholdt ikke det lokale system." } };
}

async function storedVersion(applicationId) {
  return DB.prepare("SELECT id, snapshot_json, snapshot_sha256 FROM portal_application_versions WHERE application_id = ? ORDER BY version_number DESC LIMIT 1").bind(applicationId).first();
}

test("actual case-detail repository preserves both relation kinds across draft and submitted reads", async () => {
  const draft = state();
  const saved = await saveApplicationDraft(actor, crypto.randomUUID(), draft);
  const storedDraft = await DB.prepare("SELECT draft_state_json FROM portal_applications WHERE id = ?").bind(saved.id).first("draft_state_json");
  for (let read = 0; read < 3; read += 1) {
    const detail = await getCaseDetail(actor, saved.caseNumber);
    assert.deepEqual(detail.snapshot.replacementCatalogRelation, draft.replacementCatalogRelation);
    assert.deepEqual(detail.snapshot.relatedCatalogRelation, draft.relatedCatalogRelation);
  }
  assert.equal(await DB.prepare("SELECT draft_state_json FROM portal_applications WHERE id = ?").bind(saved.id).first("draft_state_json"), storedDraft);
  const submitted = await submitApplication(actor, saved.id, draft, saved.rowVersion);
  const before = await storedVersion(submitted.id);
  const receiptsBefore = await DB.prepare("SELECT * FROM portal_receipts WHERE application_id = ?").bind(submitted.id).all();
  for (let read = 0; read < 3; read += 1) {
    const detail = await getCaseDetail(actor, submitted.caseNumber);
    assert.deepEqual(detail.snapshot.replacementCatalogRelation, draft.replacementCatalogRelation);
    assert.deepEqual(detail.snapshot.relatedCatalogRelation, draft.relatedCatalogRelation);
    detail.snapshot.relatedCatalogRelation.reason = "Caller-local edit";
  }
  assert.deepEqual(await storedVersion(submitted.id), before, "reads preserve the exact immutable snapshot and hash");
  assert.deepEqual(await DB.prepare("SELECT * FROM portal_receipts WHERE application_id = ?").bind(submitted.id).all(), receiptsBefore, "detail reads do not regenerate receipts");
});

test("actual historical detail reads retain old labels while missing or malformed relation objects project null", async () => {
  for (const relation of [undefined, "", { kind: "manual", reason: 5 }, { kind: "catalog", id: "legacy", name: "Legacy", revision: "r", internalNote: "must-not-escape" }]) {
    const saved = await saveApplicationDraft(actor, crypto.randomUUID(), state());
    const historical = { ...state(), replacementSystem: "Historisk label", replacementCatalogRelation: relation,
      relatedSystem: "Historisk tilkøb", relatedCatalogRelation: relation };
    const bytes = JSON.stringify(historical);
    const versionId = crypto.randomUUID();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const now = new Date().toISOString();
    await DB.prepare(`INSERT INTO portal_application_versions
      (id, tenant_id, application_id, version_number, schema_version, snapshot_json, snapshot_sha256, submitted_by_user_id, created_at, submitted_at)
      VALUES (?, ?, ?, 1, 'dgita-v1', ?, ?, ?, ?, ?)`).bind(versionId, actor.tenantId, saved.id, bytes, hash, actor.userId, now, now).run();
    await DB.prepare("UPDATE portal_applications SET current_version_id = ?, current_version_number = 1, status = 'submitted' WHERE id = ?").bind(versionId, saved.id).run();
    const before = await storedVersion(saved.id);
    for (let read = 0; read < 3; read += 1) {
      const detail = await getCaseDetail(actor, saved.caseNumber);
      assert.equal(detail.snapshot.replacementSystem, "Historisk label");
      assert.equal(detail.snapshot.relatedSystem, "Historisk tilkøb");
      assert.equal(detail.snapshot.replacementCatalogRelation, null);
      assert.equal(detail.snapshot.relatedCatalogRelation, null);
      assert.equal(JSON.stringify(detail).includes("must-not-escape"), false);
    }
    assert.deepEqual(await storedVersion(saved.id), before);
    assert.equal(before.snapshot_json, bytes);
  }
});
