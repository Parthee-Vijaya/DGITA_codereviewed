/** Operational telemetry is deliberately separate from the protected audit trail. */
export type OperationalLogEvent =
  | { event: "auth.unexpected_error" }
  | {
      event: "scheduler.completed" | "scheduler.failed";
      tenants: number;
      processed: number;
      failed: number;
      queueAgeSeconds: number;
      durationMs: number;
      configured: boolean;
      cleanupFailed: boolean;
    };

type LogRecord = {
  event: OperationalLogEvent["event"] | "operational.invalid_event";
  level: "info" | "error";
  eventId: string;
  at: string;
  [key: string]: string | number | boolean;
};

const MAX_COUNT = 1_000_000;
const MAX_QUEUE_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

function boundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function ownValue(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Runtime validation also protects callers using JS, casts or extra properties. */
function projectEvent(input: OperationalLogEvent): Pick<LogRecord, "event" | "level"> & Record<string, string | number | boolean> {
  if (!input || typeof input !== "object") return { event: "operational.invalid_event", level: "error" };
  const event = ownValue(input, "event");
  if (event === "auth.unexpected_error") return { event, level: "error" };
  if (event === "scheduler.completed" || event === "scheduler.failed") {
    const tenants = ownValue(input, "tenants");
    const processed = ownValue(input, "processed");
    const failed = ownValue(input, "failed");
    const queueAgeSeconds = ownValue(input, "queueAgeSeconds");
    const durationMs = ownValue(input, "durationMs");
    const configured = ownValue(input, "configured");
    const cleanupFailed = ownValue(input, "cleanupFailed");
    if (
      boundedInteger(tenants, MAX_COUNT) &&
      boundedInteger(processed, MAX_COUNT) &&
      boundedInteger(failed, MAX_COUNT) &&
      boundedInteger(queueAgeSeconds, MAX_QUEUE_AGE_SECONDS) &&
      boundedInteger(durationMs, MAX_DURATION_MS) &&
      typeof configured === "boolean" &&
      typeof cleanupFailed === "boolean"
    ) {
      return {
        event,
        level: event === "scheduler.failed" ? "error" : "info",
        tenants,
        processed,
        failed,
        queueAgeSeconds,
        durationMs,
        configured,
        cleanupFailed,
      };
    }
  }
  return { event: "operational.invalid_event", level: "error" };
}

/** Never pass a Request, Error, URL, token, case id, subject or free text here. */
export function createOperationalLogger(sink: (line: string) => void) {
  return (event: OperationalLogEvent): void => {
    let projected: ReturnType<typeof projectEvent>;
    try {
      projected = projectEvent(event);
    } catch {
      // Hostile getters/proxies must not trigger raw-error fallback logging.
      projected = { event: "operational.invalid_event", level: "error" };
    }
    const record: LogRecord = {
      ...projected,
      eventId: crypto.randomUUID(),
      at: new Date().toISOString(),
    };
    try {
      sink(JSON.stringify(record));
    } catch {
      // Telemetry failure must not change request/session/business behavior.
    }
  };
}

export const writeOperationalLog = createOperationalLogger((line) => console.error(line));
