import assert from "node:assert/strict";
import test from "node:test";

import { assertTestLoginAccess } from "./test-access.ts";
import { AuthHttpError } from "./http.ts";

const publicUrl = "https://portal.example.dk/login";
const validEnvironment = {
  DGITA_ENABLE_DEV_LOGIN: "true",
  DGITA_TEST_ACCESS_SECRET: "synthetic-test-access",
};

test("offentligt testlogin fejler lukket uden en gyldig serverkode", async () => {
  await assert.rejects(
    assertTestLoginAccess(
      publicUrl,
      { DGITA_ENABLE_DEV_LOGIN: "true" },
      "uanset-kode",
      null,
    ),
    (error) =>
      error instanceof AuthHttpError &&
      error.status === 503 &&
      error.code === "TEST_LOGIN_CONFIGURATION_ERROR",
  );
  await assert.rejects(
    assertTestLoginAccess(
      publicUrl,
      {
        DGITA_ENABLE_DEV_LOGIN: "true",
        DGITA_TEST_ACCESS_SECRET: "kort",
      },
      "kort",
      null,
    ),
    (error) =>
      error instanceof AuthHttpError &&
      error.code === "TEST_LOGIN_CONFIGURATION_ERROR",
  );
});

test("første offentlige testlogin kræver den eksakte adgangskode", async () => {
  await assert.rejects(
    assertTestLoginAccess(publicUrl, validEnvironment, undefined, null),
    (error) =>
      error instanceof AuthHttpError &&
      error.status === 403 &&
      error.code === "INVALID_TEST_ACCESS_CODE",
  );
  await assert.rejects(
    assertTestLoginAccess(publicUrl, validEnvironment, "forkert", null),
    (error) =>
      error instanceof AuthHttpError &&
      error.code === "INVALID_TEST_ACCESS_CODE",
  );
  await assert.doesNotReject(
    assertTestLoginAccess(
      publicUrl,
      validEnvironment,
      validEnvironment.DGITA_TEST_ACCESS_SECRET,
      null,
    ),
  );
});

test("en eksisterende test-session kan skifte rolle uden ny adgangskode", async () => {
  await assert.doesNotReject(
    assertTestLoginAccess(publicUrl, validEnvironment, undefined, "dev"),
  );
  await assert.rejects(
    assertTestLoginAccess(publicUrl, validEnvironment, undefined, "entra"),
    (error) =>
      error instanceof AuthHttpError &&
      error.code === "INVALID_TEST_ACCESS_CODE",
  );
});

test("localhost bevarer testlogin uden adgangskode", async () => {
  await assert.doesNotReject(
    assertTestLoginAccess("http://localhost:3000/login", {}, undefined, null),
  );
});
