import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { portalSchemaStatements } from "../db/persistence.ts";
import {
  resolveCaseApproval,
  seedPortalDefaults,
} from "../features/workspace/server-repository.ts";

class TestD1Statement {
  constructor(statement, bindings = []) {
    this.statement = statement;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new TestD1Statement(this.statement, bindings);
  }

  async run() {
    const result = this.statement.run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.statement.get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.bindings) };
  }
}

class TestD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const statement of portalSchemaStatements) database.exec(statement);
  database.exec(`INSERT INTO portal_tenants (id, slug, name) VALUES ('kalundborg', 'kalundborg', 'Historical test tenant');
    INSERT INTO portal_bootstrap_state (tenant_id, scope, version, completed_at)
    VALUES ('kalundborg', 'test-fixture-profile', 'legacy-v1', '2026-10-05T00:00:00Z')`);
  return { database, D1: new TestD1Database(database) };
}

test("Afventer-demoer har ingen falsk aktiv request, men bevarer den viste demostatus", async () => {
  const { database, D1 } = createDatabase();
  await seedPortalDefaults(D1);

  const dummyPending = database.prepare(`
    SELECT COUNT(*) AS count
    FROM portal_approval_requests
    WHERE id IN (
      'demo-approval-request:ITA-001278',
      'demo-approval-request:ITA-001280'
    ) AND status = 'pending'
  `).get();
  assert.equal(dummyPending.count, 0);

  const pendingDemo = database.prepare(`
    SELECT status, phase, current_version_number, current_version_id,
           draft_state_json
    FROM portal_applications
    WHERE id = 'demo:ITA-001280'
  `).get();
  const metadata = JSON.parse(pendingDemo.draft_state_json)._demo;
  assert.equal(pendingDemo.status, "submitted");
  assert.equal(pendingDemo.phase, "Indsendt");
  assert.equal(pendingDemo.current_version_number, 1);
  assert.equal(pendingDemo.current_version_id, "demo-version:ITA-001280");
  assert.equal(resolveCaseApproval(null, metadata.approval), "Afventer");

  assert.equal(resolveCaseApproval("pending", metadata.approval), "Afventer");
  assert.equal(resolveCaseApproval("approving", metadata.approval), "Afventer");
  assert.equal(resolveCaseApproval("approved", metadata.approval), "Godkendt");
  assert.equal(resolveCaseApproval("rejected", metadata.approval), "Afvist");
  assert.equal(resolveCaseApproval("cancelled", metadata.approval), "Ikke startet");
  database.close();
});

test("gentagen seedning bevarer en udviklet demo-sag på version 2", async () => {
  const { database, D1 } = createDatabase();
  await seedPortalDefaults(D1);

  const customDraft = JSON.stringify({
    schemaVersion: "dgita-v1",
    manualSystemName: "Bevar version 2",
    purpose: "Rettet indhold må ikke overskrives",
  });
  database.prepare(`
    INSERT INTO portal_application_versions
      (id, tenant_id, application_id, version_number, schema_version,
       snapshot_json, snapshot_sha256, attachment_manifest_sha256,
       submitted_by_user_id, created_at, submitted_at)
    VALUES (?, 'kalundborg', 'demo:ITA-001280', 2, 'dgita-v1', ?,
            'version-2-sha', 'manifest-2-sha', 'kalundborg-user-anita-lauridsen',
            '2026-08-27T08:00:00.000Z', '2026-08-27T08:00:00.000Z')
  `).run("version-2", customDraft);
  database.prepare(`
    UPDATE portal_applications
    SET status = 'changes_requested', phase = 'Indsendt',
        draft_state_json = ?, row_version = 7,
        current_version_number = 2, current_version_id = 'version-2'
    WHERE id = 'demo:ITA-001280'
  `).run(customDraft);

  await seedPortalDefaults(D1);

  const evolved = database.prepare(`
    SELECT status, phase, draft_state_json, row_version,
           current_version_number, current_version_id
    FROM portal_applications
    WHERE id = 'demo:ITA-001280'
  `).get();
  assert.deepEqual({ ...evolved }, {
    status: "changes_requested",
    phase: "Indsendt",
    draft_state_json: customDraft,
    row_version: 7,
    current_version_number: 2,
    current_version_id: "version-2",
  });
  database.close();
});

test("seedningen reparerer kun kendte legacy-demoafvigelser", async () => {
  const { database, D1 } = createDatabase();
  await seedPortalDefaults(D1);

  database.exec(`
    UPDATE portal_applications
    SET status = 'submitted', phase = 'Indsendt',
        current_version_number = 0, current_version_id = NULL
    WHERE id = 'demo:ITA-001213';

    UPDATE portal_dgita_approvals
    SET application_version_id = NULL
    WHERE id = 'approval:kalundborg:demo:ITA-001284';

    UPDATE portal_applications
    SET draft_state_json = '{}'
    WHERE id = 'demo:ITA-001280';

    INSERT INTO portal_approval_requests
      (id, tenant_id, application_id, application_version_id,
       approver_email, approver_name, token_hash, status, decision_comment,
       created_by_user_id, created_at, expires_at, decided_at)
    VALUES (
      'demo-approval-request:ITA-001280', 'kalundborg', 'demo:ITA-001280',
      'demo-version:ITA-001280', 'partheepan.vijayamohan@kalundborg.dk',
      'Partheepan Vijayamohan', 'demo-token-hash:ITA-001280', 'pending', NULL,
      'demo-consultant-casper', '2026-06-30T09:04:00.000Z',
      '2099-12-31T23:59:59.000Z', NULL
    );
  `);

  await seedPortalDefaults(D1);

  const repairedApplication = database.prepare(`
    SELECT status, phase, row_version, current_version_number, current_version_id
    FROM portal_applications
    WHERE id = 'demo:ITA-001213'
  `).get();
  assert.deepEqual({ ...repairedApplication }, {
    status: "under_review",
    phase: "Under behandling",
    row_version: 1,
    current_version_number: 1,
    current_version_id: "demo-version:ITA-001213",
  });

  const repairedApproval = database.prepare(`
    SELECT application_version_id
    FROM portal_dgita_approvals
    WHERE id = 'approval:kalundborg:demo:ITA-001284'
  `).get();
  assert.equal(repairedApproval.application_version_id, "demo-version:ITA-001284");

  const obsoleteRequest = database.prepare(`
    SELECT id FROM portal_approval_requests
    WHERE id = 'demo-approval-request:ITA-001280'
  `).get();
  assert.equal(obsoleteRequest, undefined);

  const repairedPendingMetadata = database.prepare(`
    SELECT draft_state_json
    FROM portal_applications
    WHERE id = 'demo:ITA-001280'
  `).get();
  assert.equal(
    JSON.parse(repairedPendingMetadata.draft_state_json)._demo.approval,
    "Afventer",
  );
  database.close();
});
