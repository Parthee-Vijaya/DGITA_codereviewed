import type { RuntimeEnvironment } from "../runtime/environment";

function seconds(value: string | undefined, minimum: number, maximum: number): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function operationsThresholds(environment: RuntimeEnvironment) {
  return {
    expectedJobIntervalSeconds: seconds(environment.DGITA_SCHEDULER_EXPECTED_INTERVAL_SECONDS, 60, 31 * 86400),
    queueAlarmSeconds: seconds(environment.DGITA_MAIL_QUEUE_ALARM_SECONDS, 1, 31 * 86400),
  };
}

export function ageSeconds(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const date = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (!Number.isFinite(date) || date > now || !Number.isFinite(now)) return null;
  return Math.floor((now - date) / 1000);
}

export type JobHeartbeat = {
  schemaVersion: 1;
  status: "completed" | "failed";
  durationMs: number;
  configured: boolean;
  cleanupFailed: boolean;
};

export function projectHeartbeat(input: JobHeartbeat): JobHeartbeat {
  if (!input || input.schemaVersion !== 1 || !["completed", "failed"].includes(input.status) ||
      !Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 86400000 ||
      typeof input.configured !== "boolean" || typeof input.cleanupFailed !== "boolean") throw new Error("Invalid heartbeat.");
  return { schemaVersion: 1, status: input.status, durationMs: input.durationMs, configured: input.configured, cleanupFailed: input.cleanupFailed };
}

export function parseHeartbeat(value: string | undefined): JobHeartbeat | null {
  if (!value || value.length > 1024) return null;
  try { return projectHeartbeat(JSON.parse(value)); } catch { return null; }
}
