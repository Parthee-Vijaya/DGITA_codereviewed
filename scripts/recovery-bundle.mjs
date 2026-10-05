import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { readMigrations } from "./migration-runner.mjs";
import { compareSchemaContracts, readSchemaContract, schemaFingerprint } from "./schema-contract.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sqlAdapter = (database) => ({ execute: async (sql) => ({ rows: database.prepare(sql).all() }) });
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;

function assertIntegrity(database) {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  assert.equal(integrity.length, 1, "DATABASE_INTEGRITY_FAILED");
  assert.equal(integrity[0].integrity_check, "ok", "DATABASE_INTEGRITY_FAILED");
  assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0, "DATABASE_FOREIGN_KEYS_FAILED");
  assert.equal(database.prepare("SELECT purpose FROM portal_environment WHERE id = 1").get()?.purpose, "test", "RECOVERY_TEST_DATABASE_REQUIRED");
  assert.ok(database.prepare("SELECT count(*) AS n FROM portal_tenants").get().n > 0, "RECOVERY_TENANT_REQUIRED");
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'portal_*'").all().map(({ name }) => name);
  const tenantTables = new Set(tables.filter((table) => database.prepare(`PRAGMA table_info(${quote(table)})`).all().some((column) => column.name === "tenant_id")));
  for (const table of tenantTables) for (const foreignKey of database.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all()) {
    if (!tenantTables.has(foreignKey.table)) continue;
    const mismatched = database.prepare(`SELECT count(*) AS total FROM ${quote(table)} child
      JOIN ${quote(foreignKey.table)} parent ON child.${quote(foreignKey.from)} = parent.${quote(foreignKey.to)}
      WHERE child.tenant_id <> parent.tenant_id`).get().total;
    assert.equal(mismatched, 0, "CROSS_TENANT_REFERENCE");
  }
  for (const table of tables) {
    const columns = database.prepare(`PRAGMA table_info(${quote(table)})`).all().map((column) => column.name);
    if (!columns.includes("application_id") || !columns.includes("application_version_id")) continue;
    assert.equal(database.prepare(`SELECT count(*) AS n FROM ${quote(table)} child
      JOIN portal_application_versions version ON version.id = child.application_version_id
      WHERE child.application_id <> version.application_id`).get().n, 0, "CROSS_CASE_VERSION_REFERENCE");
  }
  assert.equal(database.prepare(`SELECT count(*) AS total FROM portal_applications application
    WHERE (current_version_id IS NULL AND (current_version_number <> 0 OR status <> 'draft'))
    OR (current_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM portal_application_versions version
      WHERE version.id = application.current_version_id AND version.application_id = application.id
      AND version.tenant_id = application.tenant_id AND version.version_number = application.current_version_number))`).get().total,
  0, "CURRENT_VERSION_REFERENCE_INVALID");
  for (const version of database.prepare("SELECT * FROM portal_application_versions").all()) {
    assert.equal(hash(version.snapshot_json), version.snapshot_sha256, "VERSION_SNAPSHOT_HASH_MISMATCH");
    const attachments = database.prepare(`SELECT id, kind, original_name AS name, size_bytes AS size,
      content_type AS contentType, checksum_sha256 AS checksum FROM portal_attachments
      WHERE application_version_id = ? ORDER BY created_at, id`).all(version.id);
    // Historical empty versions may have no manifest; they still cannot hide files.
    if (version.attachment_manifest_sha256 === null) assert.equal(attachments.length, 0, "VERSION_MANIFEST_MISSING");
    else assert.equal(hash(JSON.stringify(attachments)), version.attachment_manifest_sha256, "VERSION_ATTACHMENT_MANIFEST_MISMATCH");
  }
}

