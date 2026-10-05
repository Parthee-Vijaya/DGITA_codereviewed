import manifest from "./migration-manifest.json";

/** A release serves production traffic only with its exact migration ledger. */
export async function assertMigrationState(DB: D1Database) {
  const { results } = await DB.prepare("SELECT id, checksum FROM __dgita_migrations ORDER BY id")
    .all<{ id: string; checksum: string }>();
  if (results.length !== manifest.length || results.some((entry, index) =>
    entry.id !== manifest[index]?.id || entry.checksum !== manifest[index]?.checksum)) {
    throw new Error("PRODUCTION_MIGRATION_MISMATCH");
  }
}
