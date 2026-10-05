import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

Object.assign(process.env, {
  DGITA_ENVIRONMENT: "local", DGITA_ENABLE_DEMO_SEED: "true", DGITA_ENABLE_DEV_LOGIN: "true",
  TURSO_DATABASE_URL: ":memory:", TURSO_AUTH_TOKEN: "test-only", BLOB_READ_WRITE_TOKEN: "test-only",
  DGITA_APPROVAL_TOKEN_SECRET: randomBytes(32).toString("hex"),
  DGITA_GRAPH_TENANT_ID: "11111111-2222-3333-4444-555555555555",
  DGITA_GRAPH_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  DGITA_GRAPH_CLIENT_SECRET: "test-only", DGITA_GRAPH_SENDER: "sender@example.invalid",
  DGITA_MAIL_ALLOWED_RECIPIENTS: "leader@example.invalid",
});
const { preparePortalData, resolveActorUserId } = await import("../workspace/server-repository.ts");
const { getPersistenceBindings } = await import("../../db/persistence.ts");
const { submitApplication } = await import("../application/server-repository.ts");
const { demoApplicationState, APPROVING_LEADERS } = await import("../application/engine.ts");
const { DEMO_VIEWERS } = await import("../workspace/model.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest, decideLeaderApproval } = await import("./server.ts");
const { approvalTokenForRequest } = await import("./token-service.ts");
const { processOutbox } = await import("../mail/outbox.ts");
const DB = await preparePortalData();
const actors = {};
for (const role of ["user", "consultant", "admin"]) {
  actors[role] = { ...DEMO_VIEWERS[role], provider: "dev" };
  actors[role].userId = await resolveActorUserId(DB, actors[role]);
}
const leader = APPROVING_LEADERS.find((value) => value.id !== actors.user.userId);
const bindings = await getPersistenceBindings();
const originalFiles = bindings.FILES;
const objects = new Map();
let blobWrites = 0;
bindings.FILES = {
  async put(key, value) { blobWrites++; objects.set(key, new Uint8Array(value)); return { key }; },
  async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => bytes.buffer } : null; },
  async delete(key) { objects.delete(key); },
};
const originalFetch = globalThis.fetch;
let sends = 0;
let tokenCalls = 0;
let beforeTokenResponse;
globalThis.fetch = async (url) => {
  if (String(url).includes("/oauth2/v2.0/token")) {
    tokenCalls++;
    await beforeTokenResponse?.();
    return Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 });
  }
  if (String(url).includes("/sendMail")) { sends++; return new Response(null, { status: 202 }); }
  throw new Error("Unexpected network call blocked");
};
after(() => { globalThis.fetch = originalFetch; bindings.FILES = originalFiles; });

