import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readMigrations(directory) {
  const journal = JSON.parse(await readFile(path.join(directory, "meta/_journal.json"), "utf8"));
  return Promise.all(journal.entries.map(async (entry) => {
    if (!/^\d{4}_[a-z0-9_]+$/u.test(entry.tag)) throw new Error("Invalid migration identifier");
    const sql = await readFile(path.join(directory, `${entry.tag}.sql`), "utf8");
    return { id: entry.tag, checksum: createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean) };
  }));
}

export async function applyMigrations(client, migrations) {
  await client.execute(`CREATE TABLE IF NOT EXISTS __dgita_migrations (
    id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const applied = [];
  for (const migration of migrations) {
    const transaction = await client.transaction("write");
    try {
      const existing = await transaction.execute({ sql: "SELECT checksum FROM __dgita_migrations WHERE id = ?", args: [migration.id] });
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Previously applied migration changed: ${migration.id}`);
      } else {
        for (const statement of migration.statements) await transaction.execute(statement);
        await transaction.execute({ sql: "INSERT INTO __dgita_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", args: [migration.id, migration.checksum, new Date().toISOString()] });
        applied.push(migration.id);
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally { transaction.close(); }
  }
  return applied;
}
