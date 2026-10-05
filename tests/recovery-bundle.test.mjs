import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsPromises, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { readMigrations } from "../scripts/migration-runner.mjs";
import { createRecoveryBundle, restoreRecoveryBundle, verifyRecoveryBundle } from "../scripts/recovery-bundle.mjs";
import { assertDatabaseEnvironment } from "../db/environment-guard.ts";
import { demoApplicationState } from "../features/application/engine.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "dgita-recovery-"));
  const databasePath = path.join(directory, "source.sqlite");
  const database = new DatabaseSync(databasePath);
  for (const migration of migrations) for (const sql of migration.statements) database.exec(sql);
  database.exec("CREATE TABLE __dgita_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
  for (const migration of migrations) database.prepare("INSERT INTO __dgita_migrations VALUES (?,?,?)").run(migration.id,migration.checksum,"2026-10-05T00:00:00.000Z");
  database.exec("INSERT INTO portal_environment VALUES (1,'test')");
  database.exec("INSERT INTO portal_tenants(id,slug,name) VALUES ('tenant','test','Testkommune')");
  database.exec("INSERT INTO portal_users(id,tenant_id,identity_provider,external_subject,email,display_name) VALUES ('user','tenant','dev','test','test@example.invalid','Testbruger')");
  database.exec("INSERT INTO portal_user_roles(id,tenant_id,user_id,role) VALUES ('role','tenant','user','user')");
  const state = { schemaVersion: "recovery-fixture", state: structuredClone(demoApplicationState) };
  const snapshot = JSON.stringify(state);
  database.prepare(`INSERT INTO portal_applications(id,tenant_id,owner_user_id,case_number,draft_schema_version,draft_state_json,
    status,current_version_number,current_version_id) VALUES ('case','tenant','user','ITA-123456','recovery-fixture',?,'under_review',1,'version')`).run(snapshot);
  const attachment = new TextEncoder().encode("Syntetisk bilag uden personoplysninger");
  const attachmentManifest = [{ id: "attachment", kind: "contract", name: "synthetic.txt", size: attachment.length, contentType: "text/plain", checksum: sha(attachment) }];
  database.prepare(`INSERT INTO portal_application_versions(id,tenant_id,application_id,version_number,schema_version,snapshot_json,
    snapshot_sha256,attachment_manifest_sha256,submitted_by_user_id,submitted_at)
    VALUES ('version','tenant','case',1,'recovery-fixture',?,?,?,'user','2026-10-05T00:00:00.000Z')`)
    .run(snapshot,sha(snapshot),sha(JSON.stringify(attachmentManifest)));
  database.prepare(`INSERT INTO portal_attachments(id,tenant_id,application_id,application_version_id,owner_user_id,kind,original_name,
    size_bytes,content_type,storage_key,checksum_sha256,status,scan_status,uploaded_by_user_id,immutable_at)
    VALUES ('attachment','tenant','case','version','user','contract','synthetic.txt',?,'text/plain','private/attachment',?,'ready','clean','user','2026-10-05')`)
    .run(attachment.length,sha(attachment));
  const document = await PDFDocument.create(); document.addPage().drawText("Synthetic recovery receipt");
  const receipt = await document.save();
  database.prepare(`INSERT INTO portal_receipts(id,tenant_id,application_id,application_version_id,kind,status,storage_key,checksum_sha256,size_bytes)
    VALUES ('receipt','tenant','case','version','submission','ready','private/receipt',?,?)`).run(sha(receipt),receipt.length);
  database.exec("INSERT INTO portal_audit_events(id,tenant_id,application_id,actor_user_id,actor_subject,event_type,entity_type,entity_id) VALUES ('audit','tenant','case','user','test','application.submitted','application','case')");
  database.exec("INSERT INTO portal_sessions(id,tenant_id,user_id,token_hash,provider,expires_at,last_seen_at) VALUES ('session','tenant','user','old-session-hash','dev','2099-01-01','2026-10-05')");
  for (const status of ["pending", "approved"]) database.prepare(`INSERT INTO portal_approval_requests(id,tenant_id,application_id,application_version_id,
    approver_email,approver_name,token_hash,status,decision_comment,created_by_user_id,expires_at)
    VALUES (?,'tenant','case','version','leader@example.invalid','Testleder',?,?,?,'user','2099-01-01')`)
    .run(status,`old-${status}-hash`,status,status === "approved" ? "Syntetisk godkendelse" : null);
  for (const status of ["queued", "processing", "sent"]) database.prepare(`INSERT INTO portal_mail_outbox(id,tenant_id,application_id,
    recipient_email,template_key,subject,text_body,html_body,idempotency_key,status)
    VALUES (?,'tenant','case','test@example.invalid','application.submitted','Synthetic','Synthetic','<p>Synthetic</p>',?,?)`)
    .run(status,status,status);
  database.close();
  const objects = new Map([["private/attachment",attachment],["private/receipt",receipt]]);
  const bundle = path.join(directory,"bundle");
  return { directory,databasePath,objects,bundle, readObject: async (key) => objects.get(key),
    close: () => rm(directory,{recursive:true}) };
}

