import assert from "node:assert/strict";
import test from "node:test";
process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-receipt-test";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-receipt-test";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "synthetic-receipt-test-token-material-only";
const { preparePortalData, resolveActorUserId, getWorkspaceForActor, saveApprovalForActor } = await import("../features/workspace/server-repository.ts");
const { submitApplication } = await import("../features/application/server-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { getReceiptView } = await import("../features/receipt/view-server.ts");
const { receiptKind, receiptVersion } = await import("../features/receipt/request.ts");
const DB = await preparePortalData();
const owner = { ...DEMO_VIEWERS.user, provider: "dev" };
owner.userId = await resolveActorUserId(DB, owner);
const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
consultant.userId = await resolveActorUserId(DB, consultant);
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const [approver] = await listApproversForActor(owner);
assert.ok(approver);
const state = () => ({ ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualSystemName: "Syntetisk kvitteringsprøve", catalogQuery: "", approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true });

async function create() { return submitApplication(owner, crypto.randomUUID(), state()); }

test("HTML receipt requires the same owner/tenant boundary and an exact version belonging to the case", async () => {
  const first = await create(); const second = await create();
  const before = (await DB.prepare("SELECT COUNT(*) AS n FROM portal_receipts").first()).n;
  const view = await getReceiptView(owner, first.caseNumber, "submission");
  assert.equal(view.versionNumber, 1); assert.equal(view.caseNumber, first.caseNumber);
  const secondView = await getReceiptView(owner, second.caseNumber, "submission");
  await assert.rejects(getReceiptView(owner, first.caseNumber, "submission", secondView.applicationVersionId), { status: 404 });
  await assert.rejects(getReceiptView({ ...owner, tenantId: "other-tenant", role: "admin" }, first.caseNumber, "submission"), { status: 404 });
  await assert.rejects(getReceiptView({ ...consultant, role: "user" }, first.caseNumber, "submission"), { status: 404 });
  assert.equal((await getReceiptView(consultant, first.caseNumber, "submission")).applicationVersionId, view.applicationVersionId);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM portal_receipts").first()).n, before, "HTML reads never create or replace PDF receipts");
  assert.deepEqual(await getReceiptView(owner, first.caseNumber, "submission", view.applicationVersionId), view);
});

test("HTML refuses changed snapshot bytes and never exposes unfinished decisions", async () => {
  const submitted = await create();
  const view = await getReceiptView(owner, submitted.caseNumber, "submission");
  await assert.rejects(getReceiptView(owner, submitted.caseNumber, "approval"), { status: 409 });
  await assert.rejects(getReceiptView(owner, submitted.caseNumber, "final"), { status: 409 });
  await assert.rejects(DB.prepare("UPDATE portal_application_versions SET snapshot_json = ? WHERE id = ?")
    .bind(JSON.stringify({ ...state(), remarks: "Tampered" }), view.applicationVersionId).run(), /immutable/);
  const badVersion = crypto.randomUUID();
  await DB.prepare(`INSERT INTO portal_application_versions
    (id,tenant_id,application_id,version_number,schema_version,snapshot_json,snapshot_sha256,submitted_by_user_id,created_at,submitted_at)
    SELECT ?,tenant_id,application_id,version_number+1,schema_version,?,snapshot_sha256,submitted_by_user_id,created_at,submitted_at
    FROM portal_application_versions WHERE id = ?`)
    .bind(badVersion, JSON.stringify({ ...state(), remarks: "Corrupted imported snapshot" }), view.applicationVersionId).run();
  await assert.rejects(getReceiptView(owner, submitted.caseNumber, "submission", badVersion), { status: 409 });
  assert.deepEqual(await getReceiptView(owner, submitted.caseNumber, "submission", view.applicationVersionId), view);
});

test("receipt request parsing rejects invalid kinds/version paths", () => {
  assert.equal(receiptKind(null), "submission");
  assert.equal(receiptVersion(undefined), undefined);
  assert.equal(receiptVersion("version:123_abc"), "version:123_abc");
  for (const value of ["", "../../case", "id\nheader", "x".repeat(201)]) assert.throws(() => receiptVersion(value), { status: 400 });
  assert.throws(() => receiptKind("unknown"), { status: 400 });
});


test("a bound historical HTML version remains unchanged after a newer submission becomes current", async () => {
  const submitted = await create();
  const first = await getReceiptView(owner, submitted.caseNumber, "submission");
  const nextId = crypto.randomUUID();
  const snapshot = JSON.stringify({ ...state(), remarks: "Newer immutable version" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  const sha = Buffer.from(digest).toString("hex");
  await DB.prepare(`INSERT INTO portal_application_versions
    (id,tenant_id,application_id,version_number,schema_version,snapshot_json,snapshot_sha256,submitted_by_user_id,created_at,submitted_at)
    SELECT ?,tenant_id,application_id,version_number+1,schema_version,?,?,submitted_by_user_id,created_at,submitted_at
    FROM portal_application_versions WHERE id = ?`).bind(nextId,snapshot,sha,first.applicationVersionId).run();
  await DB.prepare("UPDATE portal_applications SET current_version_id = ?, current_version_number = 2 WHERE id = ?").bind(nextId,submitted.id).run();
  assert.deepEqual(await getReceiptView(owner, submitted.caseNumber, "submission", first.applicationVersionId), first);
  const latest = await getReceiptView(owner, submitted.caseNumber, "submission");
  assert.equal(latest.versionNumber, 2);
  assert.equal(latest.snapshotSha256, sha);
  assert.equal(latest.sections.at(-1).rows.find(([label]) => label === "Bemærkninger")[1], "Newer immutable version");
});


test("a closed decision and its reviewer snapshot remain frozen after profile changes", async () => {
  const submitted = await create();
  const { createLeaderApprovalRequest, decideLeaderApproval } = await import("../features/approval/server.ts");
  const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
  const request = await createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid");
  await decideLeaderApproval(await approvalTokenForRequest(request.id), { decision: "approved", comment: "" });
  const workspace = await getWorkspaceForActor(consultant);
  const approval = workspace.approvals[submitted.caseNumber];
  await saveApprovalForActor(consultant, submitted.caseNumber, {
    ...approval, phase: "Afsluttet", approved: "Ja", notes: "Committed final decision",
    internalComments: "Internal material never belongs in the receipt",
  }, approval.updatedAt ?? null, approval.revision);
  const first = await getReceiptView(owner, submitted.caseNumber, "final");
  assert.equal(first.decision.name, consultant.displayName);
  assert.equal(first.decision.comment, "Committed final decision");
  assert.ok(!JSON.stringify(first).includes("Internal material"));

  const closed = (await getWorkspaceForActor(consultant)).approvals[submitted.caseNumber];
  await assert.rejects(saveApprovalForActor(consultant, submitted.caseNumber,
    { ...closed, notes: "Attempted post-decision replacement" }, closed.updatedAt, closed.revision), { status: 409 });
  await resolveActorUserId(DB, { ...consultant, displayName: "Changed profile name after decision" });
  assert.deepEqual(await getReceiptView(owner, submitted.caseNumber, "final", first.applicationVersionId), first);
});


test("HTML refuses ambiguous legacy decisions for the same version without choosing or rewriting history", async () => {
  const { createLeaderApprovalRequest, decideLeaderApproval } = await import("../features/approval/server.ts");
  const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
  const submitted = await create();
  const request = await createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid");
  await decideLeaderApproval(await approvalTokenForRequest(request.id), { decision: "approved", comment: "Original decision" });
  const original = await getReceiptView(owner, submitted.caseNumber, "approval");
  assert.equal(original.decision.comment, "Original decision");
  // Model an imported legacy history with two committed decisions. Normal workflow
  // admission is a separate rule; this projection must refuse ambiguous old data.
  await DB.prepare(`INSERT INTO portal_approval_requests
    (id,tenant_id,application_id,application_version_id,approver_email,approver_name,token_hash,status,
     decision_comment,created_by_user_id,created_at,expires_at,decided_at)
    SELECT ?,tenant_id,application_id,application_version_id,approver_email,approver_name,?,'rejected',
      'Conflicting legacy decision',created_by_user_id,created_at,expires_at,decided_at
    FROM portal_approval_requests WHERE id = ?`)
    .bind(crypto.randomUUID(), crypto.randomUUID(), request.id).run();
  await assert.rejects(getReceiptView(owner, submitted.caseNumber, "approval", original.applicationVersionId), { status: 409 });
  assert.equal((await getReceiptView(owner, submitted.caseNumber, "submission", original.applicationVersionId)).snapshotSha256, original.snapshotSha256);
  assert.equal(await DB.prepare("SELECT decision_comment FROM portal_approval_requests WHERE id = ?").bind(request.id).first("decision_comment"), "Original decision");
});
