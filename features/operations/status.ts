import { AuthHttpError } from "../auth/http";
import type { ServerActor } from "../auth/types";
import type { RuntimeEnvironment } from "../runtime/environment";
import { HEARTBEAT_SCOPE } from "./store";
import { ageSeconds, operationsThresholds, parseHeartbeat } from "./policy";

/** Tenant-scoped aggregate only; current DB mandate protects even a stale caller actor. */
export async function readOperationsStatus(DB: D1Database, actor: ServerActor, environment: RuntimeEnvironment, now = Date.now()) {
  if (actor.role !== "admin") throw new AuthHttpError(403, "OPERATIONS_FORBIDDEN", "Driftsstatus kræver administratoradgang.");
  const operator = await DB.prepare(`SELECT users.id FROM portal_users users
    JOIN portal_tenants tenant ON tenant.id = users.tenant_id AND tenant.status = 'active'
    JOIN portal_user_roles roles ON roles.user_id = users.id AND roles.tenant_id = users.tenant_id AND roles.role = 'admin'
    WHERE users.id = ? AND users.tenant_id = ? AND users.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM portal_bootstrap_state WHERE scope = 'recovery-quarantine') LIMIT 1`)
    .bind(actor.userId, actor.tenantId).first<{ id: string }>();
  if (!operator) throw new AuthHttpError(403, "OPERATIONS_FORBIDDEN", "Driftsstatus kræver aktiv administratoradgang.");
  const [queue, scan, heartbeat] = await Promise.all([
    DB.prepare(`SELECT COUNT(*) AS unresolved,
      COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END),0) AS queued,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END),0) AS processing,
      MIN(CASE WHEN status IN ('queued','processing') THEN created_at END) AS oldest,
      COALESCE(SUM(CASE WHEN status = 'failed' AND last_error IN ('MAIL_DELIVERY_STATE_UNKNOWN','GRAPH_TIMEOUT','GRAPH_NETWORK_ERROR') THEN 1 ELSE 0 END),0) AS uncertain
      FROM portal_mail_outbox WHERE tenant_id = ? AND status IN ('queued','processing','failed')`)
      .bind(actor.tenantId).first<{ unresolved: number; queued: number; failed: number; processing: number; oldest: string | null; uncertain: number }>(),
    DB.prepare(`SELECT COUNT(*) AS retained,
      COALESCE(SUM(CASE WHEN scan_status = 'failed' THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(SUM(CASE WHEN scan_status = 'infected' THEN 1 ELSE 0 END),0) AS infected,
      COALESCE(SUM(CASE WHEN scan_status = 'pending' THEN 1 ELSE 0 END),0) AS pending
      FROM portal_attachments WHERE tenant_id = ? AND deleted_at IS NULL`)
      .bind(actor.tenantId).first<{ retained: number; failed: number; infected: number; pending: number }>(),
    DB.prepare("SELECT version, completed_at FROM portal_bootstrap_state WHERE tenant_id = ? AND scope = ? LIMIT 1")
      .bind(actor.tenantId, HEARTBEAT_SCOPE).first<{ version: string; completed_at: string }>(),
  ]);
  const thresholds = operationsThresholds(environment);
  const job = parseHeartbeat(heartbeat?.version);
  const lastJobAgeSeconds = job ? ageSeconds(heartbeat?.completed_at, now) : null;
  const queueAgeSeconds = queue?.oldest ? ageSeconds(queue.oldest, now) : 0;
  const missing = thresholds.expectedJobIntervalSeconds === null ? "unknown"
    : !heartbeat ? true : lastJobAgeSeconds === null ? "unknown" : lastJobAgeSeconds > thresholds.expectedJobIntervalSeconds;
  return {
    schemaVersion: 1,
    scope: "current_tenant",
    job: { missing, observation: !heartbeat ? "not_observed" : job ? "recorded" : "invalid_record", lastRunAgeSeconds: lastJobAgeSeconds, lastResult: job?.status ?? "unknown",
      durationMs: job?.durationMs ?? null, expectedIntervalSeconds: thresholds.expectedJobIntervalSeconds },
    mail: { unresolved: Number(queue?.unresolved ?? 0), queued: Number(queue?.queued ?? 0), processing: Number(queue?.processing ?? 0), failed: Number(queue?.failed ?? 0),
      uncertain: Number(queue?.uncertain ?? 0), uncertaintyScope: "requires_reconciliation", queueAgeSeconds, alarmThresholdSeconds: thresholds.queueAlarmSeconds,
      queueLate: thresholds.queueAlarmSeconds === null || queueAgeSeconds === null ? "unknown" : queueAgeSeconds >= thresholds.queueAlarmSeconds },
    scanner: { observation: "retained_attachment_rows", retained: Number(scan?.retained ?? 0),
      failed: Number(scan?.failed ?? 0), infected: Number(scan?.infected ?? 0), pending: Number(scan?.pending ?? 0), historicalFailureTotal: "unknown" },
    backup: { status: "unknown", lastVerifiedRestoreAt: null },
  };
}
