import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";

Object.assign(process.env, {
  DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true",
  TURSO_DATABASE_URL: ":memory:", TURSO_AUTH_TOKEN: "synthetic-workflow",
  BLOB_READ_WRITE_TOKEN: "synthetic-workflow",
  DGITA_APPROVAL_TOKEN_SECRET: "synthetic-workflow-token-material-only",
});
const { preparePortalData, resolveActorUserId, getWorkspaceForActor, listCasesForActor,
  saveApprovalForActor, requestApplicationInformationForActor, rejectApplicationForActor,
  addFieldCommentForActor, listApprovalHistoryForActor } = await import("../features/workspace/server-repository.ts");
const { submitApplication, beginApplicationCorrection, saveApplicationDraft } = await import("../features/application/server-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const { createLeaderApprovalRequest, decideLeaderApproval } = await import("../features/approval/server.ts");
const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
const { listCaseActivity } = await import("../features/cases/dialog-repository.ts");
const DB = await preparePortalData();
const { getPersistenceBindings } = await import("../db/persistence.ts");
const bindings = await getPersistenceBindings();
const originalFiles = bindings.FILES;
const objects = new Map();
bindings.FILES = {
  async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.buffer } : null; },
  async put(key, value) { objects.set(key, new Uint8Array(value)); return { key }; },
  async delete(key) { objects.delete(key); },
};
after(() => { bindings.FILES = originalFiles; });
const actors = {};
for (const role of ["user", "consultant", "admin"]) {
  const actor = { ...DEMO_VIEWERS[role], provider: "dev" };
  actor.userId = await resolveActorUserId(DB, actor);
  actors[role] = actor;
}
const [approver] = await listApproversForActor(actors.user);
const state = () => ({ ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
  manualSystemName: "Syntetisk suppleringssag", catalogQuery: "", approvingLeaderId: approver.id,
  approvingLeader: approver.name, consent: true, aiUsage: "nej" });
const create = () => submitApplication(actors.user, crypto.randomUUID(), state());
const current = async (item) => (await getWorkspaceForActor(actors.consultant)).approvals[item.caseNumber];
const caseRecord = async (item, actor = actors.consultant) => (await listCasesForActor(actor)).find((entry) => entry.id === item.caseNumber);
const inputFor = async (item, extra = {}) => {
  const record = await caseRecord(item);
  return { reason: "Beskriv adgang og ansvar nærmere.", dueDate: "2099-12-01", expectedVersionId: record.currentVersionId,
    expectedRowVersion: record.revision, ...extra };
};
const requestInfo = (item, input) => requestApplicationInformationForActor(actors.consultant, item.caseNumber, input);
async function review(item, extra = {}) {
  const loaded = await current(item);
  return saveApprovalForActor(actors.consultant, item.caseNumber, { ...loaded, phase: "Under behandling", ...extra }, loaded.updatedAt ?? null, loaded.revision);
}
async function leaderDecision(item, decision = "approved") {
  const request = await createLeaderApprovalRequest(actors.consultant, item.caseNumber, "https://portal.example.invalid");
  await decideLeaderApproval(await approvalTokenForRequest(request.id), { decision, comment: "Syntetisk lederbeslutning" });
  return request;
}
async function snapshot(item) {
  const result = {};
  for (const table of ["portal_applications", "portal_application_versions", "portal_dgita_approvals", "portal_dgita_review_history", "portal_audit_events", "portal_notifications", "portal_mail_outbox", "portal_attachments"]) {
    result[table] = (await DB.prepare(`SELECT * FROM ${table} WHERE ${table === "portal_applications" ? "id" : "application_id"} = ? ORDER BY id`).bind(item.id).all()).results;
  }
  return result;
}
async function reject(item, extra = {}) {
  const approval = await current(item);
  return rejectApplicationForActor(actors.consultant, item.caseNumber, {
    ...await inputFor(item), expectedUpdatedAt: approval.updatedAt ?? null, reason: "Sagen kan ikke godkendes på dette grundlag.", ...extra,
  });
}

// These are service-level tests on real transactional SQLite, including races between reads and writes.
test("public request requires role, tenant, current version, revision, reason and real non-past date", async () => {
  const item = await create();
  const input = await inputFor(item);
  const before = await snapshot(item);
  await assert.rejects(requestApplicationInformationForActor(actors.user, item.caseNumber, input), { status: 403 });
  await assert.rejects(requestApplicationInformationForActor({ ...actors.consultant, tenantId: "foreign" }, item.caseNumber, input), { status: 404 });
  for (const change of [{ expectedVersionId: crypto.randomUUID() }, { expectedRowVersion: input.expectedRowVersion - 1 }]) {
    await assert.rejects(requestInfo(item, { ...input, ...change }), { status: 409 });
  }
  for (const change of [{ reason: " " }, { dueDate: "2099-02-31" }, { dueDate: "2020-01-01" }]) {
    await assert.rejects(requestInfo(item, { ...input, ...change }), { status: 422 });
  }
  assert.deepEqual(await snapshot(item), before);
});

