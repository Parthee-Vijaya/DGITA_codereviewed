import assert from "node:assert/strict";
import test from "node:test";

const origin = "http://localhost:3001";
Object.assign(process.env, {
  DGITA_ENVIRONMENT: "local", DGITA_ENABLE_DEV_LOGIN: "true", DGITA_ENABLE_DEMO_SEED: "true",
  DGITA_ENABLE_KLE_PREVIEW: "true", DGITA_APP_ORIGIN: origin,
  TURSO_DATABASE_URL: ":memory:", TURSO_AUTH_TOKEN: "synthetic-kle-application",
  BLOB_READ_WRITE_TOKEN: "synthetic-kle-application",
  DGITA_APPROVAL_TOKEN_SECRET: "synthetic-kle-application-test-material-only",
});
for (const key of ["VERCEL", "VERCEL_ENV", "CF_PAGES"]) delete process.env[key];
const { demoApplicationState } = await import("./engine.ts");
const { SYNTHETIC_KLE_CATALOG } = await import("../kle/synthetic.ts");
const { createDevSession } = await import("../auth/server.ts");
const { POST, GET } = await import("../../app/api/drafts/route.ts");
const { saveApplicationDraft, submitApplication, beginApplicationCorrection } = await import("./server-repository.ts");
const { preparePortalData } = await import("../workspace/server-repository.ts");
const DB = await preparePortalData();
const session = await createDevSession(new Request(`${origin}/api/auth/dev-login`), "user");
const cookie = session.cookie.split(";", 1)[0];

function selection(index = 1) {
  const { id, version, label, kind } = SYNTHETIC_KLE_CATALOG.source;
  const { uuid, code, title } = SYNTHETIC_KLE_CATALOG.entries[index];
  return { schemaVersion: 1, source: { id, version, label, kind }, entries: [{ uuid, code, title }] };
}
function state(kleSelection = selection()) {
  return { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    catalogQuery: "", manualSystemName: "Syntetisk KLE-ansøgning", consent: true,
    kleTopics: ["Tidligere beskrivelse, som skal bevares"], kleSelection };
}
async function post(body, requestUrl = `${origin}/api/drafts`) {
  const response = await POST(new Request(requestUrl, { method: "POST",
    headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
async function snapshot(id, version = 1) {
  return DB.prepare("SELECT snapshot_json FROM portal_application_versions WHERE application_id = ? AND version_number = ?").bind(id, version).first("snapshot_json");
}

test("selected KLE data survives save, reopen, immutable submission and a new correction version", async () => {
  const id = crypto.randomUUID(); const draft = state();
  const saved = await post({ id, draft, status: "draft" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const response = await GET(new Request(`${origin}/api/drafts?caseNumber=${saved.body.caseNumber}`, { headers: { cookie } }));
  const reopened = (await response.json()).draft;
  assert.deepEqual(reopened.state.kleSelection, draft.kleSelection);
  assert.deepEqual(reopened.state.kleTopics, draft.kleTopics);
  const submitted = await post({ id, draft: reopened.state, status: "submitted", expectedRowVersion: reopened.rowVersion });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const frozen = await snapshot(id);
  assert.deepEqual(JSON.parse(frozen).kleSelection, draft.kleSelection);
  assert.deepEqual(JSON.parse(frozen).kleTopics, draft.kleTopics);
  const rejected = await post({ id, draft: state(selection(2)), status: "draft", expectedRowVersion: submitted.body.rowVersion });
  assert.equal(rejected.status, 409);
  assert.equal(await snapshot(id), frozen);
  await DB.prepare("UPDATE portal_applications SET status = 'changes_requested', row_version = row_version + 1 WHERE id = ?").bind(id).run();
  const correction = await beginApplicationCorrection(session.actor, saved.body.caseNumber);
  assert.deepEqual(correction.state.kleSelection, draft.kleSelection);
  correction.state.kleSelection = selection(2);
  const next = await post({ id, draft: correction.state, status: "submitted", expectedRowVersion: correction.rowVersion });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.versionNumber, 2);
  assert.equal(await snapshot(id), frozen);
  assert.deepEqual(JSON.parse(await snapshot(id, 2)).kleSelection, selection(2));
});

test("legacy and null KLE answers remain saveable and submittable with search disabled", async () => {
  process.env.DGITA_ENABLE_KLE_PREVIEW = "false";
  try {
    for (const omit of [true, false]) {
      const draft = state(null); if (omit) delete draft.kleSelection;
      const id = crypto.randomUUID();
      const saved = await post({ id, draft, status: "draft" });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const submitted = await post({ id, draft, status: "submitted", expectedRowVersion: saved.body.rowVersion });
      assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
      assert.equal(JSON.parse(await snapshot(id)).kleSelection, null);
      assert.deepEqual(JSON.parse(await snapshot(id)).kleTopics, draft.kleTopics);
    }
  } finally { process.env.DGITA_ENABLE_KLE_PREVIEW = "true"; }
});

test("forged, stale, retired and unaccepted KLE choices never reach a draft or submitted version", async () => {
  const original = selection();
  const forged = [
    { ...original, source: { ...original.source, id: "other" } },
    { ...original, source: { ...original.source, version: "old" } },
    { ...original, source: { ...original.source, label: "Official source" } },
    { ...original, source: { ...original.source, kind: "licensed" } },
    { ...original, entries: [{ ...original.entries[0], code: "DEMO.99.99" }] },
    { ...original, entries: [{ ...original.entries[0], title: "Forged official title" }] },
    { ...original, entries: [{ ...original.entries[0], uuid: "00000000-0000-4000-8000-000000000099" }] },
    selection(4),
  ];
  for (const kleSelection of forged) {
    const id = crypto.randomUUID();
    for (const status of ["draft", "submitted"]) {
      const result = await post({ id, draft: state(kleSelection), status });
      assert.equal(result.status, 422, JSON.stringify(result.body));
    }
    assert.equal(await DB.prepare("SELECT id FROM portal_applications WHERE id = ?").bind(id).first("id"), null);
  }
});

test("API uses its real URL and repository callers cannot bypass preview or identity boundaries", async () => {
  const remote = await post({ id: crypto.randomUUID(), draft: state(), status: "draft" }, "https://portal.example.invalid/api/drafts");
  assert.equal(remote.status, 422, JSON.stringify(remote.body));
  for (const method of [saveApplicationDraft, submitApplication]) {
    const denied = (actor = session.actor, url = `${origin}/api/drafts`) => assert.rejects(method(actor, crypto.randomUUID(), state(), null, url), { status: 422 });
    await assert.rejects(method(session.actor, crypto.randomUUID(), state()), { status: 422 });
    await denied({ ...session.actor, provider: "entra" });
    await denied(session.actor, "https://portal.example.invalid/api/drafts");
    for (const [key, value] of [["DGITA_ENABLE_KLE_PREVIEW", "false"], ["DGITA_ENVIRONMENT", "pilot"], ["DGITA_ENVIRONMENT", "production"], ["DGITA_ENABLE_DEV_LOGIN", "false"], ["VERCEL", "1"], ["VERCEL_ENV", "preview"], ["CF_PAGES", "1"]]) {
      const before = process.env[key]; process.env[key] = value;
      try { await denied(); }
      finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
    }
  }
});
