import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema.ts";
import { initialApplicationState } from "../features/application/engine.ts";
import { isApplicationFormState } from "../features/application/state-validation.ts";
import { normalizeApplicationSnapshotJson } from "../features/cases/detail-helpers.ts";

const inventory = JSON.parse(readFileSync(new URL("../docs/privacy/data-inventory.json", import.meta.url), "utf8"));

test("every form field and database column has an explicit reviewed inventory entry", () => {
  const fields = Object.values(inventory.form_groups).flatMap((group) => group.fields);
  assert.equal(new Set(fields).size, fields.length);
  assert.deepEqual(fields.sort(), Object.keys(initialApplicationState).sort());
  const tables = Object.values(schema).map(getTableConfig);
  assert.deepEqual(inventory.tables.map((table) => table.table).sort(), tables.map((table) => table.name).sort());
  for (const table of tables) {
    const item = inventory.tables.find((candidate) => candidate.table === table.name);
    const columns = Object.values(item.columns_by_category).flat();
    assert.equal(new Set(columns).size, columns.length, table.name);
    assert.deepEqual(columns.sort(), table.columns.map((column) => column.name).sort(), table.name);
    assert.equal(item.ordinary_log, "forbidden");
    assert.equal(item.retention_decision, "U");
    assert.ok(inventory.flows[item.flow]);
  }
});

test("inventory dataflow implementation references exist and do not assert municipal acceptance", () => {
  for (const flow of Object.values(inventory.flows)) {
    assert.ok(flow.path.length > 1);
    assert.ok(flow.external.length > 0);
    for (const path of flow.code) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  }
  for (const group of Object.values(inventory.form_groups)) {
    assert.equal(group.necessity_acceptance, "U");
    assert.equal(group.ordinary_log, "forbidden");
    assert.ok(inventory.flows[group.flow]);
  }
});

test("synthetic canaries in unrequested internal fields cannot enter the public form payload", () => {
  const canary = `synthetic-private-${crypto.randomUUID()}@example.invalid`;
  const stored = {
    ...initialApplicationState,
    purpose: "Requested test purpose",
    bearer: canary,
    internalComments: canary,
    auditEvents: [{ payload: canary }],
    selectedSystem: {
      id: "test-system", name: "Testsystem", supplier: "Testleverandør", rightsHolder: "Testrettighedshaver",
      source: "kitos", usedInKalundborg: false, internalSecret: canary,
    },
    attachments: { ...initialApplicationState.attachments, contract: [{
      id: "test-file", name: "test.pdf", kind: "contract", size: 4,
      type: "application/pdf", status: "uploaded", storageKey: canary, ownerEmail: canary,
    }] },
  };
  assert.equal(isApplicationFormState(stored), false);
  const payload = normalizeApplicationSnapshotJson(JSON.stringify(stored), initialApplicationState);
  assert.equal(payload.purpose, "Requested test purpose");
  assert.equal(payload.attachments.contract.length, 1);
  assert.equal(payload.selectedSystem.id, "test-system");
  // Assertions return booleans so even a regression does not print the canary itself.
  assert.equal(JSON.stringify(payload).includes(canary), false);
});
