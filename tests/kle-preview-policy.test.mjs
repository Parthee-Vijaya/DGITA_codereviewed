import test from "node:test";
import assert from "node:assert/strict";
import { assertKlePreview, permitsKlePreview, permitsKlePreviewPage } from "../features/system-usage/preview-policy.ts";

const origin = "http://127.0.0.1:4339";
const environment = { DGITA_ENVIRONMENT: "local", DGITA_ENABLE_KLE_PREVIEW: "true", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_APP_ORIGIN: origin };
test("synthetic KLE preview requires explicit local opt-in and matching loopback origin", () => {
  assert.equal(permitsKlePreview(environment, `${origin}/api/system-usages`), true);
  for (const key of Object.keys(environment)) assert.equal(permitsKlePreview({ ...environment, [key]: undefined }, origin), false, key);
  for (const stage of ["pilot", "production", "locla", "LOCAL"]) assert.equal(permitsKlePreview({ ...environment, DGITA_ENVIRONMENT: stage }, origin), false);
  for (const flag of ["VERCEL", "VERCEL_ENV", "CF_PAGES"]) assert.equal(permitsKlePreview({ ...environment, [flag]: "true" }, origin), false);
  for (const url of ["https://example.invalid", "http://127.0.0.1.evil.invalid:4339", "http://localhost:4339", "http://127.0.0.1:4340", "data:text/plain,test", "invalid"]) {
    assert.equal(permitsKlePreview(environment, url), false, url);
  }
  assert.equal(permitsKlePreview({ ...environment, DGITA_APP_ORIGIN: "https://example.invalid" }, origin), false);
});

test("KLE controls in application pages require the actual local host and a development identity", () => {
  assert.equal(permitsKlePreviewPage(environment, "127.0.0.1:4339", "dev"), true);
  for (const host of [null, "localhost:4339", "127.0.0.1:4340", "example.invalid", "127.0.0.1:4339.evil.invalid"]) {
    assert.equal(permitsKlePreviewPage(environment, host, "dev"), false, String(host));
  }
  for (const provider of ["entra", "fk", "", "DEV"]) assert.equal(permitsKlePreviewPage(environment, "127.0.0.1:4339", provider), false);
  assert.equal(permitsKlePreviewPage({ ...environment, DGITA_APP_ORIGIN: "invalid" }, "127.0.0.1:4339", "dev"), false);
  assert.equal(permitsKlePreviewPage({ ...environment, DGITA_ENABLE_KLE_PREVIEW: "false" }, "127.0.0.1:4339", "dev"), false);
  assert.equal(permitsKlePreviewPage({ ...environment, DGITA_ENVIRONMENT: "pilot" }, "127.0.0.1:4339", "dev"), false);
});

const hostedOrigin = "https://dgita-synthetic-preview.vercel.app";
const deploymentHost = "dgita-synthetic-preview-abc123-team.vercel.app";
const hostedEnvironment = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_synthetic_preview_fixture",
  VERCEL_URL: deploymentHost, DGITA_PREVIEW_PROJECT_ID: "prj_synthetic_preview_fixture",
  DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_HOSTED_PREVIEW: "true", DGITA_ENABLE_KLE_PREVIEW: "true",
  DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "true",
  DGITA_APP_ORIGIN: hostedOrigin, NEXT_PUBLIC_SITE_URL: hostedOrigin,
  DGITA_TEST_ACCESS_SECRET: "Synthetic-fixture-only-4937-ABcd-2026",
};

test("hosted KLE accepts only the approved origin or exact platform deployment URL", () => {
  for (const url of [`${hostedOrigin}/api/kle/search`, `https://${deploymentHost}/api/system-usages?id=fixture`]) {
    assert.equal(permitsKlePreview(hostedEnvironment, url), true, url);
    assert.doesNotThrow(() => assertKlePreview(hostedEnvironment, url));
  }
  for (const url of [
    "https://other-project.vercel.app", `https://${deploymentHost}.evil.invalid`,
    `http://${deploymentHost}`, `https://${deploymentHost}:444`,
    `https://attacker@${deploymentHost}`, "http://127.0.0.1:4339", "invalid",
  ]) assert.equal(permitsKlePreview(hostedEnvironment, url), false, url);
  assert.equal(permitsKlePreview({ ...hostedEnvironment, VERCEL_BRANCH_URL: "other-project.vercel.app" }, "https://other-project.vercel.app"), false);
  assert.throws(() => assertKlePreview(hostedEnvironment, "https://other-project.vercel.app"), { status: 404, code: "PREVIEW_UNAVAILABLE" });
});