test("request is public, immutable, multiclick-safe and preserves snapshots, files and comments across v2", async () => {
  const item = await create();
  await review(item, { internalComments: "PRIVATE_RETURN_CANARY" });
  const record = await caseRecord(item);
  const fileKey = crypto.randomUUID();
  const bytes = new Uint8Array([1, 2, 3]);
  objects.set(fileKey, bytes);
  await DB.prepare(`INSERT INTO portal_attachments
    (id,tenant_id,application_id,application_version_id,owner_user_id,kind,original_name,size_bytes,content_type,storage_key,checksum_sha256,status,scan_status,uploaded_by_user_id,immutable_at)
    VALUES (?, ?, ?, ?, ?, 'contract', 'synthetic.pdf', 3, 'application/pdf', ?, ?, 'ready', 'clean', ?, ?)`)
    .bind(crypto.randomUUID(), actors.user.tenantId, item.id, record.currentVersionId, actors.user.userId, fileKey, createHash("sha256").update(bytes).digest("hex"), actors.user.userId, new Date().toISOString()).run();
  await addFieldCommentForActor(actors.consultant, { id: crypto.randomUUID(), caseId: item.caseNumber, fieldId: "purpose", body: "Offentlig feltkommentar", visibility: "applicant" });
  const before = await snapshot(item);
  const input = await inputFor(item);
  const [first, second] = await Promise.all([requestInfo(item, input), requestInfo(item, input)]);
  assert.deepEqual(first, second);
  assert.equal((await caseRecord(item, actors.user)).status, "changes_requested");
  assert.deepEqual((await caseRecord(item, actors.user)).informationRequest, first);
  assert.equal(JSON.stringify(await caseRecord(item, actors.user)).includes("PRIVATE_RETURN_CANARY"), false);
  assert.deepEqual(await requestInfo(item, input), first);
  await assert.rejects(requestInfo(item, { ...input, reason: "Anden begrundelse" }), { status: 409 });
  await assert.rejects(requestInfo(item, { ...input, dueDate: "2099-12-02" }), { status: 409 });
  const after = await snapshot(item);
  assert.equal(after.portal_audit_events.filter((row) => row.event_type === "application.information_requested").length, 1);
  assert.equal(after.portal_notifications.filter((row) => row.event_type === "application.information_requested").length, 1);
  assert.deepEqual(after.portal_application_versions, before.portal_application_versions);
  assert.deepEqual(after.portal_attachments, before.portal_attachments);
  assert.equal((await getWorkspaceForActor(actors.user)).fieldComments.some((comment) => comment.caseId === item.caseNumber), true);
  assert.equal((await listCaseActivity(actors.user, item.caseNumber)).some((event) => event.eventType === "application.information_requested"), true);
  const correction = await beginApplicationCorrection(actors.user, item.caseNumber);
  assert.deepEqual(correction.informationRequest, first);
  assert.equal(correction.rejection, null);
  await submitApplication(actors.user, item.id, { ...correction.state, purpose: "Suppleret formål" }, correction.rowVersion);
  const latest = await caseRecord(item);
  assert.notEqual(latest.currentVersionId, record.currentVersionId);
  assert.equal(latest.informationRequest, null);
  assert.equal(latest.hasCurrentLeaderApproval, false);
  assert.equal((await snapshot(item)).portal_application_versions.length, 2);
  assert.deepEqual((await snapshot(item)).portal_application_versions.find((v) => v.id === record.currentVersionId), before.portal_application_versions[0]);
  assert.equal((await listApprovalHistoryForActor(actors.consultant, item.caseNumber)).length, 1);
});

