import type { AuthEnvironment } from "./primitives";

export class AuthHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers?: HeadersInit;

  constructor(
    status: number,
    code: string,
    message: string,
    headers?: HeadersInit,
  ) {
    super(message);
    this.name = "AuthHttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function assertSameOrigin(
  request: Request,
  environment: AuthEnvironment = {},
) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;

  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin || suppliedOrigin === "null") {
    throw new AuthHttpError(
      403,
      "INVALID_ORIGIN",
      "Anmodningen mangler en gyldig oprindelse.",
    );
  }

  let expectedOrigins: Set<string>;
  try {
    expectedOrigins = allowedOrigins(request, environment);
  } catch {
    throw new AuthHttpError(
      500,
      "AUTH_CONFIGURATION_ERROR",
      "Loginmiljøet er ikke konfigureret korrekt.",
    );
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(suppliedOrigin).origin;
  } catch {
    throw new AuthHttpError(403, "INVALID_ORIGIN", "Oprindelsen er ugyldig.");
  }

  if (!expectedOrigins.has(normalizedOrigin)) {
    throw new AuthHttpError(
      403,
      "ORIGIN_MISMATCH",
      "Anmodningen kommer ikke fra denne portal.",
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AuthHttpError(
      403,
      "CROSS_SITE_REQUEST",
      "Anmodningen blev afvist af portalens sikkerhedskontrol.",
    );
  }
}

function allowedOrigins(request: Request, environment: AuthEnvironment) {
  const configuredOrigin = environment.DGITA_APP_ORIGIN;
  const origins = new Set([
    new URL(configuredOrigin || request.url).origin,
  ]);

  // Vercel exposes the immutable deployment hostname at runtime. Trusting that
  // exact platform-provided hostname lets an unaliased release be tested before
  // promotion while the canonical production origin remains locked down.
  for (const key of ["VERCEL_URL", "VERCEL_BRANCH_URL"] as const) {
    const hostname = environment[key]?.trim().toLowerCase();
    if (!hostname) continue;
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.vercel\.app$/u.test(hostname)) {
      throw new Error(`Invalid ${key}`);
    }
    origins.add(`https://${hostname}`);
  }

  return origins;
}

export function noStoreJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("Vary", appendVary(headers.get("Vary"), "Cookie, Origin"));
  return Response.json(data, { ...init, headers });
}

/** Parse bounded JSON without turning invalid client input into a service outage. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const limit = 750_000;
  if (Number(request.headers.get("content-length")) > limit) {
    throw new AuthHttpError(413, "BODY_TOO_LARGE", "Anmodningen er for stor.");
  }
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new AuthHttpError(413, "BODY_TOO_LARGE", "Anmodningen er for stor.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AuthHttpError(400, "INVALID_JSON", "Anmodningen skal indeholde gyldig JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthHttpError(400, "INVALID_JSON", "Anmodningen skal være et JSON-objekt.");
  }
  return value as Record<string, unknown>;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthHttpError) {
    return noStoreJson(
      { code: error.code, error: error.message },
      { status: error.status, headers: error.headers },
    );
  }

  const eventId = crypto.randomUUID();
  const name = error instanceof Error && /^[A-Za-z0-9_.-]{1,80}$/u.test(error.name) ? error.name : "UnknownError";
  // Provider errors can embed connection strings, SQL parameters or tokens.
  console.error("Authentication request failed", { eventId, errorName: name });
  return noStoreJson(
    {
      code: "AUTH_UNAVAILABLE",
      error: "Loginfunktionen er midlertidigt utilgængelig.",
    },
    { status: 503 },
  );
}

function appendVary(current: string | null, value: string) {
  const fields = new Set(
    `${current ?? ""},${value}`
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean),
  );
  return [...fields].join(", ");
}