test("hosted KLE requires every opt-in, the actual preview target and matching project", () => {
  for (const key of Object.keys(hostedEnvironment).filter((key) => key !== "VERCEL_URL")) {
    assert.equal(permitsKlePreview({ ...hostedEnvironment, [key]: undefined }, hostedOrigin), false, key);
  }
  for (const [key, values] of Object.entries({
    VERCEL: ["true", "0"], VERCEL_ENV: ["production", "development", "PREVIEW"],
    DGITA_ENVIRONMENT: ["local", "production", "pilto"],
    DGITA_PREVIEW_PROJECT_ID: ["prj_other_project", "invalid"], VERCEL_PROJECT_ID: ["prj_other_project"],
    DGITA_ENABLE_HOSTED_PREVIEW: ["false", "TRUE"], DGITA_ENABLE_KLE_PREVIEW: ["false"],
    DGITA_ENABLE_DEV_LOGIN: ["false"], DGITA_ENABLE_DEMO_SEED: ["false"], CF_PAGES: ["1"],
  })) {
    for (const value of values) assert.equal(permitsKlePreview({ ...hostedEnvironment, [key]: value }, hostedOrigin), false, `${key}=${value}`);
  }
  assert.equal(permitsKlePreview({ ...hostedEnvironment, VERCEL_URL: undefined }, hostedOrigin), true);
  assert.equal(permitsKlePreview({ ...hostedEnvironment, VERCEL_URL: undefined }, `https://${deploymentHost}`), false);
});

test("hosted KLE refuses weak public access secrets and legacy secret fallback", () => {
  for (const secret of ["short", "a".repeat(64), "1234567".repeat(10), `${hostedEnvironment.DGITA_TEST_ACCESS_SECRET} `, `\n${hostedEnvironment.DGITA_TEST_ACCESS_SECRET}`, `${hostedEnvironment.DGITA_TEST_ACCESS_SECRET}\u0000`]) {
    assert.equal(permitsKlePreview({ ...hostedEnvironment, DGITA_TEST_ACCESS_SECRET: secret }, hostedOrigin), false);
  }
  assert.equal(permitsKlePreview({ ...hostedEnvironment, DGITA_TEST_ACCESS_SECRET: undefined, DGITA_DEMO_ACCESS_SECRET: hostedEnvironment.DGITA_TEST_ACCESS_SECRET }, hostedOrigin), false);
});

test("hosted KLE refuses external integrations and any enabled mail recipient", () => {
  for (const key of ["DGITA_GRAPH_CLIENT_SECRET", "DGITA_GRAPH_BASE_URL", "DGITA_ENTRA_CLIENT_ID", "DGITA_FK_ISSUER", "DGITA_MALWARE_SCAN_URL", "DGITA_MALWARE_SCAN_TOKEN", "CRON_SECRET", "DGITA_MAIL_ALLOWED_RECIPIENTS"]) {
    assert.equal(permitsKlePreview({ ...hostedEnvironment, [key]: "synthetic-setting" }, hostedOrigin), false, key);
    assert.equal(permitsKlePreview({ ...hostedEnvironment, [key]: "" }, hostedOrigin), true, key);
  }
});

test("hosted KLE validates configured origins and platform host values before use", () => {
  for (const invalid of ["http://portal.example.invalid", "https://user:pass@portal.example.invalid", "https://portal.example.invalid/path", "https://portal.example.invalid?query", "https://portal.example.invalid#fragment", "https://portal.example.invalid:444", "https://localhost", "https://127.0.0.1", "https://[::1]", "invalid"]) {
    assert.equal(permitsKlePreview({ ...hostedEnvironment, DGITA_APP_ORIGIN: invalid, NEXT_PUBLIC_SITE_URL: invalid }, `https://${deploymentHost}`), false, invalid);
  }
  assert.equal(permitsKlePreview({ ...hostedEnvironment, NEXT_PUBLIC_SITE_URL: "https://other-project.vercel.app" }, hostedOrigin), false);
  for (const invalid of ["https://other.vercel.app", "other.vercel.app/path", "other.vercel.app:443", "other.vercel.app.evil.invalid", "user@other.vercel.app", "*.vercel.app"]) {
    assert.equal(permitsKlePreview({ ...hostedEnvironment, VERCEL_URL: invalid }, hostedOrigin), false, invalid);
  }
});

test("hosted KLE pages require an exact trusted host and a test identity", () => {
  for (const host of [new URL(hostedOrigin).host, deploymentHost]) {
    assert.equal(permitsKlePreviewPage(hostedEnvironment, host, "dev"), true, host);
    for (const provider of ["entra", "fk", "", "DEV"]) assert.equal(permitsKlePreviewPage(hostedEnvironment, host, provider), false, provider);
  }
  for (const host of [null, "other.vercel.app", `${deploymentHost}.evil.invalid`, `${deploymentHost}:444`, `${deploymentHost}/path`, `attacker@${deploymentHost}`]) {
    assert.equal(permitsKlePreviewPage(hostedEnvironment, host, "dev"), false, String(host));
  }
  assert.equal(permitsKlePreviewPage({ ...hostedEnvironment, VERCEL_ENV: "production" }, deploymentHost, "dev"), false);
});
