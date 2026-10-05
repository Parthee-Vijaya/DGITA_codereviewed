import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "local";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.DGITA_ENABLE_DEMO_SEED = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "approval-policy-test-only";
process.env.BLOB_READ_WRITE_TOKEN = "approval-policy-test-only";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "approval-policy-test-only-secret-123456789";

const { preparePortalData, resolveActorUserId } = await import("../workspace/server-repository.ts");
const { submitApplication } = await import("../application/server-repository.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest, decideLeaderApproval, authorizePublicApprovalAttachment } = await import("./server.ts");
const { approvalTokenForRequest } = await import("./token-service.ts");
const { DEMO_VIEWERS } = await import("../workspace/model.ts");
const { demoApplicationState, APPROVING_LEADERS } = await import("../application/engine.ts");
const DB = await preparePortalData();
const user = { ...DEMO_VIEWERS.user, provider: "dev" };
user.userId = await resolveActorUserId(DB, user);
const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
consultant.userId = await resolveActorUserId(DB, consultant);
const leader = APPROVING_LEADERS.find((candidate) => candidate.id !== user.userId);

async function submittedFor(approver) {
  return submitApplication(user, crypto.randomUUID(), {
    ...structuredClone(demoApplicationState),
    knownSystem: "nej", selectedSystem: null, catalogQuery: "", consent: true,
    manualSystemName: "Isoleret godkendertest",
    approvingLeaderId: approver.id, approvingLeader: approver.name,
  });
}

async function grantApprover(userId, tenantId = user.tenantId) {
  await DB.prepare(`INSERT OR IGNORE INTO portal_user_roles (id,tenant_id,user_id,role)
    VALUES (?, ?, ?, 'approver')`).bind(crypto.randomUUID(),tenantId,userId).run();
}

test("an applicant cannot receive a self-approval link even with the approver role", async () => {
  await grantApprover(user.userId);
  const before = await DB.prepare("SELECT COUNT(*) AS count FROM portal_approval_requests WHERE approver_email = ?").bind(user.email).first("count");
  await assert.rejects(submittedFor({ id: user.userId, name: user.displayName }), { status: 422 });
  assert.equal(await DB.prepare("SELECT COUNT(*) AS count FROM portal_approval_requests WHERE approver_email = ?").bind(user.email).first("count"), before);
});

test("a normal portal role and a different-tenant approver role cannot authorize leader approval", async () => {
  const submitted = await submittedFor(leader);
  await DB.prepare("DELETE FROM portal_user_roles WHERE tenant_id = ? AND user_id = ? AND role = 'approver'").bind(user.tenantId,leader.id).run();
  await DB.prepare("INSERT INTO portal_tenants (id,slug,name) VALUES ('other-audit-tenant','other-audit-tenant','Anden testkommune')").run();
  await grantApprover(leader.id,"other-audit-tenant");
  await assert.rejects(createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid"), { code: "APPROVER_NOT_FOUND" });
  await grantApprover(leader.id);
  const result = await createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid");
  assert.equal(result.status,"pending");
});

test("an alternate account with the applicant's mailbox cannot approve", async () => {
  const submitted = await submittedFor(leader);
  await grantApprover(leader.id);
  const email = await DB.prepare("SELECT email FROM portal_users WHERE id = ?").bind(leader.id).first("email");
  try {
    await DB.prepare("UPDATE portal_users SET email = ? WHERE id = ?").bind(user.email.toUpperCase(),leader.id).run();
    await assert.rejects(createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid"), { code: "SELF_APPROVAL_FORBIDDEN" });
  } finally {
    await DB.prepare("UPDATE portal_users SET email = ? WHERE id = ?").bind(email,leader.id).run();
  }
});

test("issued bearer links stop working after tenant or approver access is revoked", async () => {
  for (const revoke of ["tenant", "user", "role", "mailbox"]) {
    await grantApprover(leader.id);
    const submitted = await submittedFor(leader);
    const request = await createLeaderApprovalRequest(consultant,submitted.caseNumber,"https://portal.example.invalid");
    const token = await approvalTokenForRequest(request.id);
    assert.equal((await getPublicApprovalRequest(token)).status,"pending");
    const originalEmail = await DB.prepare("SELECT email FROM portal_users WHERE id = ?").bind(leader.id).first("email");
    if (revoke === "tenant") await DB.prepare("UPDATE portal_tenants SET status = 'suspended' WHERE id = ?").bind(user.tenantId).run();
    if (revoke === "user") await DB.prepare("UPDATE portal_users SET status = 'inactive' WHERE id = ?").bind(leader.id).run();
    if (revoke === "role") await DB.prepare("DELETE FROM portal_user_roles WHERE tenant_id = ? AND user_id = ? AND role = 'approver'").bind(user.tenantId,leader.id).run();
    if (revoke === "mailbox") await DB.prepare("UPDATE portal_users SET email = 'new@example.invalid' WHERE id = ?").bind(leader.id).run();
    try {
      await assert.rejects(getPublicApprovalRequest(token),{status:404});
      await assert.rejects(decideLeaderApproval(token,{decision:"approved",comment:""}),{status:404});
      await assert.rejects(authorizePublicApprovalAttachment(token,crypto.randomUUID()),{status:404});
      assert.equal(await DB.prepare("SELECT status FROM portal_approval_requests WHERE id = ?").bind(request.id).first("status"),"pending");
    } finally {
      await DB.prepare("UPDATE portal_tenants SET status = 'active' WHERE id = ?").bind(user.tenantId).run();
      await DB.prepare("UPDATE portal_users SET status = 'active', email = ? WHERE id = ?").bind(originalEmail,leader.id).run();
      await grantApprover(leader.id);
    }
  }
});
