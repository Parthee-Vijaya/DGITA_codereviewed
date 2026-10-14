import test from "node:test";
import assert from "node:assert/strict";
import { permitsKlePreview, permitsKlePreviewPage } from "../features/system-usage/preview-policy.ts";

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