test("database/files roundtrip preserves case versions, receipt and append-only audit in quarantine", async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.databasePath);
    const exported = await createRecoveryBundle({ ...f, outputDirectory: f.bundle });
    assert.equal(exported.objects,2);
    assert.deepEqual(await readFile(f.databasePath),original);
    const verified = await verifyRecoveryBundle(f.bundle,exported.digest);
    assert.equal(verified.integrity,"ok"); assert.equal(verified.ledger,"exact");
    assert.ok(!JSON.stringify(verified).includes("example.invalid"));
    const target = path.join(f.directory,"restored");
    const result = await restoreRecoveryBundle({directory:f.bundle,expectedDigest:exported.digest,outputDirectory:target});
    assert.equal(result.quarantine,true); assert.ok(result.durationMs >= 0);
    const restored = new DatabaseSync(path.join(target,"database.sqlite"),{readOnly:true});
    try {
      assert.ok(restored.prepare("SELECT revoked_at FROM portal_sessions").get().revoked_at);
      assert.equal(restored.prepare("SELECT status FROM portal_approval_requests WHERE id='pending'").get().status,"cancelled");
      assert.equal(restored.prepare("SELECT status FROM portal_approval_requests WHERE id='approved'").get().status,"approved");
      assert.ok(restored.prepare("SELECT token_hash FROM portal_approval_requests").all().every((row) => !row.token_hash.startsWith("old-")));
      assert.deepEqual(restored.prepare("SELECT status FROM portal_mail_outbox ORDER BY id").all().map((row) => row.status),["cancelled","cancelled","sent"]);
      assert.equal(restored.prepare("SELECT count(*) AS n FROM portal_audit_events").get().n,1);
      const adapter = { prepare: (sql) => ({ first: async () => restored.prepare(sql).get() }) };
      await assert.rejects(assertDatabaseEnvironment(adapter,{DGITA_ENVIRONMENT:"pilot"}),{code:"DATABASE_RECOVERY_QUARANTINED"});
      const receipt = await readFile(path.join(target,"objects",sha(f.objects.get("private/receipt"))));
      assert.equal((await PDFDocument.load(receipt)).getPageCount(),1);
    } finally { restored.close(); }
    await assert.rejects(restoreRecoveryBundle({directory:f.bundle,expectedDigest:exported.digest,outputDirectory:target}),{code:"EEXIST"});
  } finally { await f.close(); }
});

for (const change of ["missing-object","changed-object","symlink-object","changed-database","changed-manifest"]) {
  test(`verification rejects ${change} before creating a restore target`, async () => {
    const f = await fixture();
    try {
      const exported = await createRecoveryBundle({...f,outputDirectory:f.bundle});
      const objectPath = path.join(f.bundle,"objects",sha(f.objects.get("private/attachment")));
      if (change === "missing-object") await rm(objectPath);
      if (change === "changed-object") await writeFile(objectPath,"tampered");
      if (change === "symlink-object") {
        const replacement = path.join(f.directory,"replacement.txt");
        await writeFile(replacement,f.objects.get("private/attachment"));
        await rm(objectPath); await fsPromises.symlink(replacement,objectPath);
      }
      if (change === "changed-database") { const db=new DatabaseSync(path.join(f.bundle,"database.sqlite")); db.exec("UPDATE portal_users SET display_name='changed'"); db.close(); }
      if (change === "changed-manifest") { const file=path.join(f.bundle,"manifest.json"); const manifest=JSON.parse(await readFile(file)); manifest.objects=[]; await writeFile(file,JSON.stringify(manifest)); }
      await assert.rejects(verifyRecoveryBundle(f.bundle,exported.digest));
      await assert.rejects(restoreRecoveryBundle({directory:f.bundle,expectedDigest:exported.digest,outputDirectory:path.join(f.directory,"restore")}));
      await assert.rejects(readFile(path.join(f.directory,"restore","database.sqlite")),{code:"ENOENT"});
    } finally { await f.close(); }
  });
}

for (const change of ["ledger","schema","snapshot","tenant","production","missing-live-object"]) {
  test(`export fails closed for ${change} and publishes no complete manifest`, async () => {
    const f = await fixture();
    try {
      const db=new DatabaseSync(f.databasePath);
      if (change === "ledger") db.exec("UPDATE __dgita_migrations SET checksum='changed'");
      if (change === "schema") db.exec("DROP TRIGGER portal_audit_events_no_delete");
      if (change === "snapshot") { db.exec("DROP TRIGGER portal_application_versions_no_update"); db.exec("UPDATE portal_application_versions SET snapshot_json='{}'"); }
      if (change === "tenant") { db.exec("INSERT INTO portal_tenants(id,slug,name) VALUES('foreign','foreign','Synthetic')"); db.exec("UPDATE portal_users SET tenant_id='foreign'"); }
      if (change === "production") db.exec("UPDATE portal_environment SET purpose='production'");
      db.close();
      if (change === "missing-live-object") f.objects.delete("private/attachment");
      await assert.rejects(createRecoveryBundle({...f,outputDirectory:f.bundle}));
      await assert.rejects(readFile(path.join(f.bundle,"manifest.json")),{code:"ENOENT"});
    } finally { await f.close(); }
  });
}

