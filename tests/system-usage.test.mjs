import assert from "node:assert/strict";
import test from "node:test";

// Process-local fixtures only. These tests never read or write KITOS or a deployed portal.
process.env.DGITA_ENVIRONMENT = "local";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-system-usage-test";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-system-usage-test";

const { portalDb } = await import("../features/application/repository-support.ts");
const { createSystemUsage, saveSystemUsage, getSystemUsage, listSystemUsages, listSystemUsageRevisions } = await import("../features/system-usage/repository.ts");
const { createEmptyKleReview, getKleInputBinding, getKleConfirmationBinding, evaluateKleReview, isKleReview } = await import("../features/kle/domain.ts");
const { readJsonObject } = await import("../features/auth/http.ts");
const { SYNTHETIC_KLE_CATALOG: catalog, SYNTHETIC_KL_TASK_CATALOG: tasks } = await import("../features/kle/synthetic.ts");
const DB = await portalDb();

async function person(role = "user", tenantId = "usage-fixture", suffix = crypto.randomUUID()) {
  await DB.prepare("INSERT OR IGNORE INTO portal_tenants (id, slug, name) VALUES (?, ?, 'Synthetic municipality')")
    .bind(tenantId, tenantId).run();
  const userId = `usage-${suffix}`;
  await DB.prepare(`INSERT INTO portal_users
    (id, tenant_id, identity_provider, external_subject, email, display_name)
    VALUES (?, ?, 'dev', ?, ?, 'Synthetic registrant')`)
    .bind(userId, tenantId, userId, `${suffix}@example.invalid`).run();
  await DB.prepare("INSERT INTO portal_user_roles (id, tenant_id, user_id, role) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), tenantId, userId, role === "consultant" ? "dgita_consultant" : role).run();
  return { userId, subject: userId, tenantId, role, provider: "dev", displayName: "Synthetic registrant",
    email: `${suffix}@example.invalid`, initials: "SR", municipality: "Synthetic municipality" };
}
const registrant = await person();
const admin = await person("admin");
const consultant = await person("consultant");
const foreign = await person("admin", "usage-other");

function completeReview() {
  const { uuid, code } = catalog.entries[1];
  const review = { ...createEmptyKleReview(), selectedCodes: [{ uuid, code }], localTaskDescription: "Syntetisk lokal driftsopgave" };
  review.localAssessment = { level: "medium", rationale: "Syntetisk begrundelse for den lokale vurdering", inputBinding: getKleInputBinding(review, catalog, tasks) };
  return review;
}
const create = (actor = registrant, review = createEmptyKleReview()) => createSystemUsage(actor, { id: crypto.randomUUID(), name: "Syntetisk systemanvendelse", review });
const save = (item, fields = {}, actor = registrant) => saveSystemUsage(actor, item.id, {
  name: item.name, review: item.review, expectedRowVersion: item.rowVersion, confirm: false, ...fields,
});
async function snapshot(id) {
  return {
    current: await DB.prepare("SELECT * FROM portal_system_usages WHERE id = ?").bind(id).first(),
    history: (await DB.prepare("SELECT * FROM portal_system_usage_revisions WHERE usage_id = ? ORDER BY row_version").bind(id).all()).results,
  };
}

test("synthetic usages live independently of cases and all existing roles can create only their own registrations", async () => {
  const caseCount = await DB.prepare("SELECT count(*) AS total FROM portal_applications").first();
  for (const actor of [registrant, consultant, admin]) {
    const item = await create(actor);
    assert.equal(item.rowVersion, 1);
    assert.equal(item.source, "synthetic");
    assert.equal(item.review.confirmation, undefined);
    assert.deepEqual(await getSystemUsage(actor, item.id), item);
    assert.ok((await listSystemUsages(actor)).some((entry) => entry.id === item.id));
    assert.equal("tenantId" in item, false);
    assert.equal("recordedByUserId" in item, false);
    const stored = await snapshot(item.id);
    assert.equal(stored.current.kitos_org_uuid, null);
    assert.equal(stored.current.kitos_usage_uuid, null);
    assert.equal(stored.history.length, 1);
    assert.equal(stored.history[0].event_type, "saved");
  }
  assert.deepEqual(await DB.prepare("SELECT count(*) AS total FROM portal_applications").first(), caseCount);
});

test("same-tenant administrators and foreign registrants cannot read, update or inspect another person's record", async () => {
  const item = await create();
  const before = await snapshot(item.id);
  for (const actor of [admin, consultant, foreign]) {
    assert.equal((await listSystemUsages(actor)).some((entry) => entry.id === item.id), false);
    await assert.rejects(getSystemUsage(actor, item.id), { status: 404 });
    await assert.rejects(listSystemUsageRevisions(actor, item.id), { status: 404 });
    await assert.rejects(save(item, { name: "Unwanted overwrite" }, actor), { status: 404 });
  }
  assert.deepEqual(await snapshot(item.id), before);
});

test("client metadata never creates confirmation, authority or KITOS binding; explicit confirmation stamps the actual registrant", async () => {
  const review = completeReview();
  review.confirmation = { inputBinding: getKleConfirmationBinding(review, catalog, tasks), confirmedBy: "Forged owner", confirmedAt: "2000-01-01T00:00:00.000Z" };
  const item = await createSystemUsage(registrant, { id: crypto.randomUUID(), name: "Syntetisk registrering", review,
    source: "kitos", kitosOrgUuid: crypto.randomUUID(), kitosUsageUuid: crypto.randomUUID(), recordedByUserId: admin.userId });
  assert.equal(item.source, "synthetic");
  assert.equal(item.review.confirmation, undefined);
  const before = Date.now();
  const confirmed = await save(item, { review, confirm: true });
  assert.equal(confirmed.review.confirmation.confirmedBy, registrant.userId);
  assert.ok(Date.parse(confirmed.review.confirmation.confirmedAt) >= before);
  assert.equal(evaluateKleReview(confirmed.review, catalog, tasks).confirmationCurrent, true);
  assert.equal((await listSystemUsageRevisions(registrant, item.id))[0].eventType, "confirmed");
  const stored = await snapshot(item.id);
  assert.equal(stored.current.recorded_by_user_id, registrant.userId);
  assert.equal(stored.current.kitos_org_uuid, null);
});

test("unchanged saves retain trusted confirmation while changes to name, tasks or assessment invalidate it", async () => {
  const item = await create(registrant, completeReview());
  const confirmed = await save(item, { confirm: true });
  const forged = structuredClone(confirmed.review);
  forged.confirmation.confirmedBy = "Forged name";
  const unchanged = await save(confirmed, { review: forged });
  assert.deepEqual(unchanged.review.confirmation, confirmed.review.confirmation);
  for (const fields of [
    { name: "Ændret syntetisk navn" },
    { review: { ...confirmed.review, localTaskDescription: "Ændret anvendelse" } },
    { review: { ...confirmed.review, localAssessment: { ...confirmed.review.localAssessment, rationale: "Ændret vurdering" } } },
  ]) {
    const current = await getSystemUsage(registrant, item.id);
    const reconfirmed = await save(current, { name: confirmed.name, review: confirmed.review, confirm: true });
    const changed = await save(reconfirmed, fields);
    assert.equal(changed.review.confirmation, undefined);
  }
  const history = await listSystemUsageRevisions(registrant, item.id);
  assert.deepEqual(history.find((entry) => entry.rowVersion === confirmed.rowVersion).review, confirmed.review);
});

test("incomplete, retired, unknown or stale assessment inputs cannot be confirmed and do not create history", async () => {
  const item = await create();
  const before = await snapshot(item.id);
  const stale = completeReview();
  stale.localTaskDescription = "New input after assessment";
  const retired = completeReview();
  retired.selectedCodes = [{ uuid: catalog.entries[4].uuid, code: catalog.entries[4].code }];
  retired.localAssessment.inputBinding = getKleInputBinding(retired, catalog, tasks);
  const unknown = completeReview();
  unknown.selectedCodes = [{ uuid: crypto.randomUUID(), code: "DEMO.99.99" }];
  unknown.localAssessment.inputBinding = getKleInputBinding(unknown, catalog, tasks);
  for (const review of [createEmptyKleReview(), stale, retired, unknown]) {
    await assert.rejects(save(item, { review, confirm: true }), { status: 422 });
    assert.deepEqual(await snapshot(item.id), before);
  }
});

test("changing source versions makes prior confirmation historical and requires a new local assessment", async () => {
  const confirmed = await save(await create(registrant, completeReview()), { confirm: true });
  const sourceVersion = catalog.source.version;
  try {
    catalog.source.version = `${sourceVersion}-next`;
    await assert.rejects(save(confirmed, { confirm: true }), { status: 422 });
    const saved = await save(confirmed);
    assert.equal(saved.review.confirmation, undefined);
    assert.deepEqual((await listSystemUsageRevisions(registrant, saved.id)).find((entry) => entry.rowVersion === confirmed.rowVersion).review, confirmed.review);
  } finally { catalog.source.version = sourceVersion; }
});

test("stale and concurrent saves cannot overwrite a winner or append losing history", async () => {
  const item = await create();
  const results = await Promise.allSettled([save(item, { name: "First concurrent change" }), save(item, { name: "Second concurrent change" })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
  const current = await getSystemUsage(registrant, item.id);
  const before = await snapshot(item.id);
  await assert.rejects(save(item), { status: 409 });
  assert.deepEqual(await snapshot(item.id), before);
  assert.equal(current.rowVersion, 2);
  assert.deepEqual((await listSystemUsageRevisions(registrant, item.id)).map((entry) => entry.rowVersion), [2, 1]);
});

test("history failure rolls back the associated update and creation without orphan records", async () => {
  const item = await create();
  const before = await snapshot(item.id);
  const count = await DB.prepare("SELECT count(*) AS total FROM portal_system_usages").first();
  await DB.prepare(`CREATE TRIGGER usage_fixture_history_failure BEFORE INSERT ON portal_system_usage_revisions
    WHEN NEW.name = 'Synthetic history failure' BEGIN SELECT RAISE(ABORT, 'synthetic history failure'); END`).run();
  try {
    await assert.rejects(save(item, { name: "Synthetic history failure" }), /synthetic history failure/u);
    assert.deepEqual(await snapshot(item.id), before);
    await assert.rejects(createSystemUsage(registrant, { id: crypto.randomUUID(), name: "Synthetic history failure", review: createEmptyKleReview() }), /synthetic history failure/u);
    assert.deepEqual(await DB.prepare("SELECT count(*) AS total FROM portal_system_usages").first(), count);
  } finally { await DB.prepare("DROP TRIGGER usage_fixture_history_failure").run(); }
});

test("revoked access is checked at the write and creates no partial record or history", async () => {
  const actor = await person();
  const item = await create(actor);
  const before = await snapshot(item.id);
  const batch = DB.batch.bind(DB);
  DB.batch = async (statements) => {
    await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id = ?").bind(actor.userId).run();
    return batch(statements);
  };
  try {
    await assert.rejects(save(item, { name: "Lost permission" }, actor), { status: 409 });
    assert.deepEqual(await snapshot(item.id), before);
  } finally { DB.batch = batch; }
  await assert.rejects(getSystemUsage(actor, item.id), { status: 403 });
  await assert.rejects(create(actor), { status: 403 });
});

test("non-dev, forged and disabled-tenant actors are denied even when a record ID is known", async () => {
  const item = await create();
  for (const actor of [{ ...registrant, provider: "entra" }, { ...registrant, subject: "wrong-subject" }, { ...foreign, userId: registrant.userId }]) {
    await assert.rejects(getSystemUsage(actor, item.id), { status: 403 });
    await assert.rejects(create(actor), { status: 403 });
  }
  await DB.prepare("UPDATE portal_tenants SET status = 'disabled' WHERE id = ?").bind(foreign.tenantId).run();
  try { await assert.rejects(listSystemUsages(foreign), { status: 403 }); }
  finally { await DB.prepare("UPDATE portal_tenants SET status = 'active' WHERE id = ?").bind(foreign.tenantId).run(); }
});

test("revision snapshots are append-only and cannot be forged for another tenant or current revision", async () => {
  const item = await create();
  const history = await listSystemUsageRevisions(registrant, item.id);
  await assert.rejects(DB.prepare("UPDATE portal_system_usage_revisions SET name = 'Changed history' WHERE id = ?").bind(history[0].id).run(), /append-only/u);
  await assert.rejects(DB.prepare("DELETE FROM portal_system_usage_revisions WHERE id = ?").bind(history[0].id).run(), /append-only/u);
  await assert.rejects(DB.prepare(`INSERT INTO portal_system_usage_revisions
    (id,tenant_id,usage_id,row_version,recorded_by_user_id,name,review_json,event_type,created_at)
    VALUES (?, ?, ?, 99, ?, ?, ?, 'saved', ?)`)
    .bind(crypto.randomUUID(), foreign.tenantId, item.id, foreign.userId, item.name, JSON.stringify(item.review), item.updatedAt).run(), /must match current record/u);
  await assert.rejects(DB.prepare("UPDATE portal_system_usages SET recorded_by_user_id = ?, row_version = row_version + 1 WHERE id = ?")
    .bind(admin.userId, item.id).run(), /identity is stable/u);
  assert.deepEqual(await listSystemUsageRevisions(registrant, item.id), history);
});

test("malformed inputs are rejected before storage and list/history results have bounded sizes", async () => {
  const item = await create();
  const before = await snapshot(item.id);
  for (const fields of [{ name: " " }, { name: "x".repeat(201) }, { name: "bad\u0000name" },
    { review: { ...item.review, schemaVersion: 2 } }, { review: { ...item.review, selectedCodes: "invalid" } },
    { review: { ...item.review, confirmation: { arbitrary: "unbounded" } } }, { confirm: "true" }]) {
    await assert.rejects(save(item, fields), { status: 422 });
  }
  await assert.rejects(getSystemUsage(registrant, "not-a-uuid"), { status: 400 });
  await assert.rejects(createSystemUsage(registrant, { name: item.name, review: item.review }), { status: 400 });
  assert.deepEqual(await snapshot(item.id), before);
  const actor = await person();
  for (let index = 0; index < 101; index++) await create(actor);
  assert.equal((await listSystemUsages(actor)).length, 100);
  let current = await create(actor);
  for (let index = 0; index < 51; index++) current = await save(current, {}, actor);
  const history = await listSystemUsageRevisions(actor, current.id);
  assert.equal(history.length, 50);
  assert.equal(history[0].rowVersion, 52);
  assert.equal(history.at(-1).rowVersion, 3);
});

test("creation retries after a lost response reuse the client ID and preserve later revisions", async () => {
  const input = { id: crypto.randomUUID(), name: "Syntetisk gentaget oprettelse", review: completeReview() };
  await createSystemUsage(registrant, input); // Simulate the caller losing the committed reply.
  const retried = await createSystemUsage(registrant, input);
  assert.equal(retried.id, input.id);
  assert.equal(retried.rowVersion, 1);
  assert.equal((await listSystemUsageRevisions(registrant, input.id)).length, 1);
  const edited = await save(retried, { name: "Senere rettelse", confirm: true });
  const before = await snapshot(input.id);
  assert.deepEqual(await createSystemUsage(registrant, input), edited);
  assert.deepEqual(await snapshot(input.id), before);
  await assert.rejects(createSystemUsage(registrant, { ...input, name: "Different initial request" }), { status: 409 });
  await assert.rejects(createSystemUsage(registrant, { ...input, review: createEmptyKleReview() }), { status: 409 });
  for (const actor of [admin, foreign]) await assert.rejects(createSystemUsage(actor, input), { status: 404 });
  assert.deepEqual(await snapshot(input.id), before);
});

test("concurrent identical creation requests yield one record and one first revision", async () => {
  const input = { id: crypto.randomUUID(), name: "Syntetisk samtidig oprettelse", review: createEmptyKleReview() };
  const results = await Promise.all([createSystemUsage(registrant, input), createSystemUsage(registrant, input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await listSystemUsageRevisions(registrant, input.id)).length, 1);
});

test("maximum escaped text survives confirmation, persistence, history and the bounded JSON client round trip", async () => {
  const review = completeReview();
  review.localTaskDescription = '\\"'.repeat(1000);
  review.legacyTopics = Array.from({ length: 50 }, (_, index) => `${String(index).padStart(2, "0")}${"\\".repeat(254)}`);
  review.localAssessment.rationale = '\\"'.repeat(1000);
  review.localAssessment.inputBinding = getKleInputBinding(review, catalog, tasks);
  assert.equal(isKleReview(review), true);
  const confirmed = await save(await create(registrant, review), { confirm: true });
  assert.equal(isKleReview(confirmed.review), true);
  assert.deepEqual(await getSystemUsage(registrant, confirmed.id), confirmed);
  assert.deepEqual((await listSystemUsageRevisions(registrant, confirmed.id))[0].review, confirmed.review);
  const payload = JSON.stringify({ action: "save", id: confirmed.id, name: confirmed.name,
    review: confirmed.review, expectedRowVersion: confirmed.rowVersion, confirm: false });
  assert.ok(Buffer.byteLength(payload, "utf8") < 750_000);
  const received = await readJsonObject(new Request("http://127.0.0.1:4318/api/system-usages", {
    method: "POST", headers: { "content-type": "application/json" }, body: payload,
  }));
  const resaved = await saveSystemUsage(registrant, confirmed.id, received);
  assert.deepEqual(resaved.review, confirmed.review);
  assert.deepEqual(await getSystemUsage(registrant, confirmed.id), resaved);
});

test("invalid server-generated metadata is rejected before changing the record or history", async () => {
  const actor = await person("user", "usage-fixture", "x".repeat(200));
  const item = await create(actor, completeReview());
  const before = await snapshot(item.id);
  await assert.rejects(save(item, { confirm: true }, actor), { status: 422 });
  assert.deepEqual(await snapshot(item.id), before);
});