test("request rejects an open leader link and never silently revokes it", async () => {
  const item = await create();
  const leader = await createLeaderApprovalRequest(actors.consultant, item.caseNumber, "https://portal.example.invalid");
  const before = await snapshot(item);
  await assert.rejects(requestInfo(item, await inputFor(item)), { status: 409 });
  assert.equal(await DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ?").bind(leader.id).first("status"), "pending");
  assert.deepEqual(await snapshot(item), before);
  // A historically inconsistent correction row must not silently revoke its live link.
  await DB.prepare("UPDATE portal_applications SET status = 'changes_requested' WHERE id = ?").bind(item.id).run();
  const inconsistent = await snapshot(item);
  await assert.rejects(beginApplicationCorrection(actors.user, item.caseNumber), { status: 409 });
  assert.equal(await DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ?").bind(leader.id).first("status"), "pending");
  assert.deepEqual(await snapshot(item), inconsistent);
});

test("request audit/notification failures roll back status, revision and all effects", async () => {
  for (const table of ["portal_audit_events", "portal_notifications"]) {
    const item = await create();
    const before = await snapshot(item);
    await DB.prepare(`CREATE TRIGGER request_failure BEFORE INSERT ON ${table} WHEN NEW.application_id = '${item.id}' BEGIN SELECT RAISE(ABORT, 'synthetic request failure'); END`).run();
    try { await assert.rejects(requestInfo(item, await inputFor(item)), /synthetic request failure/u); }
    finally { await DB.prepare("DROP TRIGGER request_failure").run(); }
    assert.deepEqual(await snapshot(item), before);
  }
});

test("positive review and closure reject missing, expired, rejected and uncommitted leader approvals", async () => {
  const missing = await create();
  for (const phase of ["Under behandling", "Afsluttet"]) await assert.rejects(review(missing, { approved: "Ja", phase }), { status: 409 });
  for (const status of ["expired", "rejected", "approved"]) {
    const item = await create();
    const request = await createLeaderApprovalRequest(actors.consultant, item.caseNumber, "https://portal.example.invalid");
    await DB.prepare("UPDATE portal_approval_requests SET status = ?, decided_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), request.id).run();
    await assert.rejects(review(item, { approved: "Ja" }), { status: 409 });
  }
});

test("a rejected leader decision permits only an explicit terminal rejection while corrections are outstanding", async () => {
  const item = await create();
  await leaderDecision(item, "rejected");
  await assert.rejects(review(item, { approved: "Ja" }), { status: 409 });
  const correction = await beginApplicationCorrection(actors.user, item.caseNumber);
  await reject(item);
  assert.equal((await caseRecord(item)).status, "closed");
  await assert.rejects(submitApplication(actors.user, item.id, state(), correction.rowVersion), { status: 409 });
});

test("committed current approval permits final closure even after its token expires; v1 never approves v2", async () => {
  const item = await create();
  const leader = await leaderDecision(item);
  // The original link may expire after a timely immutable decision.
  await DB.prepare("UPDATE portal_approval_requests SET expires_at = decided_at WHERE id = ?").bind(leader.id).run();
  assert.equal((await caseRecord(item)).hasCurrentLeaderApproval, true);
  await review(item, { approved: "Ja" });
  await requestInfo(item, await inputFor(item));
  const correction = await beginApplicationCorrection(actors.user, item.caseNumber);
  await submitApplication(actors.user, item.id, state(), correction.rowVersion);
  await assert.rejects(review(item, { approved: "Ja", phase: "Afsluttet" }), { status: 409 });
  await leaderDecision(item);
  await review(item, { approved: "Ja", phase: "Afsluttet" });
  assert.equal((await caseRecord(item)).status, "closed");
  assert.equal((await caseRecord(item, actors.user)).finalDecision.outcome, "approved");
});

test("Nej is an internal assessment; explicit public rejection is terminal and retry-safe without leader approval", async () => {
  const item = await create();
  await review(item, { approved: "Nej", internalComments: "Preserve private review" });
  assert.equal((await caseRecord(item)).status, "under_review");
  await assert.rejects(beginApplicationCorrection(actors.user, item.caseNumber), { status: 409 });
  await assert.rejects(review(item, { approved: "Nej", phase: "Afsluttet" }), { status: 422 });
  const loaded = await current(item);
  const input = { ...await inputFor(item), reason: "Offentlig afslagsbegrundelse", expectedUpdatedAt: loaded.updatedAt };
  const [saved, parallel] = await Promise.all([rejectApplicationForActor(actors.consultant, item.caseNumber, input), rejectApplicationForActor(actors.consultant, item.caseNumber, input)]);
  assert.deepEqual(parallel, saved);
  assert.equal(saved.internalComments, "Preserve private review");
  assert.equal(saved.notes, input.reason);
  assert.deepEqual((await caseRecord(item, actors.user)).finalDecision, { outcome: "rejected", reason: input.reason, decidedAt: saved.updatedAt });
  assert.equal((await caseRecord(item)).status, "closed");
  const before = await snapshot(item);
  assert.deepEqual(await rejectApplicationForActor(actors.consultant, item.caseNumber, input), saved);
  await assert.rejects(rejectApplicationForActor(actors.consultant, item.caseNumber, { ...input, reason: "Ændret afslag" }), { status: 409 });
  await assert.rejects(review(item), { status: 409 });
  await assert.rejects(beginApplicationCorrection(actors.user, item.caseNumber), { status: 409 });
  await assert.rejects(saveApplicationDraft(actors.user, item.id, state(), (await caseRecord(item)).revision), { status: 409 });
  await assert.rejects(requestInfo(item, await inputFor(item)), { status: 409 });
  assert.deepEqual(await snapshot(item), before);
});

async function withBatchRace(change, action) {
  const original = DB.batch;
  let injected = false;
  DB.batch = async function (statements) {
    if (!injected) { injected = true; await change(); }
    return original.call(this, statements);
  };
  try { await action(); assert.equal(injected, true); }
  finally { DB.batch = original; }
}

test("CAS rechecks leader status and case revision before positive decisions or return", async () => {
  const positive = await create();
  const leader = await leaderDecision(positive);
  const prior = await snapshot(positive);
  await withBatchRace(() => DB.prepare("UPDATE portal_approval_requests SET status = 'cancelled' WHERE id = ?").bind(leader.id).run(),
    () => assert.rejects(review(positive, { approved: "Ja", phase: "Afsluttet" }), { status: 409 }));
  assert.deepEqual(await snapshot(positive), prior);
  for (const race of ["revision", "leader"]) {
    const item = await create();
    const input = await inputFor(item);
    const before = await snapshot(item);
    await withBatchRace(async () => {
      if (race === "revision") await DB.prepare("UPDATE portal_applications SET row_version = row_version + 1 WHERE id = ?").bind(item.id).run();
      else await createLeaderApprovalRequest(actors.consultant, item.caseNumber, "https://portal.example.invalid");
    }, () => assert.rejects(requestInfo(item, input), { status: 409 }));
    const after = await snapshot(item);
    assert.equal(after.portal_audit_events.some((row) => row.event_type === "application.information_requested"), false);
    assert.deepEqual(after.portal_dgita_approvals, before.portal_dgita_approvals);
    assert.notEqual(after.portal_applications[0].status, "changes_requested");
  }
});

test("explicit final rejection is tenant/role/version guarded and audit failure rolls back closure", async () => {
  const item = await create();
  const input = { ...await inputFor(item), expectedUpdatedAt: null };
  await assert.rejects(rejectApplicationForActor(actors.user, item.caseNumber, input), { status: 403 });
  await assert.rejects(rejectApplicationForActor({ ...actors.consultant, tenantId: "foreign" }, item.caseNumber, input), { status: 404 });
  await assert.rejects(reject(item, { expectedVersionId: crypto.randomUUID() }), { status: 409 });
  await assert.rejects(reject(item, { reason: " " }), { status: 422 });
  const before = await snapshot(item);
  await DB.prepare(`CREATE TRIGGER rejection_failure BEFORE INSERT ON portal_audit_events WHEN NEW.event_type = 'application.finally_rejected' BEGIN SELECT RAISE(ABORT, 'synthetic rejection failure'); END`).run();
  try { await assert.rejects(reject(item), /synthetic rejection failure/u); }
  finally { await DB.prepare("DROP TRIGGER rejection_failure").run(); }
  assert.deepEqual(await snapshot(item), before);
});

test("legacy case reads do not fabricate requests, approvals or AI answers", async () => {
  await DB.prepare("UPDATE portal_applications SET draft_state_json = json_remove(draft_state_json, '$.aiUsage') WHERE case_number = 'ITA-001284'").run();
  const record = await caseRecord({ caseNumber: "ITA-001284" });
  assert.equal(record.informationRequest, null);
  assert.equal(record.finalDecision, null);
  assert.equal(record.hasCurrentLeaderApproval, false);
  assert.equal(record.aiUsage, "");
});


test("legacy internal rejection stays readable and is returned only by the explicit action", async () => {
  const item = await create();
  await DB.prepare("UPDATE portal_applications SET status = 'rejected' WHERE id = ?").bind(item.id).run();
  assert.equal((await caseRecord(item)).status, "rejected");
  await assert.rejects(beginApplicationCorrection(actors.user, item.caseNumber), { status: 409 });
  await requestInfo(item, await inputFor(item));
  assert.equal((await caseRecord(item)).status, "changes_requested");
});


test("a purported committed approval decided after its link expired cannot authorize D-GITA", async () => {
  const item = await create();
  const request = await leaderDecision(item);
  await DB.prepare("UPDATE portal_approval_requests SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").bind(request.id).run();
  assert.equal((await caseRecord(item)).hasCurrentLeaderApproval, false);
  const before = await snapshot(item);
  await assert.rejects(review(item, { approved: "Ja", phase: "Afsluttet" }), { status: 409 });
  assert.deepEqual(await snapshot(item), before);
});
