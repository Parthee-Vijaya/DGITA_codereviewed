import assert from "node:assert/strict";
import test from "node:test";
Object.assign(process.env, { DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true",
  TURSO_DATABASE_URL: ":memory:", TURSO_AUTH_TOKEN: "synthetic-revocation", BLOB_READ_WRITE_TOKEN: "synthetic-revocation",
  DGITA_APPROVAL_TOKEN_SECRET: "synthetic-isolated-revocation-secret-123456789" });
const { preparePortalData, resolveActorUserId } = await import("../workspace/server-repository.ts");
const { submitApplication } = await import("../application/server-repository.ts");
const { demoApplicationState } = await import("../application/engine.ts");
const { DEMO_VIEWERS } = await import("../workspace/model.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest, decideLeaderApproval } = await import("./server.ts");
const { approvalTokenForRequest } = await import("./token-service.ts");
const { revokeLeaderApprovalRequest } = await import("./revocation.ts");
const DB = await preparePortalData();
const actors = {};
for (const role of ["user", "consultant", "admin"]) {
  actors[role] = { ...DEMO_VIEWERS[role], provider: "dev" };
  actors[role].userId = await resolveActorUserId(DB, actors[role]);
}
async function issue() {
  const application = await submitApplication(actors.user, crypto.randomUUID(), {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, catalogQuery: "",
    consent: true, manualSystemName: "Syntetisk tilbagekaldelsestest",
  });
  const request = await createLeaderApprovalRequest(actors.consultant, application.caseNumber, "https://portal.example.invalid");
  return { ...request, application, token: await approvalTokenForRequest(request.id) };
}
const revoke = (request) => revokeLeaderApprovalRequest(actors.consultant, request.application.caseNumber, request.id);
const status = (request) => DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ?").bind(request.id).first("status");

test("operators revoke a link atomically, scrub its queue entry and preserve the immutable version", async () => {
  const item = await issue();
  const version = await DB.prepare("SELECT * FROM portal_application_versions WHERE application_id = ?").bind(item.application.id).first();
  assert.deepEqual(await revoke(item), { status: "cancelled", changed: true });
  assert.deepEqual(await revoke(item), { status: "cancelled", changed: false });
  await assert.rejects(getPublicApprovalRequest(item.token), { status: 410 });
  await assert.rejects(decideLeaderApproval(item.token, { decision: "approved", comment: "" }), { status: 409 });
  assert.deepEqual(await DB.prepare("SELECT * FROM portal_application_versions WHERE application_id = ?").bind(item.application.id).first(), version);
  const mail = await DB.prepare("SELECT status,text_body,html_body FROM portal_mail_outbox WHERE idempotency_key LIKE ?")
    .bind(`approval.requested:${item.id}:%`).first();
  assert.equal(mail.status, "cancelled");
  assert.ok(!mail.text_body.includes("__DGITA"));
  assert.ok(!mail.html_body.includes(item.token));
  assert.equal(await DB.prepare("SELECT status FROM portal_applications WHERE id = ?").bind(item.application.id).first("status"), "submitted");
  assert.equal(await DB.prepare("SELECT count(*) AS n FROM portal_audit_events WHERE id = ?").bind(`approval-revoked:${item.id}`).first("n"), 1);
});

test("applicants, foreign tenants and mismatched case numbers cannot revoke a request", async () => {
  const item = await issue();
  await assert.rejects(revokeLeaderApprovalRequest(actors.user, item.application.caseNumber, item.id), { status: 403 });
  await assert.rejects(revokeLeaderApprovalRequest({ ...actors.admin, tenantId: "different-tenant" }, item.application.caseNumber, item.id), { status: 404 });
  await assert.rejects(revokeLeaderApprovalRequest(actors.admin, "ITA-99999999", item.id), { status: 404 });
  assert.equal(await status(item), "pending");
});

for (const decision of ["approved", "rejected"]) {
  test(`revocation before ${decision} commit prevents the decision and all its side effects`, async () => {
    const item = await issue();
    const originalBatch = DB.batch.bind(DB);
    let injected = false;
    DB.batch = async (statements) => {
      if (!injected) { injected = true; await revoke(item); }
      return originalBatch(statements);
    };
    try { await assert.rejects(decideLeaderApproval(item.token, { decision, comment: "Syntetisk beslutning" }), { status: 409 }); }
    finally { DB.batch = originalBatch; }
    assert.equal(injected, true);
    assert.equal(await status(item), "cancelled");
    for (const [table, id] of [["portal_audit_events", `approval-decision:${item.id}`], ["portal_notifications", `approval-notification:${item.id}`], ["portal_mail_outbox", `approval-mail:${item.id}`]]) {
      assert.equal(await DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE id = ?`).bind(id).first("n"), 0);
    }
  });
  test(`revocation after committed ${decision} preserves the decision and audit`, async () => {
    const item = await issue();
    await decideLeaderApproval(item.token, { decision, comment: "Syntetisk beslutning" });
    const audit = await DB.prepare("SELECT * FROM portal_audit_events WHERE id = ?").bind(`approval-decision:${item.id}`).first();
    await assert.rejects(revoke(item), { status: 409 });
    assert.equal(await status(item), decision);
    assert.deepEqual(await DB.prepare("SELECT * FROM portal_audit_events WHERE id = ?").bind(`approval-decision:${item.id}`).first(), audit);
  });
}

test("failed revoke audit leaves the link and application unchanged", async () => {
  const item = await issue();
  await DB.prepare("CREATE TRIGGER test_revocation_failure BEFORE INSERT ON portal_audit_events WHEN NEW.event_type = 'approval.revoked' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run();
  try { await assert.rejects(revoke(item)); }
  finally { await DB.prepare("DROP TRIGGER test_revocation_failure").run(); }
  assert.equal(await status(item), "pending");
  assert.equal(await DB.prepare("SELECT status FROM portal_applications WHERE id = ?").bind(item.application.id).first("status"), "awaiting_leader");
});

test("revoking a processing mail keeps its delivery state but invalidates its link", async () => {
  const item = await issue();
  await DB.prepare("UPDATE portal_mail_outbox SET status = 'processing' WHERE idempotency_key LIKE ?")
    .bind(`approval.requested:${item.id}:%`).run();
  await revoke(item);
  assert.equal(await DB.prepare("SELECT status FROM portal_mail_outbox WHERE idempotency_key LIKE ?").bind(`approval.requested:${item.id}:%`).first("status"), "processing");
  await assert.rejects(getPublicApprovalRequest(item.token), { status: 410 });
});