async function schemaEvidence(database) {
  const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
  const reference = new DatabaseSync(":memory:");
  try {
    for (const migration of migrations) for (const sql of migration.statements) reference.exec(sql);
    const expected = await readSchemaContract(sqlAdapter(reference));
    const actual = await readSchemaContract(sqlAdapter(database));
    assert.deepEqual(compareSchemaContracts(expected, actual), [], "RECOVERY_SCHEMA_MISMATCH");
    const hasLedger = database.prepare("SELECT 1 FROM sqlite_master WHERE name = '__dgita_migrations'").get();
    if (hasLedger) assert.deepEqual(database.prepare("SELECT id,checksum FROM __dgita_migrations ORDER BY id").all().map((row) => ({ ...row })),
      migrations.map(({ id, checksum }) => ({ id, checksum })), "RECOVERY_LEDGER_MISMATCH");
    return { fingerprint: schemaFingerprint(actual), ledger: hasLedger ? "exact" : "missing-legacy-test-only", migrations: migrations.map(({ id, checksum }) => ({ id, checksum })) };
  } finally { reference.close(); }
}

function references(database) {
  const rows = [
    ...database.prepare("SELECT storage_key AS key, checksum_sha256 AS checksum, size_bytes AS size FROM portal_attachments WHERE status = 'ready' AND deleted_at IS NULL").all(),
    ...database.prepare("SELECT storage_key AS key, checksum_sha256 AS checksum, size_bytes AS size FROM portal_receipts WHERE status = 'ready'").all(),
    ...database.prepare("SELECT storage_key AS key, checksum_sha256 AS checksum, size_bytes AS size FROM portal_images WHERE status = 'ready' AND deleted_at IS NULL").all(),
  ];
  // Legacy unversioned draft storage has no checksum contract. Do not silently
  // issue a complete-bundle claim if those rows exist.
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'application_attachments'").get()) {
    assert.equal(database.prepare("SELECT count(*) AS total FROM application_attachments").get().total, 0, "LEGACY_ATTACHMENT_MAPPING_REQUIRED");
  }
  const byKey = new Map();
  for (const row of rows) {
    assert.ok(typeof row.key === "string" && row.key.length > 0 && row.key.length <= 4096, "OBJECT_REFERENCE_INVALID");
    assert.ok(typeof row.checksum === "string" && HASH.test(row.checksum), "OBJECT_CHECKSUM_REQUIRED");
    assert.ok(Number.isSafeInteger(row.size) && row.size >= 0 && row.size <= MAX_OBJECT_BYTES, "OBJECT_SIZE_INVALID");
    const object = { key: row.key, checksum: row.checksum, size: row.size };
    if (byKey.has(row.key)) assert.deepEqual(byKey.get(row.key), object, "CONFLICTING_OBJECT_REFERENCE");
    byKey.set(row.key, object);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function tableEvidence(database) {
  const result = {};
  for (const { name } of database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'portal_*' ORDER BY name").all()) {
    const rows = database.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all();
    result[name] = { rows: rows.length, digest: hash(JSON.stringify(rows)) };
  }
  return result;
}

function decisionEvidence(database) {
  return hash(JSON.stringify(database.prepare(`SELECT id, tenant_id, application_id, application_version_id,
    approver_email, approver_name, decision_comment, created_by_user_id, created_at, decided_at
    FROM portal_approval_requests ORDER BY id`).all()));
}

async function readRegularFile(filename, limit) {
  const stat = await lstat(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, "UNSAFE_BUNDLE_FILE");
  return readFile(filename);
}

function bundleDigest(manifest) {
  const { digest: ignored, ...payload } = manifest;
  void ignored;
  return hash(JSON.stringify(payload));
}

/** Local test exercise only. A SQLite online backup gives the DB snapshot; all
 * referenced files must then match that snapshot exactly or export fails. */
export async function createRecoveryBundle({ databasePath, outputDirectory, readObject }) {
  const started = performance.now();
  await mkdir(outputDirectory, { mode: 0o700 }); // Exclusive: never overwrite.
  await mkdir(path.join(outputDirectory, "objects"), { mode: 0o700 });
  const source = new DatabaseSync(databasePath, { readOnly: true });
  const snapshotPath = path.join(outputDirectory, "database.sqlite");
  try {
    assertIntegrity(source);
    await backup(source, snapshotPath);
  } finally { source.close(); }
  await chmod(snapshotPath, 0o600);
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  let manifest;
  try {
    assertIntegrity(snapshot);
    const objects = references(snapshot);
    manifest = { version: 1, purpose: "isolated-test-recovery", id: randomUUID(), createdAt: new Date().toISOString(),
      schema: await schemaEvidence(snapshot), databaseChecksum: hash(await readRegularFile(snapshotPath, MAX_DATABASE_BYTES)),
      tables: tableEvidence(snapshot), decisions: decisionEvidence(snapshot), objects };
    for (const object of objects) {
      const value = await readObject(object.key);
      assert.ok(value instanceof Uint8Array, "RECOVERY_OBJECT_MISSING");
      assert.equal(value.byteLength, object.size, "RECOVERY_OBJECT_SIZE_MISMATCH");
      assert.equal(hash(value), object.checksum, "RECOVERY_OBJECT_CHECKSUM_MISMATCH");
      await writeFile(path.join(outputDirectory, "objects", object.checksum), value, { mode: 0o600 });
    }
  } finally { snapshot.close(); }
  manifest.digest = bundleDigest(manifest);
  // Published last: an interrupted export cannot be mistaken for complete.
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { version: 1, digest: manifest.digest, objects: manifest.objects.length,
    databaseBytes: (await lstat(snapshotPath)).size, durationMs: Math.ceil(performance.now() - started) };
}

async function validatedManifest(directory, expectedDigest) {
  assert.ok(HASH.test(expectedDigest), "TRUSTED_EXPORT_DIGEST_REQUIRED");
  const manifest = JSON.parse(await readRegularFile(path.join(directory, "manifest.json"), 4 * 1024 * 1024));
  assert.equal(manifest.version, 1, "BUNDLE_VERSION_UNSUPPORTED");
  assert.equal(manifest.purpose, "isolated-test-recovery", "BUNDLE_PURPOSE_INVALID");
  assert.equal(manifest.digest, expectedDigest, "BUNDLE_DIGEST_MISMATCH");
  assert.equal(bundleDigest(manifest), expectedDigest, "BUNDLE_MANIFEST_CHANGED");
  assert.ok(HASH.test(manifest.databaseChecksum), "BUNDLE_DATABASE_CHECKSUM_INVALID");
  assert.equal(hash(await readRegularFile(path.join(directory, "database.sqlite"), MAX_DATABASE_BYTES)), manifest.databaseChecksum, "BUNDLE_DATABASE_CHANGED");
  const objectDirectory = await lstat(path.join(directory, "objects"));
  assert.ok(objectDirectory.isDirectory() && !objectDirectory.isSymbolicLink(), "UNSAFE_OBJECT_DIRECTORY");
  const database = new DatabaseSync(path.join(directory, "database.sqlite"), { readOnly: true });
  try {
    assertIntegrity(database);
    assert.deepEqual(await schemaEvidence(database), manifest.schema, "BUNDLE_SCHEMA_CHANGED");
    assert.deepEqual(tableEvidence(database), manifest.tables, "BUNDLE_ROWS_CHANGED");
    assert.equal(decisionEvidence(database), manifest.decisions, "BUNDLE_DECISIONS_CHANGED");
    assert.deepEqual(references(database), manifest.objects, "BUNDLE_REFERENCES_CHANGED");
    for (const object of manifest.objects) {
      const value = await readRegularFile(path.join(directory, "objects", object.checksum), MAX_OBJECT_BYTES);
      assert.equal(value.byteLength, object.size, "BUNDLE_OBJECT_SIZE_MISMATCH");
      assert.equal(hash(value), object.checksum, "BUNDLE_OBJECT_CHANGED");
    }
  } finally { database.close(); }
  return manifest;
}

/** Shareable evidence intentionally omits row values, original names and keys. */
export async function verifyRecoveryBundle(directory, expectedDigest) {
  const manifest = await validatedManifest(directory, expectedDigest);
  return { version: 1, digest: manifest.digest, integrity: "ok", objects: manifest.objects.length,
    tables: Object.fromEntries(Object.entries(manifest.tables).map(([name, value]) => [name, value.rows])),
    schema: manifest.schema.fingerprint, ledger: manifest.schema.ledger };
}

export async function restoreRecoveryBundle({ directory, expectedDigest, outputDirectory }) {
  const started = performance.now();
  const manifest = await validatedManifest(directory, expectedDigest);
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(path.join(outputDirectory, "objects"), { mode: 0o700 });
  // An interrupted operation never publishes an ordinary app database path.
  // The staging artifact may contain credentials from the source; it remains
  // private and explicitly incomplete until quarantine and verification pass.
  const restoredPath = path.join(outputDirectory, "database.incomplete");
  await copyFile(path.join(directory, "database.sqlite"), restoredPath);
  await chmod(restoredPath, 0o600);
  assert.equal(hash(await readRegularFile(restoredPath, MAX_DATABASE_BYTES)), manifest.databaseChecksum, "RESTORE_SOURCE_CHANGED");
  for (const object of manifest.objects) {
    await copyFile(path.join(directory, "objects", object.checksum), path.join(outputDirectory, "objects", object.checksum));
    await chmod(path.join(outputDirectory, "objects", object.checksum), 0o600);
    const copied = await readRegularFile(path.join(outputDirectory, "objects", object.checksum), MAX_OBJECT_BYTES);
    assert.equal(hash(copied), object.checksum, "RESTORE_OBJECT_CHANGED");
  }
  const database = new DatabaseSync(restoredPath);
  try {
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    assert.deepEqual(await schemaEvidence(database), manifest.schema, "RESTORE_SCHEMA_CHANGED");
    const now = new Date().toISOString();
    database.prepare("UPDATE portal_sessions SET revoked_at = COALESCE(revoked_at, ?)").run(now);
    for (const { id } of database.prepare("SELECT id FROM portal_approval_requests").all()) {
      database.prepare(`UPDATE portal_approval_requests SET token_hash = ?,
        status = CASE WHEN status IN ('pending','approving','rejecting') THEN 'cancelled' ELSE status END WHERE id = ?`)
        .run(hash(randomBytes(32)), id);
    }
    database.prepare(`UPDATE portal_mail_outbox SET status = 'cancelled', text_body = '[Restorekarantæne]',
      html_body = '<p>Restorekarantæne</p>', attachments_json = '[]', updated_at = ?
      WHERE status <> 'sent'`).run(now);
    for (const { id } of database.prepare("SELECT id FROM portal_tenants").all()) {
      database.prepare(`INSERT INTO portal_bootstrap_state (tenant_id,scope,version,completed_at)
        VALUES (?, 'recovery-quarantine', ?, ?) ON CONFLICT(tenant_id,scope)
        DO UPDATE SET version = excluded.version, completed_at = excluded.completed_at`).run(id, manifest.id, now);
    }
    database.exec("COMMIT");
    assertIntegrity(database);
    const after = tableEvidence(database);
    const operationalTables = new Set(["portal_sessions", "portal_approval_requests", "portal_mail_outbox", "portal_bootstrap_state"]);
    for (const [table, evidence] of Object.entries(manifest.tables)) {
      if (!operationalTables.has(table)) assert.deepEqual(after[table], evidence, "RESTORE_BUSINESS_DATA_CHANGED");
      else if (table !== "portal_bootstrap_state") assert.equal(after[table].rows, evidence.rows, "RESTORE_ROWS_LOST");
    }
    assert.equal(decisionEvidence(database), manifest.decisions, "RESTORE_DECISIONS_CHANGED");
    assert.deepEqual(references(database), manifest.objects, "RESTORE_FILE_REFERENCES_CHANGED");
    assert.equal(database.prepare("SELECT count(*) AS n FROM portal_sessions WHERE revoked_at IS NULL").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM portal_approval_requests WHERE status IN ('pending','approving','rejecting')").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM portal_mail_outbox WHERE status NOT IN ('sent','cancelled')").get().n, 0);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* The transaction may already be committed; result still fails closed. */ }
    throw error;
  } finally { database.close(); }
  const result = { version: 1, sourceDigest: expectedDigest, quarantine: true, businessDataPreserved: true,
    oldSessionsRevoked: true, oldBearerLinksInvalidated: true, mailDisabled: true,
    objects: manifest.objects.length, durationMs: Math.ceil(performance.now() - started) };
  await rename(restoredPath, path.join(outputDirectory, "database.sqlite"));
  await writeFile(path.join(outputDirectory, "restore-result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return result;
}
