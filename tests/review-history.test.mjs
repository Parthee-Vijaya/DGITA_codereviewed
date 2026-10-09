import assert from "node:assert/strict";
import test from "node:test";

// Process-local synthetic storage; this suite never contacts a deployment.
process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-review-history";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-review-history";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "synthetic-review-history-token-material-only";

const { preparePortalData, resolveActorUserId, getWorkspaceForActor, saveApprovalForActor, listApprovalHistoryForActor } = await import("../features/workspace/server-repository.ts");
const { submitApplication, beginApplicationCorrection } = await import("../features/application/server-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const { listCaseActivity } = await import("../features/cases/dialog-repository.ts");
const { getReceiptView } = await import("../features/receipt/view-server.ts");
const { getAccessibleReceiptSource, renderReceipt } = await import("../features/receipt/server.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest } = await import("../features/approval/server.ts");
const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
const { PDFDocument, PDFArray, decodePDFRawStream } = await import("pdf-lib");

const DB = await preparePortalData();
const owner = { ...DEMO_VIEWERS.user, provider: "dev" };
owner.userId = await resolveActorUserId(DB, owner);
const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
consultant.userId = await resolveActorUserId(DB, consultant);
const admin = { ...DEMO_VIEWERS.admin, provider: "dev" };
admin.userId = await resolveActorUserId(DB, admin);
const [approver] = await listApproversForActor(owner);
const state = () => ({ ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
  manualSystemName: "Syntetisk historikprøve", catalogQuery: "", approvingLeaderId: approver.id,
  approvingLeader: approver.name, consent: true });
const create = () => submitApplication(owner, crypto.randomUUID(), state());
const current = async (item) => (await getWorkspaceForActor(consultant)).approvals[item.caseNumber];
async function save(item, description, extra = {}) {
  const loaded = await current(item);
  return saveApprovalForActor(consultant, item.caseNumber, {
    ...loaded, phase: "Under behandling", infrastructureChanges: "Ja", infrastructureDescription: description, ...extra,
  }, loaded.updatedAt ?? null, loaded.revision);
}
async function persisted(item) {
  return {
    application: await DB.prepare("SELECT * FROM portal_applications WHERE id = ?").bind(item.id).first(),
    approval: await DB.prepare("SELECT * FROM portal_dgita_approvals WHERE application_id = ?").bind(item.id).first(),
    history: await listApprovalHistoryForActor(consultant, item.caseNumber),
    audit: (await DB.prepare("SELECT * FROM portal_audit_events WHERE application_id = ? ORDER BY id").bind(item.id).all()).results,
  };
}

test("each saved review keeps its immutable version, revision, actor and timestamp across resubmission", async () => {
  const item = await create();
  const first = await save(item, "First private infrastructure assessment");
  const second = await save(item, "Second private infrastructure assessment");
  const initialHistory = await listApprovalHistoryForActor(consultant, item.caseNumber);
  assert.equal(initialHistory.length, 2);
  assert.deepEqual(initialHistory.map((entry) => entry.approval.infrastructureDescription), [first.infrastructureDescription, second.infrastructureDescription]);
  assert.deepEqual(initialHistory.map((entry) => entry.applicationRevision), [first.revision, second.revision]);
  assert.ok(initialHistory.every((entry) => entry.reviewerUserId === consultant.userId && entry.reviewerSubject === consultant.subject));
  assert.ok(initialHistory.every((entry) => entry.createdAt === entry.approval.updatedAt));
  assert.equal(initialHistory[0].applicationVersionId, initialHistory[1].applicationVersionId);

  // Fixture the existing return-to-applicant state; exercise the real correction and resubmission services.
  await DB.prepare("UPDATE portal_applications SET status = 'changes_requested', row_version = row_version + 1 WHERE id = ?").bind(item.id).run();
  const correction = await beginApplicationCorrection(owner, item.caseNumber);
  await submitApplication(owner, item.id, state(), correction.rowVersion);
  assert.equal((await current(item)).infrastructureDescription, "");
  const third = await save(item, "Assessment for the new application version");
  const history = await listApprovalHistoryForActor(admin, item.caseNumber);
  assert.equal(history.length, 3);
  assert.deepEqual(history.slice(0, 2), initialHistory);
  assert.notEqual(history[2].applicationVersionId, history[0].applicationVersionId);
  assert.equal(history[2].approval.infrastructureDescription, third.infrastructureDescription);
  assert.equal((await current(item)).infrastructureDescription, third.infrastructureDescription);

  await assert.rejects(DB.prepare("UPDATE portal_dgita_review_history SET internal_fields_json = '{}' WHERE id = ?").bind(history[0].id).run(), /append-only/u);
  await assert.rejects(DB.prepare("DELETE FROM portal_dgita_review_history WHERE id = ?").bind(history[0].id).run(), /append-only/u);
  assert.deepEqual(await listApprovalHistoryForActor(consultant, item.caseNumber), history);
});

test("internal history denies applicant and foreign-tenant access and never fabricates legacy revisions", async () => {
  assert.deepEqual(await listApprovalHistoryForActor(consultant, "ITA-001284"), []);
  const item = await create();
  await save(item, "Internal review access canary");
  await assert.rejects(listApprovalHistoryForActor(owner, item.caseNumber), { status: 403 });
  await DB.prepare("INSERT INTO portal_tenants (id, slug, name) VALUES ('history-other', 'history-other', 'Other synthetic tenant')").run();
  await DB.prepare("INSERT INTO portal_users (id, tenant_id, identity_provider, external_subject, email, display_name) VALUES ('history-other-user', 'history-other', 'dev', 'history-other-user', 'other@example.invalid', 'Other test consultant')").run();
  const foreign = { ...consultant, tenantId: "history-other", userId: "history-other-user", subject: "history-other-user" };
  await assert.rejects(listApprovalHistoryForActor(foreign, item.caseNumber), { status: 404 });
  const snapshot = (await listApprovalHistoryForActor(consultant, item.caseNumber))[0];
  await assert.rejects(DB.prepare(`INSERT INTO portal_dgita_review_history
    (id,tenant_id,application_id,application_version_id,application_revision,reviewer_user_id,reviewer_subject,internal_fields_json)
    VALUES (?, 'history-other', ?, ?, ?, 'history-other-user', 'history-other-user', '{}')`)
    .bind(crypto.randomUUID(), item.id, snapshot.applicationVersionId, snapshot.applicationRevision).run(), /must match/u);
});

test("private assessment snapshots stay out of applicant workspace, activity, leader payload and HTML/PDF receipts", async () => {
  const item = await create();
  const canary = "INTERNAL_INFRASTRUCTURE_CANARY";
  await save(item, canary, { phase: "Indsendt" });
  for (const result of [
    await getWorkspaceForActor(owner),
    await listCaseActivity(owner, item.caseNumber),
    await getReceiptView(owner, item.caseNumber, "submission"),
  ]) assert.equal(JSON.stringify(result).includes(canary), false);
  const request = await createLeaderApprovalRequest(consultant, item.caseNumber, "https://portal.example.invalid");
  const leader = await getPublicApprovalRequest(await approvalTokenForRequest(request.id));
  assert.equal(JSON.stringify(leader).includes(canary), false);
  const receiptSource = await getAccessibleReceiptSource(owner, item.caseNumber);
  assert.equal(JSON.stringify(receiptSource).includes(canary), false);
  const pdf = await PDFDocument.load(await renderReceipt(receiptSource, JSON.parse(receiptSource.snapshot_json), "submission"));
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : contents ? [contents] : [];
    for (const stream of streams) {
      const decoded = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      assert.equal(decoded.includes(canary), false);
      assert.equal(decoded.toLowerCase().includes(Buffer.from(canary).toString("hex")), false);
    }
  }
});

test("history or later audit failure rolls back current review, case revision and history together", async () => {
  for (const target of ["history", "audit"]) {
    const item = await create();
    await save(item, "Preserved assessment");
    const before = await persisted(item);
    const table = target === "history" ? "portal_dgita_review_history" : "portal_audit_events";
    await DB.prepare(`CREATE TRIGGER reject_history_fixture BEFORE INSERT ON ${table}
      WHEN NEW.application_id = '${item.id}'
      BEGIN SELECT RAISE(ABORT, 'synthetic history failure'); END`).run();
    try {
      await assert.rejects(save(item, "Must roll back"), /synthetic history failure/u);
      assert.deepEqual(await persisted(item), before);
    } finally { await DB.prepare("DROP TRIGGER reject_history_fixture").run(); }
  }
});

test("a lost compare-and-swap cannot append review/history/audit even if competing revision and time match", async (t) => {
  const item = await create();
  const loaded = await current(item);
  const before = await persisted(item);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00.000Z") });
  const originalBatch = DB.batch;
  let raced = false;
  DB.batch = async function (statements) {
    if (!raced) {
      raced = true;
      await DB.prepare("UPDATE portal_applications SET row_version = row_version + 1, status = 'under_review', phase = 'Under behandling', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), item.id).run();
    }
    return originalBatch.call(this, statements);
  };
  try {
    await assert.rejects(saveApprovalForActor(consultant, item.caseNumber, {
      ...loaded, phase: "Under behandling", infrastructureChanges: "Ja", infrastructureDescription: "Stale reviewer must not win",
    }, loaded.updatedAt ?? null, loaded.revision), { status: 409 });
  } finally { DB.batch = originalBatch; t.mock.timers.reset(); }
  assert.equal(raced, true);
  const after = await persisted(item);
  assert.equal(after.application.row_version, before.application.row_version + 1);
  assert.deepEqual(after.approval, before.approval);
  assert.deepEqual(after.history, before.history);
  assert.deepEqual(after.audit, before.audit);
});
