const seedPromises = new WeakMap<object, Map<string, Promise<void>>>();

export const PORTAL_DEFAULT_SEED = {
  tenantId: "kalundborg",
  scope: "demo-defaults",
  version: "2026-10-05-v3",
} as const;

type SeedIdentity = {
  tenantId: string;
  scope: string;
  version: string;
};

/**
 * Runs the idempotent test seed once per schema version and records completion
 * in SQL. The in-process promise also coalesces concurrent requests in one
 * warm runtime; the durable marker avoids repeating the seed after cold starts.
 */
export async function ensureVersionedSeed(
  DB: D1Database,
  identity: SeedIdentity,
  seed: (database: D1Database) => Promise<void>,
) {
  const databaseKey = DB as unknown as object;
  const identityKey = `${identity.tenantId}\0${identity.scope}\0${identity.version}`;
  let databasePromises = seedPromises.get(databaseKey);
  if (!databasePromises) {
    databasePromises = new Map();
    seedPromises.set(databaseKey, databasePromises);
  }
  let pending = databasePromises.get(identityKey);
  if (!pending) {
    pending = runVersionedSeed(DB, identity, seed).catch((error) => {
      databasePromises.delete(identityKey);
      throw error;
    });
    databasePromises.set(identityKey, pending);
  }
  await pending;
}

async function runVersionedSeed(
  DB: D1Database,
  identity: SeedIdentity,
  seed: (database: D1Database) => Promise<void>,
) {
  const completed = await DB.prepare(`
    SELECT version FROM portal_bootstrap_state
    WHERE tenant_id = ? AND scope = ?
    LIMIT 1
  `).bind(identity.tenantId, identity.scope).first<{ version: string }>();
  if (completed?.version === identity.version) return;

  await seed(DB);
  await DB.prepare(`
    INSERT INTO portal_bootstrap_state
      (tenant_id, scope, version, completed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, scope) DO UPDATE SET
      version = excluded.version,
      completed_at = excluded.completed_at
  `).bind(
    identity.tenantId,
    identity.scope,
    identity.version,
    new Date().toISOString(),
  ).run();
}
