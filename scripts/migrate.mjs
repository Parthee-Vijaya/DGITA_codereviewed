import { createClient } from "@libsql/client";
import { applyMigrations, readMigrations } from "./migration-runner.mjs";

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN through the deployment secret store.");
  process.exit(1);
}
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  const applied = await applyMigrations(client, await readMigrations(new URL("../drizzle/", import.meta.url).pathname));
  const integrity = await client.execute("PRAGMA integrity_check");
  const foreignKeys = await client.execute("PRAGMA foreign_key_check");
  if (integrity.rows[0]?.integrity_check !== "ok" || foreignKeys.rows.length) throw new Error("Database integrity check failed");
  console.log(JSON.stringify({ applied, integrity: "ok", foreignKeys: "ok" }));
} catch {
  console.error("Migration failed. No provider response or connection details were logged. Check the migration and the database's restricted audit log.");
  process.exitCode = 1;
} finally { client.close(); }
