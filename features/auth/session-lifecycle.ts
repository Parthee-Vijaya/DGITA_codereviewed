import { deploymentStage, type RuntimeEnvironment } from "../runtime/environment";
import { AuthHttpError } from "./http";

const MAXIMUM_SECONDS = 12 * 60 * 60;

function configuredSeconds(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw invalidPolicy();
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > MAXIMUM_SECONDS) throw invalidPolicy();
  return seconds;
}

function invalidPolicy() {
  return new AuthHttpError(503, "SESSION_POLICY_INVALID", "Sessionens sikkerhedspolitik er ikke konfigureret korrekt.");
}

/** Pilot defaults preserve the existing 12-hour test session. Production's
 * proposed idle default is 30 minutes; municipal acceptance is still required. */
export function readSessionPolicy(environment: RuntimeEnvironment) {
  const maximumSeconds = configuredSeconds(environment.DGITA_SESSION_MAX_SECONDS, MAXIMUM_SECONDS);
  const defaultIdle = deploymentStage(environment) === "production" ? 30 * 60 : maximumSeconds;
  const idleSeconds = configuredSeconds(environment.DGITA_SESSION_IDLE_SECONDS, Math.min(defaultIdle, maximumSeconds));
  if (idleSeconds > maximumSeconds) throw invalidPolicy();
  return { maximumSeconds, idleSeconds, activityWriteIntervalSeconds: Math.min(60, Math.floor(idleSeconds / 4)) };
}

export function sessionTimeBounds(environment: RuntimeEnvironment, now: Date) {
  const policy = readSessionPolicy(environment);
  const time = now.getTime();
  if (!Number.isFinite(time)) throw invalidPolicy();
  return {
    ...policy, now: now.toISOString(),
    createdAfter: new Date(time - policy.maximumSeconds * 1_000).toISOString(),
    activeAfter: new Date(time - policy.idleSeconds * 1_000).toISOString(),
    touchBefore: new Date(time - policy.activityWriteIntervalSeconds * 1_000).toISOString(),
  };
}
