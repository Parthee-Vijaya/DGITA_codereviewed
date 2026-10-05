import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readMigrations } from "../scripts/migration-runner.mjs";
import { readSchemaContract, compareSchemaContracts } from "../scripts/schema-contract.mjs";
import { portalSchemaStatements } from "../db/persistence.ts";

const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
const adapter = (db) => ({ execute: async (sql) => ({ rows: db.prepare(sql).all() }) });
function fixture(statements) {
  const db = new DatabaseSync(":memory:");
  for (const statement of statements) db.exec(statement);
  return db;
}

test("migration and pilot bootstrap have identical columns, indexes, foreign keys, checks and triggers", async () => {
  const migrated = fixture(migrations.flatMap((migration) => migration.statements));
  const bootstrapped = fixture(portalSchemaStatements);
  try {
    assert.deepEqual(compareSchemaContracts(await readSchemaContract(adapter(migrated)), await readSchemaContract(adapter(bootstrapped))), []);
  } finally { migrated.close(); bootstrapped.close(); }
});

test("schema contract detects missing protections and altered constraints", async () => {
  const db = fixture(portalSchemaStatements);
  try {
    const expected = await readSchemaContract(adapter(db));
    db.exec("DROP TRIGGER portal_audit_events_no_update");
    db.exec("DROP INDEX portal_users_tenant_provider_subject_uidx");
    db.exec("ALTER TABLE portal_sessions ADD COLUMN accidental_secret TEXT");
    db.exec("CREATE TABLE portal_unreviewed (id TEXT)");
    const differences = compareSchemaContracts(expected, await readSchemaContract(adapter(db)));
    assert.deepEqual(differences, [
      { table: "portal_audit_events", kind: "triggers" },
      { table: "portal_sessions", kind: "columns" },
      { table: "portal_unreviewed", kind: "unexpected-table" },
      { table: "portal_users", kind: "indexes" },
    ]);
    const changed = structuredClone(expected);
    changed.tables.portal_sessions.foreignKeys[0].onDelete = "CASCADE";
    changed.tables.portal_environment.checks = [];
    assert.deepEqual(compareSchemaContracts(expected, changed), [
      { table: "portal_environment", kind: "checks" }, { table: "portal_sessions", kind: "foreignKeys" },
    ]);
  } finally { db.close(); }
});

test("upgrade from the previous migration preserves existing synthetic tenant and user", async () => {
  const db = fixture(migrations.slice(0, -1).flatMap((migration) => migration.statements));
  try {
    db.exec("INSERT INTO portal_tenants (id,slug,name) VALUES ('tenant-fixture','fixture','Testkommune')");
    db.exec("INSERT INTO portal_users (id,tenant_id,identity_provider,external_subject,email,display_name) VALUES ('user-fixture','tenant-fixture','dev','fixture','fixture@example.invalid','Testbruger')");
    const before = db.prepare("SELECT * FROM portal_users").all();
    for (const statement of migrations.at(-1).statements) db.exec(statement);
    assert.deepEqual(db.prepare("SELECT * FROM portal_users").all(), before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const fresh = fixture(migrations.flatMap((migration) => migration.statements));
    try { assert.deepEqual(compareSchemaContracts(await readSchemaContract(adapter(fresh)), await readSchemaContract(adapter(db))), []); }
    finally { fresh.close(); }
  } finally { db.close(); }
});

test("legacy inspection cannot write a baseline or change rows, even when schema matches", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dgita-schema-inspection-"));
  const file = path.join(directory, "legacy.sqlite");
  const db = new DatabaseSync(file);
  try {
    for (const statement of portalSchemaStatements) db.exec(statement);
    db.exec("INSERT INTO portal_tenants (id,slug,name) VALUES ('fixture','fixture','Synthetic private name')");
  } finally { db.close(); }
  try {
    const before = await readFile(file);
    const result = spawnSync(process.execPath, [new URL("../scripts/schema-check.mjs", import.meta.url).pathname, "--database", file], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ledger, "missing");
    assert.equal(report.migrationAuthorized, false);
    assert.deepEqual(report.differences, []);
    assert.equal(report.actualFingerprint, report.expectedFingerprint);
    assert.ok(!result.stdout.includes("Synthetic private name"));
    assert.deepEqual(await readFile(file), before);
    const reopened = new DatabaseSync(file, { readOnly: true });
    try { assert.equal(reopened.prepare("SELECT count(*) AS total FROM sqlite_master WHERE name = '__dgita_migrations'").get().total, 0); }
    finally { reopened.close(); }
  } finally { await rm(directory, { recursive: true }); }
});

test("contract detects CHECK, FK grouping and expression-index drift on real SQLite schemas", async () => {
  const original = fixture([
    "CREATE TABLE portal_parent (id TEXT PRIMARY KEY, other TEXT UNIQUE)",
    "CREATE TABLE portal_child (id TEXT, other TEXT, CHECK (length(id) > 0), FOREIGN KEY(id,other) REFERENCES portal_parent(id,other))",
    "CREATE INDEX portal_child_expression ON portal_child (lower(id))",
  ]);
  const modified = fixture([
    "CREATE TABLE portal_parent (id TEXT PRIMARY KEY, other TEXT UNIQUE)",
    "CREATE TABLE portal_child (id TEXT, other TEXT, CHECK (length(id) >= 0), FOREIGN KEY(id) REFERENCES portal_parent(id), FOREIGN KEY(other) REFERENCES portal_parent(other))",
    "CREATE INDEX portal_child_expression ON portal_child (upper(id))",
  ]);
  try {
    assert.deepEqual(compareSchemaContracts(await readSchemaContract(adapter(original)), await readSchemaContract(adapter(modified))),
      ["indexes", "foreignKeys", "checks"].map((kind) => ({ table: "portal_child", kind })));
  } finally { original.close(); modified.close(); }
});

test("a trigger outside the portal naming convention cannot evade the contract", async () => {
  const db = fixture(portalSchemaStatements);
  try {
    const before = await readSchemaContract(adapter(db));
    db.exec("CREATE TRIGGER unexpected_side_effect AFTER UPDATE ON portal_users BEGIN SELECT 1; END");
    assert.deepEqual(compareSchemaContracts(before, await readSchemaContract(adapter(db))), [{ table: "portal_users", kind: "triggers" }]);
  } finally { db.close(); }
});
