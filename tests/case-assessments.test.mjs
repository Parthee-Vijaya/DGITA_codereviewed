import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  DGITA_ENVIRONMENT: "pilot", DGITA_ENABLE_DEV_LOGIN: "true", TURSO_DATABASE_URL: ":memory:",
  TURSO_AUTH_TOKEN: "synthetic-assessments", BLOB_READ_WRITE_TOKEN: "synthetic-assessments",
  DGITA_APPROVAL_TOKEN_SECRET: "synthetic-assessment-token-material-only",
});
const { EMPTY_PRIVACY_ASSESSMENT, EMPTY_PROCUREMENT_ASSESSMENT, CASE_ASSESSMENT_LIMITS,
  normalizePrivacyAssessment, normalizeProcurementAssessment,
  getPrivacyAssessmentValidationError, getProcurementAssessmentValidationError } = await import("../features/workspace/case-assessments.ts");
const { EMPTY_D_GITA_APPROVAL, DEMO_VIEWERS, normalizeDgitaApproval } = await import("../features/workspace/model.ts");
const { normalizeDgitaApprovalInput } = await import("../features/workspace/validation.ts");
const { preparePortalData, resolveActorUserId, getWorkspaceForActor, listCasesForActor, saveApprovalForActor,
  listApprovalHistoryForActor, requestApplicationInformationForActor, rejectApplicationForActor } = await import("../features/workspace/server-repository.ts");
const { submitApplication, beginApplicationCorrection } = await import("../features/application/server-repository.ts");
const { demoApplicationState } = await import("../features/application/engine.ts");
const { listApproversForActor } = await import("../features/application/approver-repository.ts");
const { listCaseActivity } = await import("../features/cases/dialog-repository.ts");
const { getReceiptView } = await import("../features/receipt/view-server.ts");
const { getAccessibleReceiptSource, renderReceipt } = await import("../features/receipt/server.ts");
const { createLeaderApprovalRequest, getPublicApprovalRequest, decideLeaderApproval } = await import("../features/approval/server.ts");
const { approvalTokenForRequest } = await import("../features/approval/token-service.ts");
const { PDFDocument, PDFArray, decodePDFRawStream } = await import("pdf-lib");
const DB = await preparePortalData();
const actors = {};
for (const role of ["user", "consultant", "admin"]) {
  const actor = { ...DEMO_VIEWERS[role], provider: "dev" };
  actor.userId = await resolveActorUserId(DB, actor);
  actors[role] = actor;
}
const [approver] = await listApproversForActor(actors.user);
const state = () => ({ ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
  manualSystemName: "Syntetisk vurderingssag", catalogQuery: "", approvingLeaderId: approver.id,
  approvingLeader: approver.name, consent: true, aiUsage: "nej" });
const create = () => submitApplication(actors.user, crypto.randomUUID(), state());
const current = async (item) => (await getWorkspaceForActor(actors.consultant)).approvals[item.caseNumber];
const caseRecord = async (item) => (await listCasesForActor(actors.consultant)).find((entry) => entry.id === item.caseNumber);
const privacy = (extra = {}) => ({ ...EMPTY_PRIVACY_ASSESSMENT, status: "documented",
  processingBasis: "Syntetisk konkret behandlingsgrundlag med afgrænset formål.", controllerRelation: "processor",
  relationReason: "Leverandøren behandler alene efter dokumenteret instruks.", dpaNeed: "required",
  dpaReason: "Den beskrevne instruksbaserede behandling kræver en aftale.", dpiaScreening: "not-required",
  dpiaReason: "Syntetisk screening med dokumenteret afgrænsning af risikoen.", reference: "SAG-PRIVACY-123", ...extra });
const procurement = (extra = {}) => ({ ...EMPTY_PROCUREMENT_ASSESSMENT, status: "documented",
  procedure: "Syntetisk manuelt valgt anskaffelsesprocedure.", rationale: "Konkret dokumenteret vurdering af kontraktens forhold.",
  reference: "SAG-PROCUREMENT-123", ruleCheckedOn: "2026-10-09", ...extra });
