import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { productionConfigurationIssues } from "../features/runtime/production-config.ts";

function validConfig() {
  return {
    DGITA_ENVIRONMENT: "production", DGITA_ENABLE_DEV_LOGIN: "false", DGITA_ENABLE_DEMO_SEED: "false",
    DGITA_APP_ORIGIN: "https://portal.municipality.test", NEXT_PUBLIC_SITE_URL: "https://portal.municipality.test",
    DGITA_APPROVAL_TOKEN_SECRET: randomBytes(32).toString("hex"), CRON_SECRET: randomBytes(32).toString("hex"),
    DGITA_OIDC_STATE_SECRET: randomBytes(32).toString("hex"), DGITA_ENTRA_TENANT_ID: randomUUID(),
    DGITA_ENTRA_CLIENT_ID: randomUUID(), DGITA_ENTRA_CLIENT_SECRET: "synthetic-client-credential",
    DGITA_ENTRA_PORTAL_TENANT_ID: "municipality-test", DGITA_ENTRA_REDIRECT_URI: "https://portal.municipality.test/api/auth/entra/callback",
    TURSO_DATABASE_URL: "libsql://database.test", TURSO_AUTH_TOKEN: "synthetic-database-token", BLOB_STORE_ID: "synthetic-store",
    NEXT_PUBLIC_DGITA_UPLOAD_MODE: "vercel-blob", DGITA_MALWARE_SCAN_URL: "https://scanner.municipality.test/scan",
    DGITA_MALWARE_SCAN_TOKEN: randomBytes(32).toString("hex"), DGITA_GRAPH_TENANT_ID: randomUUID(),
    DGITA_GRAPH_CLIENT_ID: randomUUID(), DGITA_GRAPH_CLIENT_SECRET: "synthetic-mail-credential", DGITA_GRAPH_SENDER: "portal@municipality.test",
  };
}

test("production preflight reports field names only and requires separated secure configuration", () => {
  const env = validConfig();
  assert.deepEqual(productionConfigurationIssues(env), []);
  const invalid = { ...env, DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "true", CRON_SECRET: env.DGITA_APPROVAL_TOKEN_SECRET, DGITA_MALWARE_SCAN_URL: "http://scanner.municipality.test" };
  assert.deepEqual(productionConfigurationIssues(invalid), ["DGITA_ENABLE_DEV_LOGIN", "DGITA_ENABLE_DEMO_SEED", "CRON_SECRET", "DGITA_MALWARE_SCAN_URL"]);
  assert.equal(JSON.stringify(productionConfigurationIssues(invalid)).includes(env.DGITA_APPROVAL_TOKEN_SECRET), false);
});

test("production preflight matches the scanner's credential and timeout boundaries", () => {
  const issues = productionConfigurationIssues({ ...validConfig(), DGITA_MALWARE_SCAN_TOKEN: "short", DGITA_MALWARE_SCAN_TIMEOUT_MS: "30001" });
  assert.deepEqual(issues, ["DGITA_MALWARE_SCAN_TOKEN", "DGITA_MALWARE_SCAN_TIMEOUT_MS"]);
});

test("production preflight rejects template secrets and missing services", () => {
  const issues = productionConfigurationIssues({ ...validConfig(), DGITA_ENTRA_CLIENT_SECRET: "replace-with-real-secret", TURSO_DATABASE_URL: ":memory:", DGITA_GRAPH_SENDER: "" });
  assert.deepEqual(issues, ["DGITA_ENTRA_CLIENT_SECRET", "DGITA_GRAPH_SENDER", "TURSO_DATABASE_URL", "DGITA_GRAPH_CONFIGURATION"]);
});

test("readiness reuses actual mail and Entra configuration validators", () => {
  for (const invalid of [
    { DGITA_GRAPH_SENDER: "invalid-mailbox" }, { DGITA_GRAPH_TENANT_ID: "common" },
    { DGITA_GRAPH_BASE_URL: "https://untrusted.test" }, { DGITA_GRAPH_TIMEOUT_MS: "-1" },
    { DGITA_MAIL_ALLOWED_RECIPIENTS: "*@municipality.test" },
  ]) assert.ok(productionConfigurationIssues({ ...validConfig(), ...invalid }).includes("DGITA_GRAPH_CONFIGURATION"));
  assert.ok(productionConfigurationIssues({ ...validConfig(), DGITA_ENTRA_ISSUER: "https://untrusted.test" }).includes("DGITA_ENTRA_CONFIGURATION"));
});
