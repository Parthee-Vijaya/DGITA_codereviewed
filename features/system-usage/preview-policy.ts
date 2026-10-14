import { AuthHttpError } from "../auth/http";
import type { RuntimeEnvironment } from "../runtime/environment";

/** Synthetic KLE data is never an operational source, even on a public pilot. */
export function permitsKlePreview(environment: RuntimeEnvironment, requestUrl: string) {
  if (environment.DGITA_ENVIRONMENT !== "local" || environment.DGITA_ENABLE_KLE_PREVIEW !== "true" ||
      environment.DGITA_ENABLE_DEV_LOGIN !== "true" || environment.VERCEL || environment.VERCEL_ENV || environment.CF_PAGES) return false;
  try {
    const request = new URL(requestUrl);
    const configured = new URL(environment.DGITA_APP_ORIGIN ?? "");
    return [request, configured].every((url) => ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) && request.origin === configured.origin;
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
  return provider === "dev" && permitsKlePreview(environment, origin) && requestHost === new URL(origin).host;
}