async function save(item, extra = {}, actor = actors.consultant) {
  const loaded = await current(item);
  return saveApprovalForActor(actor, item.caseNumber, { ...loaded, phase: "Under behandling", ...extra }, loaded.updatedAt ?? null, loaded.revision);
}
async function snapshot(item) {
  const result = {};
  for (const table of ["portal_applications", "portal_dgita_approvals", "portal_dgita_review_history", "portal_audit_events", "portal_notifications", "portal_mail_outbox"]) {
    result[table] = (await DB.prepare(`SELECT * FROM ${table} WHERE ${table === "portal_applications" ? "id" : "application_id"} = ? ORDER BY id`).bind(item.id).all()).results;
  }
  return result;
}

test("legacy absence stays absent and tolerant read projections whitelist malformed and unknown fields", () => {
  for (const result of [normalizeDgitaApproval(EMPTY_D_GITA_APPROVAL), normalizeDgitaApprovalInput(EMPTY_D_GITA_APPROVAL)]) {
    assert.equal(Object.hasOwn(result, "privacyAssessment"), false);
    assert.equal(Object.hasOwn(result, "procurementAssessment"), false);
  }
  assert.equal(getPrivacyAssessmentValidationError(undefined), null);
  assert.equal(getProcurementAssessmentValidationError(undefined), null);
  assert.deepEqual(normalizePrivacyAssessment(null), EMPTY_PRIVACY_ASSESSMENT);
  assert.deepEqual(normalizeProcurementAssessment(["unknown"]), EMPTY_PROCUREMENT_ASSESSMENT);
  assert.deepEqual(normalizePrivacyAssessment({ status: "approved", processingBasis: 5, controllerRelation: "unknown", externalSecret: "DROP", recordedBy: [], recordedAt: "tomorrow" }), EMPTY_PRIVACY_ASSESSMENT);
  assert.equal(normalizeProcurementAssessment({ procedure: " ".repeat(1100), extraneous: true }).procedure, "");
});

test("strict writes reject malformed objects, enums, all bounds, controls and non-calendar dates", () => {
  for (const field of ["privacyAssessment", "procurementAssessment"]) {
    for (const value of [null, [], true, "documented", { status: "approved" }]) {
      assert.throws(() => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, [field]: value }), { status: 422 });
    }
  }
  for (const field of ["controllerRelation", "dpaNeed", "dpiaScreening"]) {
    for (const value of [null, "unknown", [], 3]) assert.throws(() => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, privacyAssessment: privacy({ [field]: value }) }), { status: 422 });
  }
  for (const [key, factory, fields] of [
    ["privacyAssessment", privacy, ["processingBasis", "relationReason", "dpaReason", "dpiaReason", "reference"]],
    ["procurementAssessment", procurement, ["procedure", "rationale", "reference", "ruleCheckedOn"]],
  ]) {
    for (const field of fields) {
      for (const value of ["x".repeat(CASE_ASSESSMENT_LIMITS[field] + 1), null, 42, "bad\u0000value"]) {
        assert.throws(() => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, [key]: factory({ [field]: value }) }), { status: 422 });
      }
    }
  }
  for (const ruleCheckedOn of ["2026-02-29", "2026-02-31", "09-10-2026", "2026-13-01"]) {
    assert.ok(getProcurementAssessmentValidationError(procurement({ status: "in-progress", ruleCheckedOn })));
  }
  assert.equal(getProcurementAssessmentValidationError(procurement({ ruleCheckedOn: "2028-02-29" })), null);
});

