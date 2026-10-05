import {
  EncryptJWT,
  base64url,
  createRemoteJWKSet,
  customFetch,
  jwtDecrypt,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { AuthHttpError } from "./http";
import {
  createSessionToken,
  hashSessionToken,
  parseCookie,
  type AuthEnvironment,
} from "./primitives";

export const OIDC_FLOW_TTL_SECONDS = 600;
const FLOW_AUDIENCE = "dgita:entra-login";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/;

export type EntraConfig = {
  tenantId: string;
  portalTenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  origin: string;
  stateSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
};

export type EntraIdentity = { tenantId: string; objectId: string; subject: string };
export type OidcFlow = { state: string; verifier: string; nonce: string; expiresAt: number };
export type EntraNetwork = { fetch?: typeof fetch; keyResolver?: JWTVerifyGetKey };

/** One administrator-configured workforce tenant; common/organizations are not accepted. */
export function readEntraConfig(environment: AuthEnvironment): EntraConfig | null {
  const tenantId = environment.DGITA_ENTRA_TENANT_ID?.trim().toLowerCase() ?? "";
  const clientId = environment.DGITA_ENTRA_CLIENT_ID?.trim().toLowerCase() ?? "";
  const portalTenantId = environment.DGITA_ENTRA_PORTAL_TENANT_ID?.trim() ?? "";
  const clientSecret = environment.DGITA_ENTRA_CLIENT_SECRET ?? "";
  const stateSecret = environment.DGITA_OIDC_STATE_SECRET ?? "";
  if (!GUID.test(tenantId) || !GUID.test(clientId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(portalTenantId) ||
      !clientSecret || clientSecret.length > 4096 ||
      stateSecret.length < 32 || stateSecret.length > 1024 || stateSecret.trim() !== stateSecret ||
      new Set(stateSecret).size < 12 ||
      [clientSecret, environment.DGITA_TEST_ACCESS_SECRET, environment.DGITA_APPROVAL_TOKEN_SECRET]
        .includes(stateSecret)) return null;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  if (environment.DGITA_ENTRA_ISSUER && environment.DGITA_ENTRA_ISSUER !== issuer) return null;
  try {
    const origin = new URL(environment.DGITA_APP_ORIGIN ?? "");
    const redirect = new URL(environment.DGITA_ENTRA_REDIRECT_URI ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
        (origin.protocol !== "https:" && !(origin.protocol === "http:" && local && environment.DGITA_ENVIRONMENT === "local")) ||
        redirect.href !== `${origin.origin}/api/auth/entra/callback`) return null;
    return {
      tenantId, clientId, portalTenantId, clientSecret, stateSecret, issuer,
      origin: origin.origin,
      redirectUri: redirect.href,
      authorizeUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      jwksUrl: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    };
  } catch { return null; }
}

export function requireEntraConfig(environment: AuthEnvironment): EntraConfig {
  const config = readEntraConfig(environment);
  if (!config) throw new AuthHttpError(503, "ENTRA_NOT_CONFIGURED", "Kommunens login er ikke tilsluttet endnu.");
  return config;
}

function flowCookieName(config: EntraConfig) {
  return config.origin.startsWith("https:") ? "__Host-dgita_entra_flow" : "dgita_entra_flow";
}

export function oidcFlowCookie(config: EntraConfig, value: string, ttl = OIDC_FLOW_TTL_SECONDS) {
  return [
    `${flowCookieName(config)}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${ttl}`, ...(config.origin.startsWith("https:") ? ["Secure"] : []),
  ].join("; ");
}

export function assertEntraOrigin(request: Request, config: EntraConfig) {
  if (new URL(request.url).origin !== config.origin) {
    throw new AuthHttpError(400, "ENTRA_ORIGIN_MISMATCH", "Brug portalens faste adresse for at logge ind.");
  }
}

async function stateKey(secret: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
}

export async function startEntraFlow(config: EntraConfig, now = new Date()) {
  const seconds = Math.floor(now.getTime() / 1000);
  const flow: OidcFlow = {
    state: createSessionToken(), verifier: createSessionToken(), nonce: createSessionToken(),
    expiresAt: seconds + OIDC_FLOW_TTL_SECONDS,
  };
  // Authentication and encryption bind the browser's flow to this exact deployment.
  const encrypted = await new EncryptJWT({
    state: flow.state, verifier: flow.verifier, nonce: flow.nonce,
    tenantId: config.tenantId, clientId: config.clientId,
    portalTenantId: config.portalTenantId, redirectUri: config.redirectUri,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuer(config.origin).setAudience(FLOW_AUDIENCE)
    .setIssuedAt(seconds).setExpirationTime(flow.expiresAt)
    .encrypt(await stateKey(config.stateSecret));
  const challenge = base64url.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier))));
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId, response_type: "code", response_mode: "query",
    redirect_uri: config.redirectUri, scope: "openid profile email",
    state: flow.state, nonce: flow.nonce, code_challenge: challenge,
    code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { location: url.href, cookie: oidcFlowCookie(config, encrypted) };
}

