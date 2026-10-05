import assert from "node:assert/strict";
import test from "node:test";

// Isolated database, never the developer's or public test environment.
process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "enterprise-test-only";
process.env.BLOB_READ_WRITE_TOKEN = "enterprise-test-only";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "enterprise-regression-secret-only-123456789";

const { preparePortalData, getWorkspaceForActor, saveApprovalForActor, resolveActorUserId } = await import("../features/workspace/server-repository.ts");
const { saveApplicationDraft, getLatestApplicationDraft, submitApplication } = await import("../features/application/server-repository.ts");
const { DEMO_VIEWERS } = await import("../features/workspace/model.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest } = await import("../features/approval/server.ts");
const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
const DB = await preparePortalData();
const user = { ...DEMO_VIEWERS.user, provider: "dev" };
user.userId = await resolveActorUserId(DB, user);
const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
consultant.userId = await resolveActorUserId(DB, consultant);
const admin = { ...DEMO_VIEWERS.admin, provider: "dev" };
admin.userId = await resolveActorUserId(DB, admin);
for (const actor of [user, consultant, admin]) {
  await DB.prepare("INSERT OR IGNORE INTO portal_user_roles (id, tenant_id, user_id, role) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actor.tenantId, actor.userId, actor.role === "consultant" ? "dgita_consultant" : actor.role).run();
}

function state(name) {
  return { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualSystemName: name, catalogQuery: "", consent: true };
}

test("each owned draft can be resumed without exposing another owner's draft", async () => {
  const first = await saveApplicationDraft(user, crypto.randomUUID(), state("Første kladde"));
  const second = await saveApplicationDraft(user, crypto.randomUUID(), state("Anden kladde"));
  const loaded = await getLatestApplicationDraft(user, first.caseNumber);
  assert.equal(loaded.state.manualSystemName, "Første kladde");
  assert.equal((await getLatestApplicationDraft(user, second.caseNumber)).state.manualSystemName, "Anden kladde");
  await assert.rejects(getLatestApplicationDraft(admin, first.caseNumber), { status: 404 });
});

test("consultants cannot lock unsubmitted drafts; owner can still save", async () => {
  const draft = await saveApplicationDraft(user, crypto.randomUUID(), state("Kladde til kontrol"));
  const review = (await getWorkspaceForActor(consultant)).approvals[draft.caseNumber];
  await assert.rejects(saveApprovalForActor(consultant, draft.caseNumber, { ...review, phase: "Under behandling" }, review.updatedAt ?? null, review.revision), { status: 409 });
  assert.equal((await saveApplicationDraft(user, draft.id, state("Stadig redigerbar"), draft.rowVersion)).rowVersion, 2);
});

test("review revisions reject stale editors and real assignment updates the case", async () => {
  const submitted = await submitApplication(user, crypto.randomUUID(), state("Versionssikker behandling"));
  const loaded = (await getWorkspaceForActor(consultant)).approvals[submitted.caseNumber];
  const input = { ...loaded, phase: "Under behandling", responsible: consultant.displayName, notes: "Første behandler" };
  const saved = await saveApprovalForActor(consultant, submitted.caseNumber, input, loaded.updatedAt ?? null, loaded.revision);
  await assert.rejects(saveApprovalForActor(admin, submitted.caseNumber, { ...input, notes: "Gammel fane" }, loaded.updatedAt ?? null, loaded.revision), { status: 409 });
  const fresh = (await getWorkspaceForActor(consultant)).approvals[submitted.caseNumber];
  assert.equal(fresh.notes, "Første behandler");
  assert.equal(fresh.revision, saved.revision);
  const application = await DB.prepare("SELECT assigned_consultant_user_id FROM portal_applications WHERE id = ?").bind(submitted.id).first();
  assert.equal(application.assigned_consultant_user_id, consultant.userId);
});

test("seeded legacy reviews expose the authoritative database revision", async () => {
  const workspace = await getWorkspaceForActor(consultant);
  const review = workspace.approvals["ITA-001284"];
  assert.ok(review);
  assert.ok(review.updatedAt);
  assert.ok(Number.isInteger(review.revision));
});

test("expired and cancelled bearer links never disclose an application snapshot", async () => {
  for (const status of ["pending", "cancelled", "approved", "rejected"]) {
    const submitted = await submitApplication(user, crypto.randomUUID(), state(`Linkkontrol ${status}`));
    const request = await createLeaderApprovalRequest(consultant, submitted.caseNumber, "https://portal.example.invalid");
    const token = await approvalTokenForRequest(request.id);
    assert.equal((await getPublicApprovalRequest(token)).caseNumber, submitted.caseNumber);
    await DB.prepare("UPDATE portal_approval_requests SET status = ?, expires_at = ? WHERE id = ?")
      .bind(status, status === "cancelled" ? "2099-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z", request.id).run();
    await assert.rejects(getPublicApprovalRequest(token), { status: 410 });
  }
});
