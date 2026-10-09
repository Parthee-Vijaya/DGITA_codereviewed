import assert from "node:assert/strict";
import test from "node:test";

// Exercise the actual API route using a local session and an isolated database.
Object.assign(process.env, {
  DGITA_ENVIRONMENT: "local",
  DGITA_ENABLE_DEV_LOGIN: "true",
  DGITA_ENABLE_DEMO_SEED: "true",
  TURSO_DATABASE_URL: ":memory:",
  TURSO_AUTH_TOKEN: "validation-test-only",
  BLOB_READ_WRITE_TOKEN: "validation-test-only",
  DGITA_APPROVAL_TOKEN_SECRET: "validation-test-only-approval-secret-123456789",
});
const { demoApplicationState, getAllErrors } = await import("./engine.ts");
const { createDevSession } = await import("../auth/server.ts");
const { POST } = await import("../../app/api/drafts/route.ts");
const { preparePortalData } = await import("../workspace/server-repository.ts");
const DB = await preparePortalData();
const baseUrl = "http://localhost:3001";
const session = await createDevSession(new Request(`${baseUrl}/api/auth/dev-login`), "user");
const cookie = session.cookie.split(";", 1)[0];

function state(overrides = {}) {
  return {
    ...structuredClone(demoApplicationState),
    knownSystem: "nej", selectedSystem: null, catalogQuery: "",
    manualSystemName: "Testsystem til validering", consent: true,
    ...overrides,
  };
}
async function post(body) {
  const response = await POST(new Request(`${baseUrl}/api/drafts`, {
    method: "POST", headers: { origin: baseUrl, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test("API gemmer ufærdige kladder, men afviser indsendelse med samme fejl som formularen", async () => {
  const draft = state({
    purpose: " \t ", manualSystemName: " ", acquisitionMethod: "ukendt",
    supplierCvr: "123", descriptionUrl: "javascript:alert(1)",
    startDate: "2026-02-30", endDate: "afventer", implementationUsers: "999",
    oneTimeCost: "-1", crossDepartments: [" "],
  });
  const id = crypto.randomUUID();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const result = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
  assert.equal(result.status, 422, JSON.stringify(result.body));
  assert.deepEqual(result.body.errors, getAllErrors(draft));
  assert.equal(await DB.prepare("SELECT status FROM portal_applications WHERE id = ?").bind(id).first("status"), "draft");
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM portal_application_versions WHERE application_id = ?").bind(id).first("n"), 0);
});

test("API tillader fortsat gratis anskaffelse med nul kroner", async () => {
  const result = await post({
    id: crypto.randomUUID(), status: "submitted",
    draft: state({ acquisitionMethod: "Gratis", hasBudget: "ja", budgetAmount: "0", oneTimeCost: "0", yearlyCost: "0,00", otherCost: "0" }),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, "submitted");
  assert.equal(result.body.versionNumber, 1);
});