test("documented requires concrete complete choices; in-progress can retain unresolved work without inferring a framework or procedure", () => {
  assert.equal(getPrivacyAssessmentValidationError(privacy()), null);
  assert.equal(getPrivacyAssessmentValidationError(privacy({ controllerRelation: "not-applicable", processingBasis: "Der behandles ingen personoplysninger i den afgrænsede relation.", relationReason: "Vurderingen omfatter alene anonymiserede optællinger." })), null);
  assert.equal(getProcurementAssessmentValidationError(procurement()), null);
  for (const field of ["processingBasis", "relationReason", "dpaReason", "dpiaReason", "reference"]) {
    assert.ok(getPrivacyAssessmentValidationError(privacy({ [field]: " " })));
  }
  for (const field of ["controllerRelation", "dpaNeed", "dpiaScreening"]) {
    for (const value of ["", "needs-clarification"]) assert.ok(getPrivacyAssessmentValidationError(privacy({ [field]: value })));
  }
  for (const field of ["procedure", "rationale", "reference", "ruleCheckedOn"]) assert.ok(getProcurementAssessmentValidationError(procurement({ [field]: " " })));
  const saved = normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, legalBasis: "GDPR",
    privacyAssessment: { ...EMPTY_PRIVACY_ASSESSMENT, status: "in-progress", dpaNeed: "needs-clarification" },
    procurementAssessment: { ...EMPTY_PROCUREMENT_ASSESSMENT, status: "in-progress" } });
  assert.equal(saved.privacyAssessment.processingBasis, "");
  assert.equal(saved.privacyAssessment.controllerRelation, "");
  assert.equal(saved.procurementAssessment.procedure, "");
  assert.equal(saved.procurementAssessment.ruleCheckedOn, "");
  assert.equal(saved.legalBasis, "GDPR");
});

test("server stamps only substantive per-assessment edits, ignores forged metadata and preserves fields for legacy clients", async () => {
  const item = await create();
  const blank = await save(item, { privacyAssessment: { ...EMPTY_PRIVACY_ASSESSMENT, recordedBy: "FORGED", recordedAt: "2020-01-01T00:00:00.000Z" } });
  assert.deepEqual(blank.privacyAssessment, EMPTY_PRIVACY_ASSESSMENT);
  const forged = { recordedBy: "FORGED", recordedByName: "FORGED NAME", recordedAt: "2020-01-01T00:00:00.000Z", applicationVersionId: "FORGED VERSION" };
  const first = await save(item, { privacyAssessment: privacy(forged), procurementAssessment: procurement(forged) });
  const version = (await caseRecord(item)).currentVersionId;
  for (const assessment of [first.privacyAssessment, first.procurementAssessment]) {
    assert.equal(assessment.recordedBy, actors.consultant.userId);
    assert.equal(assessment.recordedByName, actors.consultant.displayName);
    assert.equal(assessment.recordedAt, first.updatedAt);
    assert.equal(assessment.applicationVersionId, version);
  }
  const second = await save(item, { internalComments: "Only unrelated fields changed",
    privacyAssessment: { ...first.privacyAssessment, ...forged }, procurementAssessment: { ...first.procurementAssessment, ...forged } }, actors.admin);
  assert.deepEqual(second.privacyAssessment, first.privacyAssessment);
  assert.deepEqual(second.procurementAssessment, first.procurementAssessment);
  const third = await save(item, { privacyAssessment: privacy({ processingBasis: "Et andet konkret dokumenteret grundlag." }) }, actors.admin);
  assert.equal(third.privacyAssessment.recordedBy, actors.admin.userId);
  assert.equal(third.privacyAssessment.recordedAt, third.updatedAt);
  assert.deepEqual(third.procurementAssessment, first.procurementAssessment);
  const legacyInput = { ...third, notes: "Legacy client without the optional assessment fields" };
  delete legacyInput.privacyAssessment;
  delete legacyInput.procurementAssessment;
  const legacy = await saveApprovalForActor(actors.consultant, item.caseNumber, legacyInput, third.updatedAt, third.revision);
  assert.deepEqual(legacy.privacyAssessment, third.privacyAssessment);
  assert.deepEqual(legacy.procurementAssessment, third.procurementAssessment);
});

