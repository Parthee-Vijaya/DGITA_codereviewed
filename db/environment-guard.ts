import { deploymentStage, type RuntimeEnvironment } from "../features/runtime/environment";

export class DatabaseEnvironmentError extends Error {
  readonly code = "DATABASE_ENVIRONMENT_MISMATCH";
  constructor() {
    super("Databasen må ikke deles mellem testmiljø og produktion.");
    this.name = "DatabaseEnvironmentError";
  }
}

export class RecoveryQuarantineError extends Error {
  readonly code = "DATABASE_RECOVERY_QUARANTINED";
  constructor() {
    super("Gendannelseskopien er i karantæne og må kun undersøges med offlineværktøjer.");
    this.name = "RecoveryQuarantineError";
  }
}

/** A durable, one-way label prevents an existing pilot DB becoming production. */
export async function assertDatabaseEnvironment(DB: D1Database, environment: RuntimeEnvironment) {
  const quarantine = await DB.prepare("SELECT tenant_id FROM portal_bootstrap_state WHERE scope = 'recovery-quarantine' LIMIT 1")
    .first<{ tenant_id: string }>();
  if (quarantine) throw new RecoveryQuarantineError();
  const intended = deploymentStage(environment) === "production" ? "production" : "test";
  if (intended === "production") {
    const legacy = await DB.prepare(
      "SELECT COUNT(*) AS count FROM portal_users WHERE identity_provider = 'dev'",
    ).first<{ count: number }>();
    if (Number(legacy?.count ?? 0) > 0) throw new DatabaseEnvironmentError();
  }
  await DB.prepare(
    "INSERT OR IGNORE INTO portal_environment (id, purpose) VALUES (1, ?)",
  ).bind(intended).run();
  const row = await DB.prepare("SELECT purpose FROM portal_environment WHERE id = 1")
    .first<{ purpose: string }>();
  if (row?.purpose !== intended) throw new DatabaseEnvironmentError();
}
