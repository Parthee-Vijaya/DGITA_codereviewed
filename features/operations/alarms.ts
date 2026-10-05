import { deploymentStage, type RuntimeEnvironment } from "../runtime/environment";

export type OperationalAlarm = {
  jobFailed: boolean;
  cleanupFailed: boolean;
  queueLate: boolean;
  telemetryFailed: boolean;
  durationMs: number;
};
export type AlarmDelivery = "not_configured" | "invalid_configuration" | "delivered" | "failed";

export function projectAlarm(input: OperationalAlarm) {
  if (!input || typeof input.jobFailed !== "boolean" || typeof input.cleanupFailed !== "boolean" ||
      typeof input.queueLate !== "boolean" || typeof input.telemetryFailed !== "boolean" ||
      !Number.isSafeInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 86400000) throw new Error("Invalid alarm.");
  return { schemaVersion: 1, event: "operations.alarm", jobFailed: input.jobFailed, cleanupFailed: input.cleanupFailed,
    queueLate: input.queueLate, telemetryFailed: input.telemetryFailed, durationMs: input.durationMs };
}

/** Server-configured sink only. No user/tenant/case payload or provider errors leave this adapter. */
export async function deliverOperationalAlarm(input: OperationalAlarm, environment: RuntimeEnvironment, fetcher = globalThis.fetch): Promise<AlarmDelivery> {
  const endpoint = environment.DGITA_OPERATIONS_ALARM_URL;
  const token = environment.DGITA_OPERATIONS_ALARM_TOKEN;
  if (!endpoint && !token) return "not_configured";
  let url: URL;
  let timeoutMs: number;
  let payload: ReturnType<typeof projectAlarm>;
  try {
    url = new URL(endpoint ?? "");
    const local = deploymentStage(environment) === "local" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash ||
        !token || token.length < 32 || token.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(token)) throw new Error("Invalid sink.");
    timeoutMs = Number(environment.DGITA_OPERATIONS_ALARM_TIMEOUT_MS || 2000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) throw new Error("Invalid timeout.");
    payload = projectAlarm(input);
  } catch { return "invalid_configuration"; }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Alarm timeout.")); }, timeoutMs); });
    const accepted = await Promise.race([timeout, (async () => {
      const response = await fetcher(url.href, { method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      await response.body?.cancel();
      return response.ok;
    })()]);
    return accepted ? "delivered" : "failed";
  } catch { return "failed"; }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
