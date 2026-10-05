import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, readMigrations } from "../scripts/migration-runner.mjs";

const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);

async function isolatedDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "dgita-migrations-"));
  // libSQL opens a separate connection for interactive transactions. A file
  // fixture exercises their real commit/rollback semantics, unlike :memory:.
  const client = createClient({ url: `file:${path.join(directory, "test.sqlite")}` });
  return { client, close: async () => { client.close(); await rm(directory, { recursive: true }); } };
}

test("all release migrations apply atomically, preserve constraints and can be repeated", async () => {
  const { client, close } = await isolatedDatabase();
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    assert.equal((await applyMigrations(client, migrations)).length, migrations.length);
    assert.deepEqual(await applyMigrations(client, migrations), []);
    assert.equal((await client.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
    assert.deepEqual((await client.execute("PRAGMA foreign_key_check")).rows, []);
    const triggers = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")).rows;
    for (const name of ["portal_audit_events_no_update", "portal_application_versions_no_delete", "portal_versioned_attachments_no_update"]) {
      assert.ok(triggers.some((t) => t.name === name));
    }
    await assert.rejects(client.execute("INSERT INTO portal_environment (id,purpose) VALUES (2,'production')"));
  } finally { await close(); }
});

test("a failed migration rolls back its DDL and the ledger; changed historical SQL is rejected", async () => {
  const { client, close } = await isolatedDatabase();
  try {
    await applyMigrations(client, migrations);
    await assert.rejects(applyMigrations(client, [{ id: "test_failure", checksum: "synthetic", statements: ["CREATE TABLE must_rollback (id TEXT)", "INSERT INTO missing_table VALUES (1)"] }]));
    assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name = 'must_rollback'")).rows.length, 0);
    assert.equal((await client.execute("SELECT id FROM __dgita_migrations WHERE id = 'test_failure'")).rows.length, 0);
    await assert.rejects(applyMigrations(client, [{ ...migrations[0], checksum: "changed" }]), /Previously applied migration changed/u);
  } finally { await close(); }
});