test("online backup includes committed WAL rows instead of copying a stale main file", async () => {
  const f = await fixture();
  const live = new DatabaseSync(f.databasePath);
  try {
    live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    live.exec("INSERT INTO portal_case_comments(id,tenant_id,application_id,author_user_id,body) VALUES ('wal-comment','tenant','case','user','Syntetisk WAL-test')");
    const exported = await createRecoveryBundle({...f,outputDirectory:f.bundle});
    const verified = await verifyRecoveryBundle(f.bundle,exported.digest);
    assert.equal(verified.tables.portal_case_comments,1);
    const copy = new DatabaseSync(path.join(f.bundle,"database.sqlite"),{readOnly:true});
    try { assert.equal(copy.prepare("SELECT body FROM portal_case_comments WHERE id='wal-comment'").get().body,"Syntetisk WAL-test"); }
    finally { copy.close(); }
  } finally { live.close(); await f.close(); }
});

test("legacy schema copies remain ledgerless and are explicitly labelled test-only", async () => {
  const f = await fixture();
  try {
    const source=new DatabaseSync(f.databasePath); source.exec("DROP TABLE __dgita_migrations"); source.close();
    const exported=await createRecoveryBundle({...f,outputDirectory:f.bundle});
    assert.equal((await verifyRecoveryBundle(f.bundle,exported.digest)).ledger,"missing-legacy-test-only");
    const outputDirectory=path.join(f.directory,"legacy-restore");
    await restoreRecoveryBundle({directory:f.bundle,expectedDigest:exported.digest,outputDirectory});
    const copy=new DatabaseSync(path.join(outputDirectory,"database.sqlite"),{readOnly:true});
    try { assert.equal(copy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='__dgita_migrations'").get().n,0); }
    finally { copy.close(); }
  } finally { await f.close(); }
});

for (const table of ["portal_receipts","portal_approval_requests"]) {
  test(`${table} cannot refer to another case's version in the same tenant`,async () => {
    const f=await fixture();
    try {
      const db=new DatabaseSync(f.databasePath);
      db.exec("INSERT INTO portal_applications(id,tenant_id,owner_user_id,case_number,draft_schema_version,draft_state_json) VALUES ('other-case','tenant','user','ITA-654321','fixture','{}')");
      db.exec(`UPDATE ${table} SET application_id='other-case'`); db.close();
      await assert.rejects(createRecoveryBundle({...f,outputDirectory:f.bundle}),/CROSS_CASE_VERSION_REFERENCE/u);
    } finally { await f.close(); }
  });
}

test("a nonzero current version without its version id cannot pass integrity",async () => {
  const f=await fixture();
  try {
    const db=new DatabaseSync(f.databasePath); db.exec("UPDATE portal_applications SET current_version_id=NULL"); db.close();
    await assert.rejects(createRecoveryBundle({...f,outputDirectory:f.bundle}),/CURRENT_VERSION_REFERENCE_INVALID/u);
  } finally { await f.close(); }
});

test("tenantless test databases are rejected rather than reporting a nonexistent quarantine",async () => {
  const f=await fixture();
  try {
    await rm(f.databasePath); const db=new DatabaseSync(f.databasePath);
    for(const migration of migrations) for(const statement of migration.statements) db.exec(statement);
    db.exec("INSERT INTO portal_environment VALUES(1,'test')"); db.close();
    await assert.rejects(createRecoveryBundle({...f,outputDirectory:f.bundle}),/RECOVERY_TENANT_REQUIRED/u);
  } finally { await f.close(); }
});

test("I/O failure after copying the database never publishes an unquarantined database path",async () => {
  const f=await fixture(); const original=fsPromises.copyFile;
  try {
    const exported=await createRecoveryBundle({...f,outputDirectory:f.bundle});
    fsPromises.copyFile=async(from,to,...args) => {
      if(String(from).includes(`${path.sep}objects${path.sep}`)) throw Object.assign(new Error("Synthetic I/O fault"),{code:"ENOSPC"});
      return original(from,to,...args);
    };
    syncBuiltinESMExports();
    const outputDirectory=path.join(f.directory,"failed-restore");
    await assert.rejects(restoreRecoveryBundle({directory:f.bundle,expectedDigest:exported.digest,outputDirectory}),{code:"ENOSPC"});
    await assert.rejects(readFile(path.join(outputDirectory,"database.sqlite")),{code:"ENOENT"});
    await assert.rejects(readFile(path.join(outputDirectory,"restore-result.json")),{code:"ENOENT"});
  } finally { fsPromises.copyFile=original; syncBuiltinESMExports(); await f.close(); }
});