export async function readEntraFlow(request: Request, config: EntraConfig, now = new Date()): Promise<OidcFlow> {
  const url = new URL(request.url);
  const states = url.searchParams.getAll("state");
  const encrypted = parseCookie(request.headers.get("cookie"), flowCookieName(config));
  if (states.length !== 1 || !RANDOM_VALUE.test(states[0]) || !encrypted || encrypted.length > 4096) {
    throw invalidFlow();
  }
  try {
    const { payload } = await jwtDecrypt(encrypted, await stateKey(config.stateSecret), {
      issuer: config.origin, audience: FLOW_AUDIENCE,
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"], maxTokenAge: OIDC_FLOW_TTL_SECONDS,
      currentDate: now, clockTolerance: 0,
    });
    if (payload.state !== states[0] || !RANDOM_VALUE.test(String(payload.verifier)) ||
        !RANDOM_VALUE.test(String(payload.nonce)) || payload.tenantId !== config.tenantId ||
        payload.clientId !== config.clientId || payload.portalTenantId !== config.portalTenantId ||
        payload.redirectUri !== config.redirectUri || typeof payload.exp !== "number" ||
        typeof payload.iat !== "number" || payload.exp - payload.iat > OIDC_FLOW_TTL_SECONDS) throw invalidFlow();
    return { state: states[0], verifier: payload.verifier as string, nonce: payload.nonce as string, expiresAt: payload.exp };
  } catch { throw invalidFlow(); }
}

function invalidFlow() {
  return new AuthHttpError(400, "ENTRA_INVALID_STATE", "Loginforsøget er udløbet eller ugyldigt. Start login igen.");
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();
function keysFor(config: EntraConfig, network: EntraNetwork): JWTVerifyGetKey {
  if (network.keyResolver) return network.keyResolver;
  if (network.fetch) return createRemoteJWKSet(new URL(config.jwksUrl), { [customFetch]: network.fetch, timeoutDuration: 10000 });
  let keys = remoteKeys.get(config.jwksUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 10000 });
    // Configuration changes must not create an unbounded cache.
    if (remoteKeys.size >= 4) remoteKeys.clear();
    remoteKeys.set(config.jwksUrl, keys);
  }
  return keys;
}

export async function verifyEntraIdToken(token: string, nonce: string, config: EntraConfig,
  now = new Date(), network: EntraNetwork = {}): Promise<EntraIdentity> {
  try {
    const { payload } = await jwtVerify(token, keysFor(config, network), {
      issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"],
      requiredClaims: ["iss", "aud", "sub", "iat", "nbf", "exp", "nonce", "tid", "oid"],
      currentDate: now, clockTolerance: 60, maxTokenAge: OIDC_FLOW_TTL_SECONDS,
    });
    const seconds = Math.floor(now.getTime() / 1000);
    if (payload.ver !== "2.0" || payload.tid !== config.tenantId ||
        payload.aud !== config.clientId || (payload.azp !== undefined && payload.azp !== config.clientId) ||
        typeof payload.oid !== "string" || !GUID.test(payload.oid) ||
        typeof payload.sub !== "string" || !payload.sub ||
        payload.nonce !== nonce || !RANDOM_VALUE.test(nonce) ||
        typeof payload.exp !== "number" || payload.exp <= seconds ||
        typeof payload.iat !== "number" || payload.iat > seconds + 60 ||
        payload.exp <= payload.iat) throw new Error("claims");
    const objectId = payload.oid.toLowerCase();
    return { tenantId: config.tenantId, objectId, subject: `${config.tenantId}:${objectId}` };
  } catch {
    // Never log tokens, provider messages or claims. Keep the external error generic.
    throw new AuthHttpError(401, "ENTRA_INVALID_ID_TOKEN", "Identiteten kunne ikke bekræftes. Start login igen.");
  }
}

export async function exchangeEntraCode(code: string, flow: OidcFlow, config: EntraConfig,
  now = new Date(), network: EntraNetwork = {}): Promise<EntraIdentity> {
  try {
    const response = await (network.fetch ?? fetch)(config.tokenUrl, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret,
        code, code_verifier: flow.verifier, redirect_uri: config.redirectUri,
      }),
    });
    if (!response.ok) throw new Error("exchange");
    const text = await response.text();
    if (text.length > 131072) throw new Error("response size");
    const payload: unknown = JSON.parse(text);
    const idToken = payload && typeof payload === "object" && "id_token" in payload ? payload.id_token : null;
    if (typeof idToken !== "string" || idToken.length > 32768) throw new Error("id token");
    return await verifyEntraIdToken(idToken, flow.nonce, config, now, network);
  } catch (error) {
    if (error instanceof AuthHttpError) throw error;
    throw new AuthHttpError(401, "ENTRA_EXCHANGE_FAILED", "Kommunens login kunne ikke gennemføres. Start login igen.");
  }
}

export async function consumeEntraState(DB: D1Database, flow: OidcFlow, now = new Date()) {
  // An atomic insert wins once, including concurrent callbacks with a copied cookie.
  const result = await DB.prepare(
    `INSERT INTO portal_oidc_used_states (state_hash, expires_at)
     VALUES (?, ?) ON CONFLICT(state_hash) DO NOTHING`,
  ).bind(await hashSessionToken(flow.state), new Date(flow.expiresAt * 1000).toISOString()).run();
  if (result.meta.changes !== 1) throw invalidFlow();
  await DB.prepare("DELETE FROM portal_oidc_used_states WHERE expires_at <= ?")
    .bind(now.toISOString()).run();
}
