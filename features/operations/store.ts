import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import { projectHeartbeat, type JobHeartbeat } from "./policy";

export const HEARTBEAT_SCOPE = "operations:maintenance:v1";

export async function persistJobHeartbeat(DB: D1Database, input: JobHeartbeat, completedAt: string) {
  const projected = projectHeartbeat(input);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(completedAt) || new Date(completedAt).toISOString() !== completedAt) throw new Error("Invalid heartbeat time.");
  const result = await DB.prepare(`INSERT INTO portal_bootstrap_state (tenant_id, scope, version, completed_at)
    SELECT tenant.id, ?, ?, ? FROM portal_tenants tenant
    WHERE tenant.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM portal_bootstrap_state quarantine WHERE quarantine.scope = 'recovery-quarantine')
    ON CONFLICT(tenant_id, scope) DO UPDATE SET version = excluded.version, completed_at = excluded.completed_at
    WHERE excluded.completed_at > portal_bootstrap_state.completed_at
      OR (excluded.completed_at = portal_bootstrap_state.completed_at AND json_extract(excluded.version, '$.status') = 'failed')`)
    .bind(HEARTBEAT_SCOPE, JSON.stringify(projected), completedAt).run();
  const rowsAffected = Number(result.meta.changes);
  if (Number.isSafeInteger(rowsAffected) && rowsAffected > 0) return { status: "written" as const, rowsAffected };
  if (rowsAffected !== 0) throw new Error("Heartbeat write could not be confirmed.");
  const state = await DB.prepare(`SELECT
    (SELECT COUNT(*) FROM portal_bootstrap_state WHERE scope = 'recovery-quarantine') AS quarantined,
    (SELECT COUNT(*) FROM portal_tenants WHERE status = 'active') AS active,
    (SELECT COUNT(*) FROM portal_tenants tenant WHERE tenant.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM portal_bootstrap_state heartbeat WHERE heartbeat.tenant_id = tenant.id
        AND heartbeat.scope = ? AND heartbeat.completed_at >= ?)) AS missing`)
    .bind(HEARTBEAT_SCOPE, completedAt).first<{ quarantined: number; active: number; missing: number }>();
  if (!state || state.quarantined > 0 || state.active === 0 || state.missing > 0) throw new Error("Heartbeat was not recorded.");
  return { status: "superseded" as const, rowsAffected: 0 };
}

export async function recordJobHeartbeat(input: JobHeartbeat, completedAt: string) {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  return persistJobHeartbeat(DB, input, completedAt);
}
