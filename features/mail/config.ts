import { GraphMailConfigurationError } from "./errors";
import { readMailDeliveryPolicy } from "./delivery-policy";
import type {
  GraphMailConfig,
  GraphMailEnvironment,
} from "./types";

const DEFAULT_AUTHORITY_HOST = "https://login.microsoftonline.com";
const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_TIMEOUT_MS = 10_000;
const MICROSOFT_AUTHORITY_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoftonline.us",
  "login.partner.microsoftonline.cn",
]);
const MICROSOFT_GRAPH_HOSTS = new Set([
  "graph.microsoft.com",
  "graph.microsoft.us",
  "dod-graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
]);

const REQUIRED_ENVIRONMENT_KEYS = [
  "DGITA_GRAPH_TENANT_ID",
  "DGITA_GRAPH_CLIENT_ID",
  "DGITA_GRAPH_CLIENT_SECRET",
  "DGITA_GRAPH_SENDER",
] as const;

export function readGraphMailConfig(
  environment: GraphMailEnvironment,
): GraphMailConfig {
  const missing = REQUIRED_ENVIRONMENT_KEYS.filter(
    (key) => !environment[key]?.trim(),
  );
  if (missing.length > 0) {
    throw new GraphMailConfigurationError(
      `Microsoft Graph-mail mangler konfiguration: ${missing.join(", ")}.`,
    );
  }

  const tenantId = environment.DGITA_GRAPH_TENANT_ID!.trim();
  if (!/^[A-Za-z0-9.-]+$/u.test(tenantId)) {
    throw new GraphMailConfigurationError(
      "DGITA_GRAPH_TENANT_ID har et ugyldigt format.",
    );
  }
  if (["common", "organizations", "consumers"].includes(tenantId.toLowerCase())) {
    throw new GraphMailConfigurationError(
      "DGITA_GRAPH_TENANT_ID skal pege på én konkret Entra-tenant.",
    );
  }

  const authorityHost = secureBaseUrl(
    environment.DGITA_GRAPH_AUTHORITY_HOST ?? DEFAULT_AUTHORITY_HOST,
    "DGITA_GRAPH_AUTHORITY_HOST",
    MICROSOFT_AUTHORITY_HOSTS,
  );
  const graphBaseUrl = secureBaseUrl(
    environment.DGITA_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL,
    "DGITA_GRAPH_BASE_URL",
    MICROSOFT_GRAPH_HOSTS,
  );
  const graphScope =
    environment.DGITA_GRAPH_SCOPE?.trim() || DEFAULT_GRAPH_SCOPE;
  if (!/^https:\/\/[^\s]+\/\.default$/u.test(graphScope)) {
    throw new GraphMailConfigurationError(
      "DGITA_GRAPH_SCOPE skal være et sikkert resource-scope, der slutter med /.default.",
    );
  }

  const timeoutMs = readTimeout(environment.DGITA_GRAPH_TIMEOUT_MS);
  const sender = environment.DGITA_GRAPH_SENDER!.trim();
  if (!isPlausibleMailbox(sender)) {
    throw new GraphMailConfigurationError(
      "DGITA_GRAPH_SENDER skal være mailadressen eller UPN'et på den tilladte afsenderpostkasse.",
    );
  }

  return {
    tenantId,
    clientId: environment.DGITA_GRAPH_CLIENT_ID!.trim(),
    clientSecret: environment.DGITA_GRAPH_CLIENT_SECRET!,
    sender,
    authorityHost,
    graphBaseUrl,
    graphScope,
    timeoutMs,
    deliveryPolicy: readMailDeliveryPolicy(environment),
  };
}

export async function getGraphMailEnvironment(): Promise<GraphMailEnvironment> {
  const result: GraphMailEnvironment = {};

  if (typeof process !== "undefined") {
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") result[key] = value;
    }
  }

  try {
    const { env } = await import("cloudflare:workers");
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
    }
  } catch {
    // Cloudflare-secrets findes kun i Workers/Sites-runtime. Ved lokale tests
    // bruges de eksplicit indsendte miljøværdier.
  }

  return result;
}

function secureBaseUrl(value: string, key: string, allowedHosts: ReadonlySet<string>) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("unsafe URL");
    }
    return url.href.replace(/\/$/u, "");
  } catch {
    throw new GraphMailConfigurationError(
      `${key} skal være en godkendt Microsoft HTTPS-baseadresse.`,
    );
  }
}

function readTimeout(raw: string | undefined) {
  if (!raw?.trim()) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
    throw new GraphMailConfigurationError(
      "DGITA_GRAPH_TIMEOUT_MS skal være et heltal mellem 100 og 60000.",
    );
  }
  return value;
}

function isPlausibleMailbox(value: string) {
  return (
    value.length <= 320 &&
    !/[\u0000-\u001f\u007f\s]/u.test(value) &&
    /^[^@]+@[^@]+$/u.test(value)
  );
}
