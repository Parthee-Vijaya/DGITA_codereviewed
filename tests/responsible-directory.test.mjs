import assert from "node:assert/strict";
import test from "node:test";

process.env.DGITA_ENVIRONMENT = "pilot";
process.env.DGITA_ENABLE_DEV_LOGIN = "true";
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.TURSO_AUTH_TOKEN = "synthetic-responsibility-directory";
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-responsibility-directory";
process.env.DGITA_APPROVAL_TOKEN_SECRET = "synthetic-responsibility-secret-only-for-local-tests";

const { preparePortalData, resolveActorUserId, getWorkspaceForActor, saveApprovalForActor, listApprovalHistoryForActor, listCasesForActor } = await import("../features/workspace/server-repository.ts");
const { listResponsiblePeopleForActor } = await import("../features/workspace/server-repository.ts");
const { submitApplication, beginApplicationCorrection } = await import("../features/application/server-repository.ts");
const { DEMO_VIEWERS, EMPTY_D_GITA_APPROVAL } = await import("../features/workspace/model.ts");
const { normalizeDgitaApprovalInput } = await import("../features/workspace/validation.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const { createLeaderApprovalRequest } = await import("../features/approval/server.ts");
const { revokeLeaderApprovalRequest } = await import("../features/approval/revocation.ts");
const DB = await preparePortalData();
const owner = { ...DEMO_VIEWERS.user, provider: "dev" };
owner.userId = await resolveActorUserId(DB, owner);
const consultant = { ...DEMO_VIEWERS.consultant, provider: "dev" };
consultant.userId = await resolveActorUserId(DB, consultant);
const admin = { ...DEMO_VIEWERS.admin, provider: "dev" };
admin.userId = await resolveActorUserId(DB, admin);
const [approver] = await listApproversForActor(owner);
const create = () => submitApplication(owner, crypto.randomUUID(), {
  ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
  manualSystemName: "Synthetic assignment case", catalogQuery: "", approvingLeaderId: approver.id,
  approvingLeader: approver.name, consent: true,
});
const current = async (item) => (await getWorkspaceForActor(consultant)).approvals[item.caseNumber];
async function save(item, fields = {}) {
  const loaded = await current(item);
  return saveApprovalForActor(consultant, item.caseNumber, {
    ...loaded, phase: "Under behandling", ...fields,
  }, loaded.updatedAt ?? null, loaded.revision);
}
async function person({ id = crypto.randomUUID(), tenantId = "kalundborg", name = "Synthetic Consultant", email = `${crypto.randomUUID()}@example.invalid`, role = "dgita_consultant", status = "active", subject = crypto.randomUUID(), provider = "entra" } = {}) {
  await DB.prepare(`INSERT INTO portal_users (id, tenant_id, identity_provider, external_subject, email, display_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, tenantId, provider, subject, email, name, status).run();
  await DB.prepare("INSERT INTO portal_user_roles (id, tenant_id, user_id, role) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), tenantId, id, role).run();
  return { id, tenantId, name, email, subject, provider };
}
async function snapshot(item) {
  return {
    application: await DB.prepare("SELECT assigned_consultant_user_id, row_version FROM portal_applications WHERE id = ?").bind(item.id).first(),
    approval: await current(item),
    history: await listApprovalHistoryForActor(consultant, item.caseNumber),
    audit: (await DB.prepare("SELECT id FROM portal_audit_events WHERE application_id = ? ORDER BY id").bind(item.id).all()).results,
  };
}

const sameNameA = await person({ id: "identity-same-prefix-01", name: "Same Name", email: "shared@example.invalid", subject: "same-subject", provider: "entra" });
const sameNameB = await person({ id: "identity-same-prefix-02", name: "Same Name", email: "shared@example.invalid", subject: "same-subject", provider: "fk" });
await DB.prepare("INSERT INTO portal_tenants (id, slug, name) VALUES ('identity-other', 'identity-other', 'Other synthetic tenant')").run();
const foreign = await person({ tenantId: "identity-other", name: "Foreign Private Name" });
const inactive = await person({ name: "Inactive Person", status: "disabled" });
const ordinary = await person({ name: "Ordinary Applicant", role: "applicant" });
const mandateOnly = await person({ name: "Mandate Only", role: "approver" });

test("internal directory is tenant-scoped, active and distinguishes duplicate names, emails and ID prefixes", async () => {
  const options = await listResponsiblePeopleForActor(consultant);
  assert.deepEqual(options, await listResponsiblePeopleForActor(admin));
  assert.ok(options.some((entry) => entry.id === sameNameA.id));
  for (const excluded of [foreign, inactive, ordinary, mandateOnly]) assert.equal(options.some((entry) => entry.id === excluded.id), false);
  const duplicateNames = options.filter((entry) => entry.name === "Same Name");
  assert.equal(duplicateNames.length, 2);
  assert.equal(new Set(duplicateNames.map((entry) => entry.identifier)).size, 2);
  assert.equal(JSON.stringify(options).includes("same-subject"), false);
  await assert.rejects(listResponsiblePeopleForActor(owner), { status: 403 });
  // Being selectable as a responsible consultant must not grant the separate leader mandate.
  assert.equal((await listApproversForActor(owner)).some((entry) => entry.id === sameNameA.id), false);
});

test("stable IDs choose the correct same-name identity, canonicalize labels and retain private assignment history", async () => {
  const item = await create();
  const saved = await save(item, {
    responsibleUserId: sameNameB.id, responsible: "Forged name",
    hasAdditionalResponsible: "Ja", additionalResponsibleUserIds: [sameNameA.id, sameNameA.id], additionalResponsible: "Forged additional",
    itConsultantUserId: consultant.userId, itConsultant: "Forged IT",
  });
  assert.equal(saved.responsible, sameNameB.name);
  assert.equal(saved.responsibleUserId, sameNameB.id);
  assert.equal(saved.additionalResponsible, sameNameA.name);
  assert.deepEqual(saved.additionalResponsibleUserIds, [sameNameA.id]);
  assert.equal(saved.itConsultant, consultant.displayName);
  assert.deepEqual((await current(item)).additionalResponsibleUserIds, [sameNameA.id]);
  const listed = (await listCasesForActor(consultant)).find((entry) => entry.id === item.caseNumber);
  assert.equal(listed.assignedConsultantUserId, sameNameB.id);
  assert.equal(listed.assignedConsultantSubject, "same-subject");
  assert.equal(listed.assignedConsultantProvider, "fk");
  const beforeHistory = await listApprovalHistoryForActor(consultant, item.caseNumber);
  assert.equal(beforeHistory[0].approval.responsibleUserId, sameNameB.id);
  const userCase = (await listCasesForActor(owner)).find((entry) => entry.id === item.caseNumber);
  assert.equal("assignedConsultantUserId" in userCase, false);
  assert.equal(JSON.stringify(await getWorkspaceForActor(owner)).includes(sameNameB.id), false);
  await save(item, { responsible: "", responsibleUserId: "", hasAdditionalResponsible: "Nej", itConsultant: "", itConsultantUserId: "" });
  assert.equal((await snapshot(item)).application.assigned_consultant_user_id, null);
  assert.deepEqual((await current(item)).additionalResponsibleUserIds, []);
  assert.equal((await current(item)).additionalResponsible, "");
  assert.equal((await current(item)).itConsultantUserId, "");
  assert.deepEqual((await listApprovalHistoryForActor(consultant, item.caseNumber))[0], beforeHistory[0]);
});

test("forged, cross-tenant, inactive and applicant IDs fail without partial assignment or history", async () => {
  const item = await create();
  const before = await snapshot(item);
  for (const id of ["missing-id", foreign.id, inactive.id, ordinary.id, mandateOnly.id]) {
    for (const fields of [
      { responsibleUserId: id, responsible: "Forged" },
      { itConsultantUserId: id, itConsultant: "Forged" },
      { hasAdditionalResponsible: "Ja", additionalResponsibleUserIds: [id], additionalResponsible: "Forged" },
    ]) await assert.rejects(save(item, fields), { status: 422 });
  }
  await assert.rejects(save(item, { responsible: "Same Name", responsibleUserId: "" }), /ikke entydig/u);
  await assert.rejects(save(item, { responsibleUserId: sameNameA.id, hasAdditionalResponsible: "Ja", additionalResponsibleUserIds: [sameNameA.id] }), /primære/u);
  assert.deepEqual(await snapshot(item), before);
});

test("legacy names resolve only when unique and preserve unchanged unresolved historical text without fabricating IDs", async () => {
  const unique = await person({ name: "Unique Legacy Name" });
  const item = await create();
  const saved = await save(item, { responsible: unique.name });
  assert.equal(saved.responsibleUserId, unique.id);
  const legacy = { ...EMPTY_D_GITA_APPROVAL, phase: "Under behandling", responsible: "Same Name", itConsultant: "Former IT Name", hasAdditionalResponsible: "Ja", additionalResponsible: "Legacy free text" };
  delete legacy.responsibleUserId;
  delete legacy.itConsultantUserId;
  delete legacy.additionalResponsibleUserIds;
  await DB.prepare("UPDATE portal_dgita_approvals SET internal_fields_json = ? WHERE application_id = ?").bind(JSON.stringify(legacy), item.id).run();
  const preserved = await save(item, { notes: "Unrelated edit" });
  assert.equal(preserved.responsible, "Same Name");
  assert.equal(preserved.responsibleUserId, "");
  assert.equal(preserved.itConsultant, "Former IT Name");
  assert.equal(preserved.itConsultantUserId, "");
  assert.equal(preserved.additionalResponsible, "Legacy free text");
  assert.deepEqual(preserved.additionalResponsibleUserIds, []);
  assert.equal((await snapshot(item)).application.assigned_consultant_user_id, unique.id);
  await assert.rejects(save(item, { additionalResponsible: "Changed free text" }), /personlisten/u);
  await save(item, { responsibleUserId: sameNameA.id, itConsultantUserId: consultant.userId,
    additionalResponsibleUserIds: [sameNameB.id] });
  assert.equal((await current(item)).responsibleUserId, sameNameA.id);
});

test("deactivated historic IDs may remain on that review but cannot be attached elsewhere", async () => {
  const former = await person({ name: "Former Responsible" });
  const additional = await person({ name: "Former Additional" });
  const item = await create();
  await save(item, { responsibleUserId: former.id, itConsultantUserId: former.id,
    hasAdditionalResponsible: "Ja", additionalResponsibleUserIds: [additional.id] });
  await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id IN (?, ?)").bind(former.id, additional.id).run();
  const kept = await save(item, { notes: "Updated note only", responsible: "Forged historic label", itConsultant: "Forged historic label" });
  assert.equal(kept.responsible, former.name);
  assert.equal(kept.itConsultant, former.name);
  assert.equal(kept.additionalResponsible, additional.name);
  assert.equal((await snapshot(item)).application.assigned_consultant_user_id, former.id);
  const other = await create();
  await assert.rejects(save(other, { responsibleUserId: former.id }), { status: 422 });
  await save(item, { responsibleUserId: sameNameA.id, itConsultantUserId: sameNameB.id,
    additionalResponsibleUserIds: [consultant.userId] });
  await assert.rejects(save(item, { responsibleUserId: former.id }), { status: 422 });
});

test("deactivation between validation and commit cannot assign an inactive identity or append history", async () => {
  const target = await person({ name: "Racing target" });
  const item = await create();
  const before = await snapshot(item);
  const originalBatch = DB.batch;
  let raced = false;
  DB.batch = async function (statements) {
    if (!raced) {
      raced = true;
      await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id = ?").bind(target.id).run();
    }
    return originalBatch.call(this, statements);
  };
  try { await assert.rejects(save(item, { responsibleUserId: target.id }), { status: 409 }); }
  finally { DB.batch = originalBatch; }
  assert.equal(raced, true);
  assert.deepEqual(await snapshot(item), before);
});

test("additional selections are bounded and reject invalid IDs while keeping incomplete historical fields compatible", () => {
  assert.throws(() => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, additionalResponsibleUserIds: Array.from({ length: 21 }, (_, index) => `id-${index}`) }), /højst 20/u);
  for (const invalid of [null, "not-list", [""], [42], ["bad\nidentity"]]) {
    assert.throws(() => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, additionalResponsibleUserIds: invalid }));
  }
  assert.deepEqual(normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, hasAdditionalResponsible: "Ja", additionalResponsibleUserIds: ["person-a", "person-a"] }).additionalResponsibleUserIds, ["person-a"]);
});

test("awaiting-leader case filter is tied to the current version and a non-expired request", async () => {
  const item = await create();
  const read = async () => (await listCasesForActor(consultant)).find((entry) => entry.id === item.caseNumber);
  assert.equal((await read()).awaitingLeader, false);
  const request = await createLeaderApprovalRequest(consultant, item.caseNumber, "https://portal.example.invalid");
  assert.equal((await read()).awaitingLeader, true);
  await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id = ?").bind(approver.id).run();
  assert.equal((await read()).awaitingLeader, false);
  await DB.prepare("UPDATE portal_users SET status = 'active' WHERE id = ?").bind(approver.id).run();
  assert.equal((await read()).awaitingLeader, true);
  await DB.prepare("UPDATE portal_approval_requests SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(request.id).run();
  assert.equal((await read()).awaitingLeader, false);
  assert.equal((await read()).approval, "Ikke startet");
  await DB.prepare("UPDATE portal_approval_requests SET expires_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").bind(request.id).run();
  const other = await create();
  const version = await DB.prepare("SELECT current_version_id FROM portal_applications WHERE id = ?").bind(other.id).first();
  await DB.prepare("UPDATE portal_approval_requests SET application_version_id = ? WHERE id = ?").bind(version.current_version_id, request.id).run();
  assert.equal((await read()).awaitingLeader, false);
});


test("case responsibility survives a new application version and does not silently clear on an unrelated review edit", async () => {
  const target = await person({ name: "Version-stable Responsible" });
  const item = await create();
  await save(item, { responsibleUserId: target.id });
  await DB.prepare("UPDATE portal_applications SET status = 'changes_requested', row_version = row_version + 1 WHERE id = ?").bind(item.id).run();
  const correction = await beginApplicationCorrection(owner, item.caseNumber);
  await submitApplication(owner, item.id, {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: "Synthetic assignment case v2", catalogQuery: "", approvingLeaderId: approver.id,
    approvingLeader: approver.name, consent: true,
  }, correction.rowVersion);
  await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id = ?").bind(target.id).run();
  const loaded = await current(item);
  assert.equal(loaded.responsibleUserId, target.id);
  assert.equal(loaded.responsible, target.name);
  const saved = await save(item, { notes: "Review of the new version" });
  assert.equal(saved.responsibleUserId, target.id);
  assert.equal((await snapshot(item)).application.assigned_consultant_user_id, target.id);
  await save(item, { responsible: "", responsibleUserId: "" });
  assert.equal((await snapshot(item)).application.assigned_consultant_user_id, null);
});


test("the review lock matches the write guard for expired, revoked-mandate and older-version requests until explicit revocation", async () => {
  for (const cause of ["expired", "mandate", "older-version", "approving", "rejecting"]) {
    const item = await create();
    const request = await createLeaderApprovalRequest(consultant, item.caseNumber, "https://portal.example.invalid");
    const read = async () => (await listCasesForActor(consultant)).find((entry) => entry.id === item.caseNumber);
    assert.equal((await read()).awaitingLeader, true);
    assert.equal((await read()).leaderReviewLocked, true);
    assert.equal((await read()).openLeaderApprovalRequestId, request.id);
    const userCase = (await listCasesForActor(owner)).find((entry) => entry.id === item.caseNumber);
    assert.equal("openLeaderApprovalRequestId" in userCase, false);
    assert.equal("leaderReviewLocked" in userCase, false);
    if (cause === "approving" || cause === "rejecting") {
      await DB.prepare("UPDATE portal_approval_requests SET status = ?, expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").bind(cause, request.id).run();
    } else if (cause === "expired") {
      await DB.prepare("UPDATE portal_approval_requests SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").bind(request.id).run();
    } else if (cause === "mandate") {
      await DB.prepare("UPDATE portal_users SET status = 'disabled' WHERE id = ?").bind(approver.id).run();
    } else {
      const versionId = crypto.randomUUID();
      await DB.prepare(`INSERT INTO portal_application_versions
        (id,tenant_id,application_id,version_number,schema_version,snapshot_json,snapshot_sha256,
         submitted_by_user_id,created_at,submitted_at)
        SELECT ?,tenant_id,application_id,2,schema_version,snapshot_json,snapshot_sha256,
          submitted_by_user_id,created_at,submitted_at
        FROM portal_application_versions WHERE application_id = ? AND version_number = 1`)
        .bind(versionId, item.id).run();
      await DB.prepare("UPDATE portal_applications SET current_version_id = ?, current_version_number = 2, row_version = row_version + 1 WHERE id = ?")
        .bind(versionId, item.id).run();
    }
    try {
      const listed = await read();
      assert.equal(listed.awaitingLeader, false, cause);
      assert.equal(listed.leaderReviewLocked, true, cause);
      await assert.rejects(save(item, { notes: "Must remain locked" }), { status: 409 });
      await revokeLeaderApprovalRequest(consultant, item.caseNumber, request.id);
      assert.equal((await read()).leaderReviewLocked, false, cause);
      assert.equal((await read()).openLeaderApprovalRequestId, null, cause);
      await save(item, { notes: "Editable after explicit revocation" });
      assert.equal((await current(item)).notes, "Editable after explicit revocation");
    } finally {
      if (cause === "mandate") await DB.prepare("UPDATE portal_users SET status = 'active' WHERE id = ?").bind(approver.id).run();
    }
  }
});
