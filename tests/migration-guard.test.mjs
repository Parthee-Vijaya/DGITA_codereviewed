import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readMigrations } from "../scripts/migration-runner.mjs";
import { assertMigrationState } from "../db/migration-guard.ts";

const manifest = JSON.parse(await readFile(new URL("../db/migration-manifest.json", import.meta.url)));
const database = (results) => ({ prepare: () => ({ all: async () => ({ results }) }) });

test("the committed manifest must match every migration's actual bytes", async () => {
  const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
  assert.deepEqual(manifest, migrations.map(({ id, checksum }) => ({ id, checksum })));
});

test("production rejects missing, altered and newer migration ledgers", async () => {
  await assertMigrationState(database(manifest));
  for (const entries of [manifest.slice(1), manifest.map((entry, index) => index ? entry : { ...entry, checksum: "altered" }), [...manifest, { id: "future", checksum: "unknown" }]]) {
    await assert.rejects(assertMigrationState(database(entries)), /PRODUCTION_MIGRATION_MISMATCH/);
  }
});
