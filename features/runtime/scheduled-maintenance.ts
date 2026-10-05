import { cleanupAbandonedDirectApplicationUploads } from "../application/direct-upload-server";
import { processScheduledOutbox } from "../mail/outbox";
import { writeOperationalLog } from "../privacy/operational-log";
import { recordJobHeartbeat } from "../operations/store";
import { deliverOperationalAlarm } from "../operations/alarms";
import { operationsThresholds } from "../operations/policy";
import { readRuntimeEnvironment, type RuntimeEnvironment } from "./environment";

type Dependencies = {
  cleanup: typeof cleanupAbandonedDirectApplicationUploads;
  mail: typeof processScheduledOutbox;
  log: typeof writeOperationalLog;
  now: () => number;
  persist: typeof recordJobHeartbeat;
  notify: typeof deliverOperationalAlarm;
  environment: () => Promise<RuntimeEnvironment>;
};

/** One host-independent job. Cleanup failure must not prevent the mail pass. */
export async function runScheduledMaintenance(dependencies: Partial<Dependencies> = {}) {
  const { cleanup, mail, log, now, persist, notify, environment } = {
    cleanup: cleanupAbandonedDirectApplicationUploads, mail: processScheduledOutbox,
    log: writeOperationalLog, now: Date.now, persist: recordJobHeartbeat, notify: deliverOperationalAlarm,
    environment: readRuntimeEnvironment, ...dependencies,
  };
  const started = now();
  const runtime = await environment();
  const thresholds = operationsThresholds(runtime);
  let cleanupFailed = false;
  const uploadCleanup = await cleanup(10).catch(() => {
    cleanupFailed = true;
    return { pendingQuarantined: 0, verifyingDiscarded: 0, blobsDeleted: 0, blobsPendingRetry: 0 };
  });
  const result = await mail(10).catch(() => ({ configured: false, tenants: 0, processed: 0, failed: 1, queueAgeSeconds: 0 }));
  const completed = now();
  const durationMs = Math.min(86400000, Math.max(0, Math.trunc(completed - started)));
  const queueLate = thresholds.queueAlarmSeconds !== null && result.queueAgeSeconds >= thresholds.queueAlarmSeconds;
  const jobFailed = !result.configured || result.failed > 0;
  let telemetryFailed = false;
  let telemetryStatus: "written" | "superseded" | "failed" = "failed";
  try {
    const recorded = await persist({ schemaVersion: 1, status: cleanupFailed || jobFailed || queueLate ? "failed" : "completed",
      durationMs, configured: result.configured, cleanupFailed }, new Date(completed).toISOString());
    telemetryStatus = recorded.status;
  } catch {
    telemetryFailed = true;
    log({ event: "operations.telemetry_failed" });
  }
  const alarm = cleanupFailed || jobFailed || queueLate || telemetryFailed;
  log({ event: alarm ? "scheduler.failed" : "scheduler.completed", ...result, durationMs, cleanupFailed });
  const alarmDelivery = alarm ? await notify({ jobFailed, cleanupFailed, queueLate, telemetryFailed, durationMs }, runtime).catch(() => "failed" as const) : "not_needed";
  if (alarmDelivery !== "not_needed") log({ event: "operations.alarm_delivery", outcome: alarmDelivery });
  return { ...result, durationMs, cleanupFailed, uploadCleanup, alarm, alarmDelivery, telemetryPersisted: telemetryStatus === "written", telemetryStatus,
    queueAlarmConfigured: thresholds.queueAlarmSeconds !== null };
}
