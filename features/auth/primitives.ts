import type { WorkspaceRole } from "../workspace/model";
import { permitsTestSessions } from "../runtime/environment";

export const SESSION_COOKIE_NAME = "dgita_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MIN_TEST_ACCESS_SECRET_LENGTH = 8;
const AUTH_ROLES = ["user", "consultant", "admin"] as const;

export type AuthEnvironment = Record<string, string | undefined>;

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (AUTH_ROLES as readonly string[]).includes(value)
  );
}

export function parseCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

export function readSessionToken(cookieHeader: string | null) {
  const value = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sessionCookie(
  token: string,
  requestUrl: string | URL,
  ttlSeconds = SESSION_TTL_SECONDS,
  environment: AuthEnvironment = {},
) {
  const expires = new Date(Date.now() + ttlSeconds * 1_000).toUTCString();
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
    `Expires=${expires}`,
    requiresSecureCookie(requestUrl, environment) ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function expiredSessionCookie(requestUrl: string | URL, environment: AuthEnvironment = {}) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    requiresSecureCookie(requestUrl, environment) ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function isDevLoginEnabled(
  requestUrl: string | URL,
  environment: AuthEnvironment = {},
) {
  const policy = devLoginPolicy(requestUrl, environment);
  return policy.enabled;
}

export function devLoginPolicy(
  requestUrl: string | URL,
  environment: AuthEnvironment = {},
) {
  if (!permitsTestSessions(environment)) {
    return {
      enabled: false,
      accessCodeRequired: false,
      configurationValid: true,
    } as const;
  }
  if (isLocalTestRequest(requestUrl, environment)) {
    return {
      enabled: true,
      accessCodeRequired: false,
      configurationValid: true,
    } as const;
  }

  const explicitlyEnabled =
    environment.DGITA_ENABLE_DEV_LOGIN?.toLowerCase() === "true";
  if (!explicitlyEnabled) {
    return {
      enabled: false,
      accessCodeRequired: false,
      configurationValid: true,
    } as const;
  }

  const configurationValid = hasValidTestAccessSecret(environment);
  return {
    enabled: configurationValid,
    accessCodeRequired: true,
    configurationValid,
  } as const;
}

export function hasValidTestAccessSecret(
  environment: AuthEnvironment = {},
) {
  const secret = testAccessSecret(environment);
  return (
    typeof secret === "string" &&
    secret.length >= MIN_TEST_ACCESS_SECRET_LENGTH &&
    secret.trim() === secret
  );
}

export async function verifyTestAccessCode(
  accessCode: string | undefined,
  environment: AuthEnvironment = {},
) {
  const expected = testAccessSecret(environment) ?? "";
  const supplied = accessCode ?? "";
  const [expectedDigest, suppliedDigest] = await Promise.all([
    sha256Bytes(expected),
    sha256Bytes(supplied),
  ]);

  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index] ^ suppliedDigest[index];
  }

  return hasValidTestAccessSecret(environment) && difference === 0;
}

function testAccessSecret(environment: AuthEnvironment) {
  return (
    environment.DGITA_TEST_ACCESS_SECRET ??
    environment.DGITA_DEMO_ACCESS_SECRET
  );
}

function isHostedVercel(environment: AuthEnvironment) {
  return Boolean(environment.VERCEL || environment.VERCEL_URL || environment.VERCEL_BRANCH_URL);
}

// A reverse proxy may expose an internal loopback URL even for a public pilot.
// Only a genuinely local request and configured origin qualify for the shortcut.
function isLocalTestRequest(requestUrl: string | URL, environment: AuthEnvironment) {
  if (isHostedVercel(environment)) return false;
  try {
    return isLocalRequestUrl(requestUrl) &&
      isLocalRequestUrl(environment.DGITA_APP_ORIGIN || requestUrl);
  } catch { return false; }
}

function requiresSecureCookie(requestUrl: string | URL, environment: AuthEnvironment) {
  return isHostedVercel(environment) || new URL(requestUrl).protocol === "https:" ||
    new URL(environment.DGITA_APP_ORIGIN || requestUrl).protocol === "https:";
}

function isLocalRequestUrl(requestUrl: string | URL) {
  const hostname = new URL(requestUrl).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

async function sha256Bytes(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

export function initialsFor(displayName: string) {
  const parts = displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase("da-DK");
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toLocaleUpperCase("da-DK");
}