async function restoreMandate() {
  await DB.prepare("UPDATE portal_tenants SET status = 'active' WHERE id = ?").bind(actors.user.tenantId).run();
  await DB.prepare("UPDATE portal_users SET status = 'active', email = 'leader@example.invalid' WHERE id = ?").bind(leader.id).run();
  await DB.prepare("UPDATE portal_users SET email = 'applicant@example.invalid' WHERE id = ?").bind(actors.user.userId).run();
  await DB.prepare("INSERT OR IGNORE INTO portal_user_roles(id,tenant_id,user_id,role) VALUES(?,?,?,'approver')")
    .bind(crypto.randomUUID(),actors.user.tenantId,leader.id).run();
}
async function revoke(kind = "role") {
  if (kind === "role") await DB.prepare("DELETE FROM portal_user_roles WHERE tenant_id=? AND user_id=? AND role='approver'").bind(actors.user.tenantId,leader.id).run();
  if (kind === "user") await DB.prepare("UPDATE portal_users SET status = 'inactive' WHERE id = ?").bind(leader.id).run();
  if (kind === "mailbox") await DB.prepare("UPDATE portal_users SET email = 'changed@example.invalid' WHERE id = ?").bind(leader.id).run();
  if (kind === "ownerMailbox") await DB.prepare("UPDATE portal_users SET email = 'leader@example.invalid' WHERE id = ?").bind(actors.user.userId).run();
  if (kind === "tenant") await DB.prepare("UPDATE portal_tenants SET status = 'suspended' WHERE id = ?").bind(actors.user.tenantId).run();
}
async function issue() {
  await restoreMandate();
  const submitted = await submitApplication(actors.user, crypto.randomUUID(), {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, catalogQuery: "",
    consent: true, manualSystemName: "Isoleret tilbagekaldelsestest", approvingLeaderId: leader.id, approvingLeader: "Testleder",
  });
  const request = await createLeaderApprovalRequest(actors.consultant, submitted.caseNumber, "https://portal.example.invalid");
  await DB.prepare("UPDATE portal_mail_outbox SET status = 'cancelled' WHERE idempotency_key NOT LIKE ?")
    .bind(`approval.requested:${request.id}:%`).run();
  const application = await DB.prepare("SELECT id,status,row_version FROM portal_applications WHERE case_number = ?")
    .bind(submitted.caseNumber).first();
  return { ...request, application, token: await approvalTokenForRequest(request.id) };
}
async function mailRow(requestId) {
  return DB.prepare("SELECT status,text_body,html_body,attachments_json FROM portal_mail_outbox WHERE idempotency_key LIKE ?")
    .bind(`approval.requested:${requestId}:%`).first();
}
async function assertNoDecision(request) {
  assert.deepEqual(await DB.prepare("SELECT id,status,row_version FROM portal_applications WHERE id = ?").bind(request.application.id).first(),request.application);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS count FROM portal_audit_events WHERE id = ?").bind(`approval-decision:${request.id}`).first("count"),0);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS count FROM portal_notifications WHERE id = ?").bind(`approval-notification:${request.id}`).first("count"),0);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS count FROM portal_mail_outbox WHERE id = ?").bind(`approval-mail:${request.id}`).first("count"),0);
  assert.ok(!["approved","rejected"].includes(await DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ?").bind(request.id).first("status")));
}

for (const kind of ["role", "user", "mailbox", "ownerMailbox"]) {
  test(`queued approval mail is scrubbed before PDF/token after ${kind} revocation`, async () => {
    const request = await issue();
    const before = { blobWrites, tokenCalls, sends };
    await revoke(kind);
    await assert.rejects(getPublicApprovalRequest(request.token),{status:404});
    const result = await processOutbox(actors.admin,10);
    assert.equal(result.results.filter((row) => row.status === "cancelled").length,1);
    assert.deepEqual({ blobWrites, tokenCalls, sends },before);
    assert.deepEqual(await mailRow(request.id),{
      status:"cancelled",text_body:"[Mail annulleret]",html_body:"<p>Mail annulleret.</p>",attachments_json:"[]",
    });
  });
}

test("revocation while acquiring Graph credentials prevents transmission of an already prepared PDF", async () => {
  const request = await issue();
  const before = { blobWrites, tokenCalls, sends };
  beforeTokenResponse = () => revoke("tenant");
  try {
    await processOutbox(actors.admin,10);
    assert.ok(blobWrites > before.blobWrites);
    assert.equal(tokenCalls,before.tokenCalls + 1);
    assert.equal(sends,before.sends);
    assert.equal((await mailRow(request.id)).status,"cancelled");
  } finally {
    beforeTokenResponse = undefined;
    await restoreMandate();
  }
});

for (const decision of ["approved", "rejected"]) {
  for (const point of ["before-claim", "before-commit", "resume-before-commit"]) {
    test(`${decision}: revocation ${point} cannot commit any decision or side effect`, async () => {
      const request = await issue();
      if (point === "resume-before-commit") {
        await DB.prepare("UPDATE portal_approval_requests SET status = ?, decided_at = ?, decision_comment = 'Genoptaget test' WHERE id = ?")
          .bind(decision === "approved" ? "approving" : "rejecting",new Date().toISOString(),request.id).run();
      }
      const originalPrepare = DB.prepare.bind(DB);
      const originalBatch = DB.batch.bind(DB);
      let injected = false;
      const inject = async () => { if (!injected) { injected = true; await revoke(); } };
      if (point === "before-claim") {
        DB.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (!sql.includes("SELECT request.id FROM portal_approval_requests request")) return statement;
          const originalBind = statement.bind.bind(statement);
          statement.bind = (...args) => {
            const bound = originalBind(...args);
            const originalFirst = bound.first.bind(bound);
            bound.first = async (...firstArgs) => { const result = await originalFirst(...firstArgs); await inject(); return result; };
            return bound;
          };
          return statement;
        };
      } else {
        DB.batch = async (statements) => { await inject(); return originalBatch(statements); };
      }
      try {
        await assert.rejects(decideLeaderApproval(request.token,{decision,comment:"Syntetisk samtidighedstest"}),{status:409});
        assert.equal(injected,true);
        await assertNoDecision(request);
      } finally {
        DB.prepare = originalPrepare;
        DB.batch = originalBatch;
        await restoreMandate();
      }
    });
  }
}

test("a current mandate still delivers one PDF and commits approval", async () => {
  const request = await issue();
  const before = sends;
  const processed = await processOutbox(actors.admin,10);
  assert.equal(processed.results.filter((row) => row.status === "sent").length,1);
  assert.equal(sends,before + 1);
  assert.equal((await decideLeaderApproval(request.token,{decision:"approved",comment:""})).decision,"approved");
});
