import assert from "node:assert/strict";
import test from "node:test";

import { initialApplicationState } from "../features/application/engine.ts";
import {
  CaseDetailError,
  normalizeApplicationSnapshotJson,
  ownerScopeUserId,
  withSafeDraftAttachments,
} from "../features/cases/detail-helpers.ts";

test("brugeradgang afgrænses til brugerens ejer-id", () => {
  assert.equal(ownerScopeUserId("user", "user-1"), "user-1");
  assert.equal(ownerScopeUserId("consultant", "consultant-1"), null);
  assert.equal(ownerScopeUserId("admin", "admin-1"), null);
});

test("et lagret snapshot udleverer kun kendte formularfelter", () => {
  const snapshot = normalizeApplicationSnapshotJson(
    JSON.stringify({
      ...initialApplicationState,
      purpose: "Digital understøttelse",
      internalComments: "må ikke udleveres",
      auditEvents: [{ type: "internal" }],
      storageKey: "tenants/secret/document.pdf",
      attachments: {
        contract: [{
          id: "file-1",
          kind: "contract",
          name: "kontrakt.pdf",
          size: 42,
          type: "application/pdf",
          status: "uploaded",
          storageKey: "secret/key",
        }],
      },
    }),
    initialApplicationState,
  );

  assert.equal(snapshot.purpose, "Digital understøttelse");
  assert.equal(snapshot.attachments.contract.length, 1);
  assert.deepEqual(snapshot.attachments.contract[0], {
    id: "file-1",
    kind: "contract",
    name: "kontrakt.pdf",
    size: 42,
    type: "application/pdf",
    status: "uploaded",
  });
  assert.equal("internalComments" in snapshot, false);
  assert.equal("auditEvents" in snapshot, false);
  assert.equal("storageKey" in snapshot, false);
});

test("sparse demo-snapshots normaliseres til formularens kontrakt", () => {
  const snapshot = normalizeApplicationSnapshotJson(
    JSON.stringify({ _demo: { leader: "Test Leder", approval: "Afventer" } }),
    initialApplicationState,
    "Demo System",
  );
  assert.equal(snapshot.schemaVersion, "dgita-v1");
  assert.equal(snapshot.catalogQuery, "Demo System");
  assert.equal(snapshot.approvingLeader, "Test Leder");
  assert.equal(snapshot.hasDpa, "nej");
  assert.equal(snapshot.contactPerson, "");
  assert.equal("_demo" in snapshot, false);
});

test("kladdebilag hydreres uden interne lagernøgler", () => {
  const snapshot = withSafeDraftAttachments(initialApplicationState, [
    {
      id: "file-2",
      kind: "architecture",
      original_name: "arkitektur.pdf",
      size_bytes: 120,
      content_type: "application/pdf",
    },
    {
      id: "ignored",
      kind: "unknown",
      original_name: "ukendt.bin",
      size_bytes: 1,
      content_type: "application/octet-stream",
    },
  ]);
  assert.equal(snapshot.attachments.architecture.length, 1);
  assert.equal(snapshot.attachments.architecture[0].name, "arkitektur.pdf");
});

test("ødelagt snapshot afvises kontrolleret", () => {
  assert.throws(
    () => normalizeApplicationSnapshotJson("{", initialApplicationState),
    (error) => error instanceof CaseDetailError && error.status === 409,
  );
});

test("catalog and manual relations survive detail normalization and repeated reads", () => {
  const source = {
    ...initialApplicationState,
    replacesExisting: "ja", replacementSystem: "Historisk katalognavn",
    replacementCatalogRelation: { kind: "catalog", id: "stable-system-id", name: "Historisk katalognavn", revision: "historical-revision" },
    acquisitionType: "tilkøb", relatedSystem: "Lokalt system",
    relatedCatalogRelation: { kind: "manual", reason: "Systemet fandtes kun i den lokale oversigt ved indsendelsen." },
  };
  const bytes = JSON.stringify(source);
  const baseBytes = JSON.stringify(initialApplicationState);
  for (let read = 0; read < 3; read += 1) {
    const result = normalizeApplicationSnapshotJson(bytes, initialApplicationState);
    assert.deepEqual(result.replacementCatalogRelation, source.replacementCatalogRelation);
    assert.deepEqual(result.relatedCatalogRelation, source.relatedCatalogRelation);
    assert.equal(result.replacementSystem, source.replacementSystem);
    result.relatedCatalogRelation.reason = "Client-side modification";
  }
  assert.equal(JSON.stringify(source), bytes);
  assert.equal(JSON.stringify(initialApplicationState), baseBytes);
});

test("legacy or invalid relation blobs project null without disclosing extra fields or losing labels", () => {
  for (const relation of [undefined, null, "", "legacy", [], { kind: "manual", reason: 3 },
    { kind: "manual", reason: "valid text", internalNote: "must not escape" },
    { kind: "catalog", id: "id", name: "Name" },
    { kind: "catalog", id: "id", name: "Name", revision: "r", storageKey: "private/key" }]) {
    const source = JSON.stringify({ ...initialApplicationState, replacementSystem: "Legacy label", relatedSystem: "Second label",
      replacementCatalogRelation: relation, relatedCatalogRelation: relation });
    const result = normalizeApplicationSnapshotJson(source, initialApplicationState);
    assert.equal(result.replacementCatalogRelation, null);
    assert.equal(result.relatedCatalogRelation, null);
    assert.equal(result.replacementSystem, "Legacy label");
    assert.equal(result.relatedSystem, "Second label");
    assert.equal(JSON.stringify(result).includes("must not escape"), false);
    assert.equal(JSON.stringify(result).includes("private/key"), false);
  }
});
