import type { RuntimeEnvironment } from "./environment";
import { readGraphMailConfig } from "../mail/config";
import { readEntraConfig } from "../auth/oidc";

function configured(value: string | undefined) {
  return Boolean(value?.trim() && !/replace-with|<[^>]+>|example\.(com|dk|invalid)/iu.test(value));
}

function secureUrl(value: string | undefined, originOnly = false) {
  if (!configured(value)) return false;
  try {
    const url = new URL(value!);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search &&
      (!originOnly || url.pathname === "/");
  } catch { return false; }
}

/** Configuration evidence only: it does not prove provider access or contracts. */
export function productionConfigurationIssues(environment: RuntimeEnvironment) {
  const issues: string[] = [];
  if (environment.DGITA_ENVIRONMENT !== "production") issues.push("DGITA_ENVIRONMENT");
  if (environment.DGITA_ENABLE_DEV_LOGIN !== "false") issues.push("DGITA_ENABLE_DEV_LOGIN");
  if (environment.DGITA_ENABLE_DEMO_SEED !== "false") issues.push("DGITA_ENABLE_DEMO_SEED");
  if (!secureUrl(environment.DGITA_APP_ORIGIN, true)) issues.push("DGITA_APP_ORIGIN");
  if (environment.NEXT_PUBLIC_SITE_URL !== environment.DGITA_APP_ORIGIN) issues.push("NEXT_PUBLIC_SITE_URL");
  const secrets = ["DGITA_APPROVAL_TOKEN_SECRET", "CRON_SECRET", "DGITA_OIDC_STATE_SECRET"] as const;
  const seen = new Set<string>();
  for (const key of secrets) {
    const value = environment[key];
    if (!configured(value) || value!.length < 32 || value !== value!.trim() || new Set(value).size < 8 || seen.has(value!)) issues.push(key);
    if (value) seen.add(value);
  }
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  for (const key of ["DGITA_ENTRA_TENANT_ID", "DGITA_ENTRA_CLIENT_ID"] as const) {
    if (!guid.test(environment[key] ?? "")) issues.push(key);
  }
  for (const key of ["DGITA_ENTRA_CLIENT_SECRET", "DGITA_ENTRA_PORTAL_TENANT_ID", "TURSO_AUTH_TOKEN",
    "DGITA_MALWARE_SCAN_TOKEN", "DGITA_GRAPH_TENANT_ID", "DGITA_GRAPH_CLIENT_ID", "DGITA_GRAPH_CLIENT_SECRET", "DGITA_GRAPH_SENDER"]) {
    if (!configured(environment[key])) issues.push(key);
  }
  const scanToken = environment.DGITA_MALWARE_SCAN_TOKEN;
  if (configured(scanToken) && (scanToken!.length < 32 || /[\s\u0000-\u001f\u007f]/u.test(scanToken!))) issues.push("DGITA_MALWARE_SCAN_TOKEN");
  const scanTimeout = Number(environment.DGITA_MALWARE_SCAN_TIMEOUT_MS || 10_000);
  if (!Number.isSafeInteger(scanTimeout) || scanTimeout < 100 || scanTimeout > 30_000) issues.push("DGITA_MALWARE_SCAN_TIMEOUT_MS");
  if (environment.DGITA_ENTRA_REDIRECT_URI !== `${environment.DGITA_APP_ORIGIN?.replace(/\/$/u, "")}/api/auth/entra/callback`) issues.push("DGITA_ENTRA_REDIRECT_URI");
  if (!configured(environment.TURSO_DATABASE_URL) || !/^(libsql|https):\/\//u.test(environment.TURSO_DATABASE_URL ?? "")) issues.push("TURSO_DATABASE_URL");
  if (!configured(environment.BLOB_STORE_ID) && !configured(environment.BLOB_READ_WRITE_TOKEN)) issues.push("BLOB_STORE_ID_OR_TOKEN");
  if (environment.NEXT_PUBLIC_DGITA_UPLOAD_MODE !== "vercel-blob") issues.push("NEXT_PUBLIC_DGITA_UPLOAD_MODE");
  if (!secureUrl(environment.DGITA_MALWARE_SCAN_URL)) issues.push("DGITA_MALWARE_SCAN_URL");
  try { readGraphMailConfig(environment); }
  catch { issues.push("DGITA_GRAPH_CONFIGURATION"); }
  if (!readEntraConfig(environment)) issues.push("DGITA_ENTRA_CONFIGURATION");
  return issues;
}
