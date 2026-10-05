export type RuntimeEnvironment = Record<string, string | undefined>;
export type DeploymentStage = "local" | "pilot" | "production";

export async function readRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  const result: RuntimeEnvironment =
    typeof process === "undefined" ? {} : { ...process.env };
  // Bundlers replace this direct expression even when Workers' process.env
  // does not enumerate NODE_ENV. Unconfigured production must fail closed.
  if (typeof process !== "undefined" && process.env.NODE_ENV) {
    result.NODE_ENV = process.env.NODE_ENV;
  }
  try {
    const { env } = await import("cloudflare:workers");
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
    }
  } catch {
    // Native Next.js uses process.env; Workers provides its own bindings.
  }
  return result;
}

export function deploymentStage(environment: RuntimeEnvironment): DeploymentStage {
  const explicit = environment.DGITA_ENVIRONMENT?.trim().toLowerCase();
  if (explicit === "local" || explicit === "pilot" || explicit === "production") {
    return explicit;
  }
  // A misspelt stage must never enable test access or test data.
  if (explicit) return "production";
  // Keep an existing explicitly enabled pilot usable during the transition.
  if (environment.DGITA_ENABLE_DEV_LOGIN?.toLowerCase() === "true") return "pilot";
  return environment.NODE_ENV === "production" ? "production" : "local";
}

export function permitsTestSessions(environment: RuntimeEnvironment) {
  if (deploymentStage(environment) === "production") return false;
  if (environment.DGITA_ENABLE_DEV_LOGIN?.toLowerCase() === "false") return false;
  return environment.DGITA_ENABLE_DEV_LOGIN?.toLowerCase() === "true" ||
    deploymentStage(environment) === "local";
}

export function permitsDemoSeed(environment: RuntimeEnvironment) {
  if (!permitsTestSessions(environment)) return false;
  if (environment.DGITA_ENABLE_DEMO_SEED?.toLowerCase() === "false") return false;
  return environment.DGITA_ENABLE_DEMO_SEED?.toLowerCase() === "true" ||
    environment.DGITA_ENABLE_DEV_LOGIN?.toLowerCase() === "true";
}