test("role, tenant and stale revisions cannot change assessment data or append history", async () => {
  const item = await create();
  const old = await current(item);
  await save(item, { privacyAssessment: privacy(), procurementAssessment: procurement() });
  const before = await snapshot(item);
  await assert.rejects(save(item, { privacyAssessment: privacy() }, actors.user), { status: 403 });
  await assert.rejects(save(item, { privacyAssessment: privacy() }, { ...actors.consultant, tenantId: "foreign" }), { status: 404 });
  await assert.rejects(saveApprovalForActor(actors.consultant, item.caseNumber,
    { ...old, phase: "Under behandling", privacyAssessment: privacy() }, old.updatedAt ?? null, old.revision), { status: 409 });
  await assert.rejects(save(item, { privacyAssessment: privacy({ dpaNeed: "needs-clarification" }) }), { status: 422 });
  assert.deepEqual(await snapshot(item), before);
});

test("current version does not inherit documentation, while immutable history keeps the prior complete assessment", async () => {
  const item = await create();
  const first = await save(item, { privacyAssessment: privacy(), procurementAssessment: procurement() });
  const priorHistory = await listApprovalHistoryForActor(actors.consultant, item.caseNumber);
  const record = await caseRecord(item);
  await requestApplicationInformationForActor(actors.consultant, item.caseNumber, { reason: "Beskriv det ændrede system nærmere.", dueDate: "2099-12-01", expectedVersionId: record.currentVersionId, expectedRowVersion: record.revision });
  const correction = await beginApplicationCorrection(actors.user, item.caseNumber);
  await submitApplication(actors.user, item.id, state(), correction.rowVersion);
  const latest = await current(item);
  assert.equal(latest.privacyAssessment, undefined);
  assert.equal(latest.procurementAssessment, undefined);
  const before = await snapshot(item);
  await assert.rejects(saveApprovalForActor(actors.consultant, item.caseNumber, first, first.updatedAt, first.revision), { status: 409 });
  assert.deepEqual(await snapshot(item), before);
  const second = await save(item, { privacyAssessment: { ...EMPTY_PRIVACY_ASSESSMENT, status: "in-progress", processingBasis: "Ny vurdering for den nye version." } });
  assert.notEqual(second.privacyAssessment.applicationVersionId, first.privacyAssessment.applicationVersionId);
  assert.equal(second.privacyAssessment.status, "in-progress");
  assert.equal(second.procurementAssessment, undefined);
  const history = await listApprovalHistoryForActor(actors.admin, item.caseNumber);
  assert.deepEqual(history.slice(0, 1), priorHistory);
  assert.deepEqual(history[0].approval.privacyAssessment, first.privacyAssessment);
  assert.deepEqual(history[0].approval.procurementAssessment, first.procurementAssessment);
});

test("CAS rechecks a version change at commit and never persists assessment or history from a lost writer", async () => {
  const item = await create();
  const before = await snapshot(item);
  const original = DB.batch;
  let injected = false;
  DB.batch = async function (statements) {
    if (!injected) {
      injected = true;
      // NULL is a valid legacy/draft boundary and simulates version drift after service reads.
      await DB.prepare("UPDATE portal_applications SET current_version_id = NULL, row_version = row_version + 1 WHERE id = ?").bind(item.id).run();
    }
    return original.call(this, statements);
  };
  try { await assert.rejects(save(item, { privacyAssessment: privacy(), procurementAssessment: procurement() }), { status: 409 }); }
  finally { DB.batch = original; }
  assert.equal(injected, true);
  const after = await snapshot(item);
  for (const table of ["portal_dgita_approvals", "portal_dgita_review_history", "portal_audit_events", "portal_notifications", "portal_mail_outbox"]) assert.deepEqual(after[table], before[table]);
});

