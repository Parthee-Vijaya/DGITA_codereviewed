import { AuthHttpError } from "../auth/http";
import type { RuntimeEnvironment } from "../runtime/environment";

function permitsLocalKlePreview(environment: RuntimeEnvironment, requestUrl: string) {
  if (environment.DGITA_ENVIRONMENT !== "local" || environment.DGITA_ENABLE_KLE_PREVIEW !== "true" ||
      environment.DGITA_ENABLE_DEV_LOGIN !== "true" || environment.VERCEL || environment.VERCEL_ENV || environment.CF_PAGES) return false;
  try {
    const request = new URL(requestUrl);
    const configured = new URL(environment.DGITA_APP_ORIGIN ?? "");
    return [request, configured].every((url) => ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) && request.origin === configured.origin;
  } catch { return false; }
}

function hostedPreviewOrigins(environment: RuntimeEnvironment): Set<string> | null {
  if (environment.VERCEL !== "1" || environment.VERCEL_ENV !== "preview" || environment.CF_PAGES ||
      environment.DGITA_ENVIRONMENT !== "pilot" || environment.DGITA_ENABLE_HOSTED_PREVIEW !== "true" ||
      environment.DGITA_ENABLE_KLE_PREVIEW !== "true" || environment.DGITA_ENABLE_DEV_LOGIN !== "true" ||
      environment.DGITA_ENABLE_DEMO_SEED !== "true") return null;

  const projectId = environment.DGITA_PREVIEW_PROJECT_ID;
  if (!projectId || !/^prj_[A-Za-z0-9_-]+$/u.test(projectId) || environment.VERCEL_PROJECT_ID !== projectId) return null;
  const secret = environment.DGITA_TEST_ACCESS_SECRET;
  if (!secret || secret.length < 32 || /[\s\u0000-\u001f\u007f]/u.test(secret) || new Set(secret).size < 8) return null;
  for (const [key, value] of Object.entries(environment)) {
    if ((/^DGITA_(?:GRAPH_|ENTRA_|FK_|MALWARE_SCAN_)/u.test(key) ||
        key === "CRON_SECRET" || key === "DGITA_MAIL_ALLOWED_RECIPIENTS") && value?.trim()) return null;
  }

  try {
    const configured = new URL(environment.DGITA_APP_ORIGIN ?? "");
    if (configured.protocol !== "https:" || configured.username || configured.password || configured.port ||
        configured.pathname !== "/" || configured.search || configured.hash ||
        ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) ||
        environment.NEXT_PUBLIC_SITE_URL !== environment.DGITA_APP_ORIGIN) return null;
    const origins = new Set([configured.origin]);
    // Only this exact server-provided deployment host is trusted; never infer
    // permission from a client Host/Forwarded header or a *.vercel.app suffix.
    if (environment.VERCEL_URL) {
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/u.test(environment.VERCEL_URL)) return null;
      origins.add(`https://${environment.VERCEL_URL}`);
    }
    return origins;
  } catch { return null; }
}

/** Synthetic KLE remains unavailable in operational pilot/production profiles. */
export function permitsKlePreview(environment: RuntimeEnvironment, requestUrl: string) {
  if (permitsLocalKlePreview(environment, requestUrl)) return true;
  const origins = hostedPreviewOrigins(environment);
  if (!origins) return false;
  try {
    const request = new URL(requestUrl);
    return request.protocol === "https:" && !request.username && !request.password && origins.has(request.origin);
  } catch { return false; }
}

export function assertKlePreview(environment: RuntimeEnvironment, requestUrl: string) {
  if (!permitsKlePreview(environment, requestUrl)) {
    throw new AuthHttpError(404, "PREVIEW_UNAVAILABLE", "Afprøvningen er ikke tilgængelig i dette miljø.");
  }
}

/** Page rendering checks the actual host and identity before exposing preview controls. */
export function permitsKlePreviewPage(environment: RuntimeEnvironment, requestHost: string | null, provider: string) {
  const origin = environment.DGITA_APP_ORIGIN ?? "";
  if (provider !== "dev" || !requestHost) return false;
  if (permitsLocalKlePreview(environment, origin)) return requestHost === new URL(origin).host;
  const origins = hostedPreviewOrigins(environment);
  return Boolean(origins && [...origins].some((allowed) => requestHost === new URL(allowed).host));
}
