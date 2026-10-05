import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { portalSchemaStatements } from "../db/persistence.ts";
import { seedPortalDefaults } from "../features/workspace/server-repository.ts";
import { resolvePilotProfile, resolvePilotViewer } from "../features/workspace/pilot-profile.ts";
import { DEMO_VIEWERS, DEMO_CASES, LEGACY_DEMO_VIEWERS, D_GITA_FRAMEWORKS, D_GITA_LEGAL_BASES } from "../features/workspace/model.ts";
import { demoApplicationState, LEGACY_APPROVING_LEADERS, normalizeApprovingLeader } from "../features/application/engine.ts";

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
  return { database, D1: new TestD1Database(database) };
}

function addTenant(database) {
  database.prepare("INSERT INTO portal_tenants (id, slug, name) VALUES ('kalundborg', 'kalundborg', 'Preserved test tenant')").run();
}
function addUser(database, subject, name = "Preserved test user") {
  database.prepare(`INSERT INTO portal_users (id, tenant_id, identity_provider, external_subject, email, display_name)
    VALUES (?, 'kalundborg', 'dev', ?, 'preserved@example.invalid', ?)`).run(subject, subject, name);
}

test("fresh test databases contain neutral identities and persist the synthetic profile", async () => {
  const { database, D1 } = createDatabase();
  try {
    await seedPortalDefaults(D1);
    assert.equal(await resolvePilotProfile(D1), "synthetic-v1");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_users").get().count, 5);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_users WHERE email NOT LIKE '%@example.invalid' OR display_name NOT LIKE 'Test%'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_applications").get().count, 10);
    for (const table of ["portal_users", "portal_applications", "portal_application_versions", "portal_approval_requests", "portal_dgita_approvals", "portal_content_entries"]) {
      const serialized = JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
      assert.equal(/@kalundborg\.dk|Partheepan|Lauridsen|Bjerre|Kjeldsen/u.test(serialized), false, `${table} has no historical identities`);
    }
    assert.equal(database.prepare("SELECT name FROM portal_tenants WHERE id='kalundborg'").get().name, "Testkommune");
    assert.equal((await resolvePilotViewer(D1, "user")).subject, DEMO_VIEWERS.user.subject);
    assert.equal(DEMO_VIEWERS.user.email.endsWith("@example.invalid"), true);
    assert.equal(DEMO_CASES.every((row) => row.ownerEmail.endsWith("@example.invalid")), true);
    assert.equal(JSON.stringify(demoApplicationState).includes("@kalundborg.dk"), false);
  } finally { database.close(); }
});

test("a known existing pilot retains stored identity, municipality and stable subject", async () => {
  const { database, D1 } = createDatabase();
  try {
    addTenant(database);
    addUser(database, LEGACY_DEMO_VIEWERS.user.subject);
    assert.equal(await resolvePilotProfile(D1), "legacy-v1");
    await seedPortalDefaults(D1);
    const viewer = await resolvePilotViewer(D1, "user");
    assert.equal(viewer.subject, LEGACY_DEMO_VIEWERS.user.subject);
    assert.equal(viewer.displayName, "Preserved test user");
    assert.equal(viewer.email, "preserved@example.invalid");
    assert.equal(viewer.municipality, "Preserved test tenant");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_users WHERE external_subject LIKE 'test-%'").get().count, 0);
    assert.equal(database.prepare("SELECT owner_user_id FROM portal_applications WHERE id='demo:ITA-001290'").get().owner_user_id, viewer.subject);
  } finally { database.close(); }
});

test("repeated synthetic seed and login preserve edited identities, content and evolved cases", async () => {
  const { database, D1 } = createDatabase();
  try {
    await seedPortalDefaults(D1);
    database.prepare("UPDATE portal_users SET display_name='Updated test user', email='updated@example.invalid' WHERE id=?").run(DEMO_VIEWERS.user.subject);
    database.prepare("UPDATE portal_content_entries SET value_json='{}' WHERE key='contact.local.email'").run();
    database.prepare("UPDATE portal_applications SET draft_state_json='{}', row_version=2 WHERE id='demo:ITA-001290'").run();
    await seedPortalDefaults(D1);
    assert.equal((await resolvePilotViewer(D1, "user")).email, "updated@example.invalid");
    assert.equal((await resolvePilotViewer(D1, "user")).displayName, "Updated test user");
    assert.equal(database.prepare("SELECT draft_state_json FROM portal_applications WHERE id='demo:ITA-001290'").get().draft_state_json, "{}");
    assert.equal(database.prepare("SELECT value_json FROM portal_content_entries WHERE key='contact.local.email'").get().value_json, "{}");
    assert.equal(await resolvePilotProfile(D1), "synthetic-v1");
  } finally { database.close(); }
});

test("unknown and mixed existing profiles require operator review without inserting data", async () => {
  for (const subjects of [["unknown-test-subject"], [DEMO_VIEWERS.user.subject, LEGACY_DEMO_VIEWERS.user.subject]]) {
    const { database, D1 } = createDatabase();
    try {
      addTenant(database);
      for (const subject of subjects) addUser(database, subject);
      await assert.rejects(seedPortalDefaults(D1), /operator review/);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_users").get().count, subjects.length);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_applications").get().count, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_bootstrap_state").get().count, 0);
    } finally { database.close(); }
  }
});

test("unknown saved profile and missing historical account cannot silently recreate identities", async () => {
  const { database, D1 } = createDatabase();
  try {
    addTenant(database);
    database.prepare(`INSERT INTO portal_bootstrap_state (tenant_id, scope, version, completed_at)
      VALUES ('kalundborg', 'test-fixture-profile', 'future-unknown', '2026-10-05T00:00:00Z')`).run();
    await assert.rejects(resolvePilotProfile(D1), /Unknown test fixture profile/);
    database.prepare("UPDATE portal_bootstrap_state SET version='legacy-v1'").run();
    await assert.rejects(resolvePilotViewer(D1, "user"), /automatic recreation is disabled/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portal_users").get().count, 0);
  } finally { database.close(); }
});

test("framework wire values and historical approver identity normalization keep their meaning", () => {
  assert.deepEqual(D_GITA_FRAMEWORKS, ["NSIS", "NIS2", "GDPR"]);
  assert.equal(D_GITA_LEGAL_BASES, D_GITA_FRAMEWORKS);
  for (const leader of LEGACY_APPROVING_LEADERS) {
    const normalized = normalizeApprovingLeader({ ...demoApplicationState, approvingLeaderId: leader.id, approvingLeader: leader.name });
    assert.equal(normalized.approvingLeaderId, leader.id);
    assert.equal(normalized.approvingLeader, leader.name);
  }
});