test("open leader review still locks assessments and audit failure rolls back assessment metadata and history", async () => {
  const locked = await create();
  await createLeaderApprovalRequest(actors.consultant, locked.caseNumber, "https://portal.example.invalid");
  const lockedBefore = await snapshot(locked);
  await assert.rejects(save(locked, { privacyAssessment: privacy() }), { status: 409 });
  assert.deepEqual(await snapshot(locked), lockedBefore);
  const item = await create();
  await save(item, { procurementAssessment: procurement() });
  const before = await snapshot(item);
  await DB.prepare(`CREATE TRIGGER fail_assessment_audit BEFORE INSERT ON portal_audit_events WHEN NEW.application_id = '${item.id}' BEGIN SELECT RAISE(ABORT, 'synthetic assessment audit failure'); END`).run();
  try { await assert.rejects(save(item, { privacyAssessment: privacy() }), /synthetic assessment audit failure/u); }
  finally { await DB.prepare("DROP TRIGGER fail_assessment_audit").run(); }
  assert.deepEqual(await snapshot(item), before);
});

test("documented is not final approval and assessments add no new decision gates; final rejection preserves their metadata", async () => {
  const item = await create();
  const documented = await save(item, { privacyAssessment: privacy(), procurementAssessment: procurement() });
  assert.equal(documented.approved, "");
  assert.equal((await caseRecord(item)).status, "under_review");
  const record = await caseRecord(item);
  const input = { reason: "Offentlig begrundelse for det endelige afslag.", expectedVersionId: record.currentVersionId, expectedRowVersion: record.revision, expectedUpdatedAt: documented.updatedAt };
  const rejected = await rejectApplicationForActor(actors.admin, item.caseNumber, input);
  assert.deepEqual(rejected.privacyAssessment, documented.privacyAssessment);
  assert.deepEqual(rejected.procurementAssessment, documented.procurementAssessment);
  assert.deepEqual(await rejectApplicationForActor(actors.admin, item.caseNumber, input), rejected);
  const positive = await create();
  await save(positive, { privacyAssessment: { ...EMPTY_PRIVACY_ASSESSMENT, status: "in-progress", dpaNeed: "needs-clarification" } });
  const request = await createLeaderApprovalRequest(actors.consultant, positive.caseNumber, "https://portal.example.invalid");
  await decideLeaderApproval(await approvalTokenForRequest(request.id), { decision: "approved", comment: "Syntetisk lederbeslutning" });
  await save(positive, { approved: "Ja", phase: "Afsluttet" });
  assert.equal((await caseRecord(positive)).status, "closed");
});

test("internal assessments never appear in applicant workspace, activity, leader request, receipt source or rendered PDF", async () => {
  const item = await create();
  const canaries = ["PRIVATE_DATA_ASSESSMENT_CANARY", "PRIVATE_PROCUREMENT_ASSESSMENT_CANARY"];
  await save(item, { privacyAssessment: privacy({ reference: canaries[0] }), procurementAssessment: procurement({ reference: canaries[1] }) });
  const request = await createLeaderApprovalRequest(actors.consultant, item.caseNumber, "https://portal.example.invalid");
  const source = await getAccessibleReceiptSource(actors.user, item.caseNumber);
  for (const result of [await getWorkspaceForActor(actors.user), await listCaseActivity(actors.user, item.caseNumber),
    await getReceiptView(actors.user, item.caseNumber, "submission"), await getPublicApprovalRequest(await approvalTokenForRequest(request.id)), source]) {
    for (const canary of canaries) assert.equal(JSON.stringify(result).includes(canary), false);
  }
  await assert.rejects(listApprovalHistoryForActor(actors.user, item.caseNumber), { status: 403 });
  const pdf = await PDFDocument.load(await renderReceipt(source, JSON.parse(source.snapshot_json), "submission"));
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : contents ? [contents] : [];
    for (const stream of streams) {
      const decoded = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      for (const canary of canaries) {
        assert.equal(decoded.includes(canary), false);
        assert.equal(decoded.toLowerCase().includes(Buffer.from(canary).toString("hex")), false);
      }
    }
  }
});
