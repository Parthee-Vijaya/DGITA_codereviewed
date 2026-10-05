import assert from "node:assert/strict";
import test from "node:test";

import { AuthHttpError, assertSameOrigin, noStoreJson } from "./http.ts";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  devLoginPolicy,
  expiredSessionCookie,
  hashSessionToken,
  initialsFor,
  isDevLoginEnabled,
  isWorkspaceRole,
  parseCookie,
  readSessionToken,
  sessionCookie,
  verifyTestAccessCode,
} from "./primitives.ts";
import { readOidcProviderConfig } from "./providers.ts";

test("sessiontokens er tilfældige, URL-sikre og gemmes som SHA-256", async () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.match(await hashSessionToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(await hashSessionToken(first), first);
});

test("sessionscookie er HttpOnly og SameSite=Lax", () => {
  const token = createSessionToken();
  const production = sessionCookie(token, "https://portal.example.dk/");
  assert.match(production, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(production, /HttpOnly/);
  assert.match(production, /SameSite=Lax/);
  assert.match(production, /Secure/);
  assert.equal(readSessionToken(production), token);

  const expired = expiredSessionCookie("https://portal.example.dk/");
  assert.match(expired, /Max-Age=0/);
  assert.match(expired, /Secure/);
});

test("cookie-parseren afviser beskadigede sessiontokens", () => {
  assert.equal(parseCookie("a=1; valg=%C3%A6", "valg"), "æ");
  assert.equal(readSessionToken("dgita_session=ikke-et-sessiontoken"), null);
  assert.equal(parseCookie("valg=%E0%A4%A", "valg"), null);
});

test("testlogin er kun aktivt lokalt eller med eksplicit flag", () => {
  assert.equal(isDevLoginEnabled("http://localhost:3000"), true);
  assert.equal(isDevLoginEnabled("http://127.0.0.1:3000"), true);
  assert.equal(isDevLoginEnabled("https://portal.example.dk"), false);
  assert.equal(
    isDevLoginEnabled("https://portal.example.dk", {
      DGITA_ENABLE_DEV_LOGIN: "true",
    }),
    false,
  );
  assert.equal(
    isDevLoginEnabled("https://portal.example.dk", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_TEST_ACCESS_SECRET: "x".repeat(8),
    }),
    true,
  );
  assert.equal(
    isDevLoginEnabled("https://portal.example.dk", {
      DGITA_ENABLE_DEV_LOGIN: "1",
    }),
    false,
  );
});

test("offentligt testmiljø kræver en konfigureret adgangskode", async () => {
  assert.deepEqual(devLoginPolicy("http://localhost:3000", {}), {
    enabled: true,
    accessCodeRequired: false,
    configurationValid: true,
  });
  assert.deepEqual(
    devLoginPolicy("https://portal.example.dk", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_TEST_ACCESS_SECRET: "kort",
    }),
    {
      enabled: false,
      accessCodeRequired: true,
      configurationValid: false,
    },
  );
  assert.equal(
    devLoginPolicy("https://portal.example.dk", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_TEST_ACCESS_SECRET: " ".repeat(8),
    }).configurationValid,
    false,
  );

  const environment = {
    DGITA_ENABLE_DEV_LOGIN: "true",
    DGITA_TEST_ACCESS_SECRET: "synthetic-test-access",
  };
  assert.equal(
    await verifyTestAccessCode(
      "synthetic-test-access",
      environment,
    ),
    true,
  );
  assert.equal(await verifyTestAccessCode("forkert", environment), false);
  assert.equal(await verifyTestAccessCode(undefined, environment), false);

  assert.equal(
    await verifyTestAccessCode("legacykode", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_DEMO_ACCESS_SECRET: "legacykode",
    }),
    true,
  );
  assert.equal(
    await verifyTestAccessCode("synthetic-test-access", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_TEST_ACCESS_SECRET: "synthetic-test-access",
      DGITA_DEMO_ACCESS_SECRET: "legacykode",
    }),
    true,
  );
  assert.equal(
    await verifyTestAccessCode("legacykode", {
      DGITA_ENABLE_DEV_LOGIN: "true",
      DGITA_TEST_ACCESS_SECRET: "synthetic-test-access",
      DGITA_DEMO_ACCESS_SECRET: "legacykode",
    }),
    false,
  );
});

test("kun de tre aftalte testroller accepteres", () => {
  assert.equal(isWorkspaceRole("user"), true);
  assert.equal(isWorkspaceRole("consultant"), true);
  assert.equal(isWorkspaceRole("admin"), true);
  assert.equal(isWorkspaceRole("superadmin"), false);
});

test("state-changing requests kræver samme Origin", () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("https://portal.example.dk/api/auth/logout", {
        method: "POST",
        headers: {
          Origin: "https://portal.example.dk",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
    ),
  );
  assert.throws(
    () =>
      assertSameOrigin(
        new Request("https://portal.example.dk/api/auth/logout", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    (error) =>
      error instanceof AuthHttpError && error.code === "ORIGIN_MISMATCH",
  );

  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("https://dgita-release-abc.vercel.app/api/auth/logout", {
        method: "POST",
        headers: {
          Origin: "https://dgita-release-abc.vercel.app",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
      {
        DGITA_APP_ORIGIN: "https://dgita-nine.vercel.app",
        VERCEL_URL: "dgita-release-abc.vercel.app",
      },
    ),
  );

  assert.throws(
    () =>
      assertSameOrigin(
        new Request("https://portal.example.dk/api/auth/logout", {
          method: "POST",
          headers: { Origin: "https://portal.example.dk" },
        }),
        {
          DGITA_APP_ORIGIN: "https://portal.example.dk",
          VERCEL_URL: "attacker.example",
        },
      ),
    (error) =>
      error instanceof AuthHttpError && error.code === "AUTH_CONFIGURATION_ERROR",
  );
});

test("auth-svar kan ikke caches", async () => {
  const response = noStoreJson({ ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.deepEqual(await response.json(), { ok: true });
});

test("OIDC-konfiguration kræver komplette HTTPS-metadata", () => {
  assert.equal(readOidcProviderConfig("entra", {}), null);
  assert.equal(
    readOidcProviderConfig("entra", {
      DGITA_ENTRA_ISSUER: "http://identity.example.dk",
      DGITA_ENTRA_CLIENT_ID: "client",
      DGITA_ENTRA_REDIRECT_URI: "https://portal.example.dk/api/auth/callback",
    }),
    null,
  );
  assert.deepEqual(
    readOidcProviderConfig("fk", {
      DGITA_FK_ISSUER: "https://context-handler.example.dk/",
      DGITA_FK_CLIENT_ID: "client",
      DGITA_FK_REDIRECT_URI: "https://portal.example.dk/api/auth/fk/callback",
    })?.acceptedIdTokenAlgorithms,
    ["PS256"],
  );
});

test("initialer beregnes stabilt fra visningsnavnet", () => {
  assert.equal(initialsFor("Partheepan Vijayamohan"), "PV");
  assert.equal(initialsFor("  Louise  Møller "), "LM");
  assert.equal(initialsFor(""), "?");
});
