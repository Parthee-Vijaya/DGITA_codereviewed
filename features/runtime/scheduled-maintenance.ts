import { cleanupAbandonedDirectApplicationUploads } from "../application/direct-upload-server";
import { processScheduledOutbox } from "../mail/outbox";
import { writeOperationalLog } from "../privacy/operational-log";

export const MAIL_QUEUE_ALARM_SECONDS = 10 * 60;

type Dependencies = {
  cleanup: typeof cleanupAbandonedDirectApplicationUploads;
  mail: typeof processScheduledOutbox;
  log: typeof writeOperationalLog;
  now: () => number;
};

/** One host-independent job. Cleanup failure must not prevent the mail pass. */
export async function runScheduledMaintenance(dependencies: Partial<Dependencies> = {}) {
  const { cleanup, mail, log, now } = {
    cleanup: cleanupAbandonedDirectApplicationUploads, mail: processScheduledOutbox,
    log: writeOperationalLog, now: Date.now, ...dependencies,
  };
  const started = now();
  let cleanupFailed = false;
  const uploadCleanup = await cleanup(10).catch(() => {
    cleanupFailed = true;
    return { pendingQuarantined: 0, verifyingDiscarded: 0, blobsDeleted: 0, blobsPendingRetry: 0 };
  });
  const result = await mail(10).catch(() => ({ configured: false, tenants: 0, processed: 0, failed: 1, queueAgeSeconds: 0 }));
  const durationMs = Math.min(86400000, Math.max(0, Math.trunc(now() - started)));
  const alarm = cleanupFailed || !result.configured || result.failed > 0 || result.queueAgeSeconds >= MAIL_QUEUE_ALARM_SECONDS;
  log({ event: alarm ? "scheduler.failed" : "scheduler.completed", ...result, durationMs, cleanupFailed });
  return { ...result, durationMs, cleanupFailed, uploadCleanup, alarm };
}
