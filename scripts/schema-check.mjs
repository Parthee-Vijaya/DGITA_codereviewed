import { DatabaseSync } from "node:sqlite";
import { readMigrations } from "./migration-runner.mjs";
import { compareSchemaContracts, readSchemaContract, schemaFingerprint } from "./schema-contract.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--database" || !args[1] || args[1] === ":memory:") {
  console.error("Usage: node scripts/schema-check.mjs --database <isolated-sqlite-copy>");
  process.exit(2);
}

const adapter = (db) => ({ execute: async (sql) => ({ rows: db.prepare(sql).all() }) });
let reference;
let candidate;
try {
  const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
  reference = new DatabaseSync(":memory:");
  for (const migration of migrations) for (const sql of migration.statements) reference.exec(sql);
  candidate = new DatabaseSync(args[1], { readOnly: true });
  const expected = await readSchemaContract(adapter(reference));
  const actual = await readSchemaContract(adapter(candidate));
  const differences = compareSchemaContracts(expected, actual);
  const ledgerPresent = candidate.prepare("SELECT 1 FROM sqlite_master WHERE name = '__dgita_migrations' AND type = 'table'").get();
  const ledger = ledgerPresent ? candidate.prepare("SELECT id, checksum FROM __dgita_migrations ORDER BY id").all() : [];
  const ledgerMatches = Boolean(ledgerPresent) && JSON.stringify(ledger) === JSON.stringify(migrations.map(({ id, checksum }) => ({ id, checksum })));
  const integrity = candidate.prepare("PRAGMA integrity_check").all();
  const integrityOk = integrity.length === 1 && integrity[0].integrity_check === "ok";
  const foreignKeyErrors = candidate.prepare("PRAGMA foreign_key_check").all().length;
  console.log(JSON.stringify({ version: 1, mode: "read-only", expectedFingerprint: schemaFingerprint(expected),
    actualFingerprint: schemaFingerprint(actual), differences, integrityOk, foreignKeyErrors,
    ledger: ledgerMatches ? "exact" : ledgerPresent ? "mismatch" : "missing",
    migrationAuthorized: false }, null, 2));
  if (differences.length || !ledgerMatches || !integrityOk || foreignKeyErrors) process.exitCode = 1;
} catch {
  // SQLite errors may contain paths or data. Do not include them in shareable evidence.
  console.error("Schema inspection failed; no data or ledger was changed. Inspect the isolated copy in a restricted environment.");
  process.exitCode = 1;
} finally { candidate?.close(); reference?.close(); }
