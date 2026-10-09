import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import {
  getAllErrors,
  demoApplicationState,
} from "../features/application/engine.ts";
import { approvalTokenForRequest } from "../features/approval/token-service.ts";
import { exerciseDirectUpload } from "./runtime/direct-upload-flow.mjs";

const baseUrl = (process.env.DGITA_E2E_BASE_URL || "http://localhost:3001").replace(/\/$/u, "");
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const providerFixtures = process.env.DGITA_E2E_PROVIDER_FIXTURES === "true";
let fixtureDatabase;

class ApiClient {
  cookie = "";

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.sameOrigin !== false) headers.set("Origin", baseUrl);
    if (this.cookie) headers.set("Cookie", this.cookie);
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body,
      redirect: options.redirect || "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";", 1)[0];
    return response;
  }

  async json(path, options = {}) {
    const response = await this.request(path, options);
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      assert.fail(`${options.method || "GET"} ${path} returnerede ikke JSON: ${text.slice(0, 240)}`);
    }
    return { response, payload };
  }
}

function expectStatus(actual, expected, label, payload) {
  assert.equal(
    actual,
    expected,
    `${label}: forventede HTTP ${expected}, fik ${actual}. ${JSON.stringify(payload)}`,
  );
}

async function login(role) {
  const client = new ApiClient();
  const result = await client.json("/api/auth/dev-login", {
    method: "POST",
    body: { role },
  });
  expectStatus(result.response.status, 200, `login som ${role}`, result.payload);
  assert.equal(result.payload.authenticated, true);
  assert.equal(result.payload.viewer.role, role);
  assert.match(client.cookie, /^dgita_session=/u);
  return client;
}

async function main() {
  const anonymous = new ApiClient();
  const anonymousCases = await anonymous.json("/api/cases");
  expectStatus(anonymousCases.response.status, 401, "beskyttet sagsliste", anonymousCases.payload);
  assert.match(anonymousCases.response.headers.get("cache-control") || "", /no-store/u);

  const missingOrigin = await anonymous.json("/api/auth/dev-login", {
    method: "POST",
    sameOrigin: false,
    body: { role: "user" },
  });
  expectStatus(missingOrigin.response.status, 403, "CSRF uden Origin", missingOrigin.payload);
  assert.equal(missingOrigin.payload.code, "INVALID_ORIGIN");

  const user = await login("user");
  const consultant = await login("consultant");
  const admin = await login("admin");
  if (providerFixtures) {
    assert.match(process.env.TURSO_DATABASE_URL || "", /^file:\/.*\/dgita-ci-next-e2e-[^/]+\/synthetic\.sqlite$/u);
    const { createClient } = await import("@libsql/client");
    fixtureDatabase = createClient({ url: process.env.TURSO_DATABASE_URL });
    const users = await fixtureDatabase.execute("SELECT id FROM portal_users ORDER BY id");
    assert.ok(users.rows.length < 100);
    for (const [index, row] of users.rows.entries()) await fixtureDatabase.execute({
      sql: "UPDATE portal_users SET email = ?, display_name = ? WHERE id = ?",
      args: [`user-${index}@example.invalid`, `Synthetic user ${index}`, row.id],
    });
  }

  const approvers = await user.json("/api/approvers");
  expectStatus(approvers.response.status, 200, "hent syntetisk godkender", approvers.payload);
  const leader = approvers.payload.approvers[0];
  assert.ok(leader, "En anden testperson skal kunne godkende ansøgningen");
  const state = structuredClone(demoApplicationState);
  Object.assign(state, {
    knownSystem: "nej",
    manualCatalogEntry: false,
    manualSystemName: `E2E testsystem ${runId}`,
    catalogQuery: "",
    selectedSystem: null,
    approvingLeaderId: leader.id,
    approvingLeader: leader.name,
    consent: true,
  });
  assert.deepEqual(getAllErrors(state), [], "E2E-ansøgningen skal være gyldig");

  console.log("Authentication and synthetic input prepared.");
  const applicationId = randomUUID();
  let uploadedAttachment;
  let draftRowVersion;
  if (providerFixtures) {
    const draft = await user.json("/api/drafts", { method: "POST", body: { id: applicationId, draft: state, status: "draft" } });
    expectStatus(draft.response.status, 200, "opret kladde før upload", draft.payload);
    draftRowVersion = draft.payload.rowVersion;
    const upload = (client, content) => {
      const body = new FormData(); body.set("draftId", applicationId); body.set("kind", "contract");
      body.set("file", new File([`%PDF-1.4\n${content}\n%%EOF`], "synthetic.pdf", { type: "application/pdf" }));
      return client.json("/api/uploads", { method: "POST", body });
    };
    const forbidden = await upload(consultant, "fixture:clean");
    expectStatus(forbidden.response.status, 403, "anden bruger uploader til kladden", forbidden.payload);
    const infected = await upload(user, "fixture:infected");
    expectStatus(infected.response.status, 422, "scanner afviser inficeret fixture", infected.payload);
    const unavailable = await upload(user, "fixture:unavailable");
    expectStatus(unavailable.response.status, 503, "scannerfejl frigiver intet bilag", unavailable.payload);
    const stored = await fixtureDatabase.execute({ sql: "SELECT COUNT(*) AS total FROM portal_attachments WHERE application_id = ?", args: [applicationId] });
    assert.equal(Number(stored.rows[0].total), 0);
    const clean = await upload(user, "fixture:clean");
    expectStatus(clean.response.status, 201, "sikkerhedskontrolleret upload", clean.payload);
    uploadedAttachment = await exerciseDirectUpload({ user, consultant, anonymous, applicationId,
      database: fixtureDatabase, fixtureOrigin: process.env.DGITA_FIXTURE_ORIGIN });
    state.attachments.contract = [clean.payload.attachment, uploadedAttachment];
    state.hasContract = "ja";
    const scan = await fixtureDatabase.execute({ sql: "SELECT scan_status FROM portal_attachments WHERE id = ?", args: [uploadedAttachment.id] });
    assert.equal(scan.rows[0].scan_status, "clean");
    const anonymousFile = await anonymous.request(`/api/files/${uploadedAttachment.id}`);
    expectStatus(anonymousFile.status, 401, "anonym bilagsadgang", null);
    const delegated = await user.request(`/api/files/${uploadedAttachment.id}`, { redirect: "manual" });
    expectStatus(delegated.status, 307, "privat fil kræver autentificeret delegation", null);
    const delegatedUrl = new URL(delegated.headers.get("location"));
    assert.equal(delegatedUrl.hostname, "fixture.private.blob.vercel-storage.com");
    assert.ok(delegatedUrl.searchParams.has("vercel-blob-signature"));
    const downloaded = await fetch(`${process.env.DGITA_FIXTURE_ORIGIN}${delegatedUrl.pathname}${delegatedUrl.search}`, {
      headers: { "x-dgita-fixture-host": delegatedUrl.hostname }, signal: AbortSignal.timeout(5000),
    });
    expectStatus(downloaded.status, 200, "lokal fixture for delegeret download", null);
    assert.match(await downloaded.text(), /fixture:clean/u);
  }
  console.log("Upload security cases completed.");
  const submitted = await user.json("/api/drafts", {
    method: "POST",
    body: { id: applicationId, draft: state, status: "submitted", ...(draftRowVersion ? { expectedRowVersion: draftRowVersion } : {}) },
  });
  expectStatus(submitted.response.status, 200, "indsend ansøgning", submitted.payload);
  assert.equal(submitted.payload.status, "submitted");
  assert.equal(submitted.payload.versionNumber, 1);
  if (uploadedAttachment) {
    const attachment = await fixtureDatabase.execute({ sql: "SELECT application_version_id, immutable_at FROM portal_attachments WHERE id = ?", args: [uploadedAttachment.id] });
    assert.ok(attachment.rows[0].application_version_id && attachment.rows[0].immutable_at);
    const deletion = await user.json("/api/uploads", { method: "DELETE", body: { id: uploadedAttachment.id, draftId: applicationId } });
    expectStatus(deletion.response.status, 409, "indsendt bilag er uforanderligt", deletion.payload);
  }
  const caseNumber = submitted.payload.caseNumber;
  assert.match(caseNumber, /^ITA-\d{6,8}$/u);

  const detail = await user.json(`/api/cases/${caseNumber}/detail`);
  expectStatus(detail.response.status, 200, "hent sagsdetaljer", detail.payload);
  assert.equal(detail.payload.case.caseNumber, caseNumber);
  assert.equal(detail.payload.case.versionNumber, 1);
  assert.equal(detail.payload.snapshot.manualSystemName, state.manualSystemName);
  assert.equal(JSON.stringify(detail.payload).includes("storage_key"), false);
  assert.equal(JSON.stringify(detail.payload).includes("checksum_sha256"), false);

  const invalidReceipt = await user.json(`/api/cases/${caseNumber}/receipt?kind=unknown`);
  expectStatus(invalidReceipt.response.status, 400, "ukendt kvitteringstype", invalidReceipt.payload);

  const earlyApprovalReceipt = await user.json(`/api/cases/${caseNumber}/receipt?kind=approval`);
  expectStatus(
    earlyApprovalReceipt.response.status,
    409,
    "godkendelseskvittering før beslutning",
    earlyApprovalReceipt.payload,
  );
  const earlyFinalReceipt = await user.json(`/api/cases/${caseNumber}/receipt?kind=final`);
  expectStatus(
    earlyFinalReceipt.response.status,
    409,
    "slutkvittering før afslutning",
    earlyFinalReceipt.payload,
  );

  const firstReceipt = await user.request(`/api/cases/${caseNumber}/receipt`);
  expectStatus(firstReceipt.status, 200, "indsendelseskvittering", null);
  assert.match(firstReceipt.headers.get("content-type") || "", /^application\/pdf\b/u);
  const firstBytes = new Uint8Array(await firstReceipt.arrayBuffer());
  assert.equal(new TextDecoder().decode(firstBytes.slice(0, 4)), "%PDF");
  const firstHash = createHash("sha256").update(firstBytes).digest("hex");
  assert.equal(firstReceipt.headers.get("x-content-sha256"), firstHash);

  const repeatedReceipt = await user.request(`/api/cases/${caseNumber}/receipt`);
  expectStatus(repeatedReceipt.status, 200, "gentaget kvittering", null);
  const repeatedBytes = new Uint8Array(await repeatedReceipt.arrayBuffer());
  assert.equal(createHash("sha256").update(repeatedBytes).digest("hex"), firstHash);
  assert.deepEqual(repeatedBytes, firstBytes, "kvitteringen skal være uforanderlig");

  const sharedText = `Delt E2E-kommentar ${runId}`;
  const sharedComment = await user.json(`/api/cases/${caseNumber}/comments`, {
    method: "POST",
    body: { body: sharedText, visibility: "applicant", category: "question" },
  });
  expectStatus(sharedComment.response.status, 201, "delt brugerkommentar", sharedComment.payload);

  const forbiddenInternal = await user.json(`/api/cases/${caseNumber}/comments`, {
    method: "POST",
    body: { body: "Må ikke gemmes", visibility: "internal", category: "note" },
  });
  expectStatus(forbiddenInternal.response.status, 403, "intern brugerkommentar", forbiddenInternal.payload);

  const internalText = `Intern E2E-note ${runId}`;
  const internalComment = await consultant.json(`/api/cases/${caseNumber}/comments`, {
    method: "POST",
    body: { body: internalText, visibility: "internal", category: "note" },
  });
  expectStatus(internalComment.response.status, 201, "intern konsulentkommentar", internalComment.payload);

  const userComments = await user.json(`/api/cases/${caseNumber}/comments`);
  expectStatus(userComments.response.status, 200, "brugerens kommentarer", userComments.payload);
  assert.equal(userComments.payload.comments.some((item) => item.body === sharedText), true);
  assert.equal(userComments.payload.comments.some((item) => item.body === internalText), false);

  const consultantComments = await consultant.json(`/api/cases/${caseNumber}/comments`);
  expectStatus(consultantComments.response.status, 200, "konsulentens kommentarer", consultantComments.payload);
  assert.equal(consultantComments.payload.comments.some((item) => item.body === internalText), true);

  const forbiddenApproval = await user.json(`/api/cases/${caseNumber}/approval-request`, {
    method: "POST",
    body: {},
  });
  expectStatus(forbiddenApproval.response.status, 403, "bruger sender til leder", forbiddenApproval.payload);

  const approvalRequest = await consultant.json(`/api/cases/${caseNumber}/approval-request`, {
    method: "POST",
    body: {},
  });
  expectStatus(approvalRequest.response.status, 202, "opret ledergodkendelse", approvalRequest.payload);
  assert.equal(approvalRequest.payload.status, "pending");
  if (providerFixtures) {
    const forbiddenCron = await anonymous.json("/api/cron/mail");
    expectStatus(forbiddenCron.response.status, 401, "cron afviser manglende jobidentitet", forbiddenCron.payload);
    const delivered = await anonymous.json("/api/cron/mail", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expectStatus(delivered.response.status, 200, "scheduler sender godkendelseslink før beslutning", delivered.payload);
    assert.equal(delivered.payload.alarm, false);
    const machineAudit = await fixtureDatabase.execute("SELECT actor_subject, actor_user_id FROM portal_audit_events WHERE event_type = 'mail.sent'");
    assert.ok(machineAudit.rows.length > 0);
    assert.ok(machineAudit.rows.every((row) => row.actor_subject === "service:mail-scheduler" && row.actor_user_id === null));
  }
  const approvalToken = await approvalTokenForRequest(approvalRequest.payload.id, baseUrl);

  const publicApproval = await anonymous.json(`/api/approvals/${approvalToken}`);
  expectStatus(publicApproval.response.status, 200, "offentligt beslutningsgrundlag", publicApproval.payload);
  assert.equal(publicApproval.payload.approval.caseNumber, caseNumber);
  assert.equal(publicApproval.payload.approval.status, "pending");

  const approvalPage = await anonymous.request(`/approve/${approvalToken}`);
  expectStatus(approvalPage.status, 200, "godkendelsesside", null);
  assert.match(approvalPage.headers.get("cache-control") || "", /no-store/u);
  assert.match(approvalPage.headers.get("content-security-policy") || "", /frame-ancestors 'none'/u);
  assert.equal(approvalPage.headers.get("referrer-policy"), "no-referrer");

  const rejectedWithoutComment = await anonymous.json(`/api/approvals/${approvalToken}`, {
    method: "POST",
    body: { decision: "rejected", comment: "" },
  });
  expectStatus(
    rejectedWithoutComment.response.status,
    422,
    "afvisning uden begrundelse",
    rejectedWithoutComment.payload,
  );

  const approved = await anonymous.json(`/api/approvals/${approvalToken}`, {
    method: "POST",
    body: { decision: "approved", comment: `Godkendt i E2E ${runId}` },
  });
  expectStatus(approved.response.status, 200, "godkend lederbeslutning", approved.payload);
  assert.equal(approved.payload.approval.decision, "approved");

  const reusedApproval = await anonymous.json(`/api/approvals/${approvalToken}`, {
    method: "POST",
    body: { decision: "approved", comment: "Gentagelse" },
  });
  expectStatus(reusedApproval.response.status, 409, "genbrug af godkendelseslink", reusedApproval.payload);

  const approvalReceipt = await user.request(`/api/cases/${caseNumber}/receipt?kind=approval`);
  expectStatus(approvalReceipt.status, 200, "godkendelseskvittering", null);
  assert.match(approvalReceipt.headers.get("content-disposition") || "", /godkendelse/u);
  assert.equal(new TextDecoder().decode(new Uint8Array(await approvalReceipt.arrayBuffer()).slice(0, 4)), "%PDF");

  const malformedDgita = await consultant.json("/api/workspace", {
    method: "POST",
    body: { action: "approval.save", caseId: caseNumber, approval: {} },
  });
  expectStatus(
    malformedDgita.response.status,
    422,
    "ufuldstændige D-GITA-felter",
    malformedDgita.payload,
  );

  const fieldCommentId = randomUUID();
  const fieldCommentText = `Versionsbundet feltkommentar ${runId}`;
  const fieldComment = await consultant.json("/api/workspace", {
    method: "POST",
    body: {
      action: "field-comment.add",
      comment: {
        id: fieldCommentId,
        caseId: caseNumber,
        fieldId: "purpose",
        fieldLabel: "Manipuleret label",
        body: fieldCommentText,
        visibility: "applicant",
      },
    },
  });
  expectStatus(fieldComment.response.status, 201, "versionsbundet feltkommentar", fieldComment.payload);
  assert.equal(fieldComment.payload.comment.fieldLabel, "Formål og ønsket effekt");

  const reviewer = await consultant.json("/api/auth/session");
  const responsibleDirectory = await consultant.json("/api/workspace/responsible-people");
  expectStatus(responsibleDirectory.response.status, 200, "hent ansvarlige", responsibleDirectory.payload);
  const reviewPerson = responsibleDirectory.payload.people.find((person) => person.identifier === reviewer.payload.viewer.email);
  assert.ok(reviewPerson, "reviewer must be selectable by stable identity");
  const reviewWorkspace = await consultant.json("/api/workspace");
  const loadedReview = reviewWorkspace.payload.workspace.approvals[caseNumber];
  const finalized = await consultant.json("/api/workspace", {
    method: "POST",
    body: {
      action: "approval.save",
      caseId: caseNumber,
      expectedUpdatedAt: loadedReview.updatedAt ?? null,
      expectedRowVersion: loadedReview.revision,
      approval: {
        approved: "Ja",
        date: new Date().toISOString().slice(0, 10),
        legalBasis: "GDPR",
        responsible: reviewPerson.name,
        responsibleUserId: reviewPerson.id,
        hasAdditionalResponsible: "Nej",
        additionalResponsible: "",
        itConsultant: reviewPerson.name,
        itConsultantUserId: reviewPerson.id,
        infrastructureChanges: "Nej",
        notes: `Afsluttet i E2E ${runId}`,
        internalComments: "Versionsbundet intern test",
        phase: "Afsluttet",
      },
    },
  });
  expectStatus(finalized.response.status, 200, "afslut D-GITA-sag", finalized.payload);
  assert.equal(finalized.payload.approval.phase, "Afsluttet");

  const repeatFinalization = await consultant.json("/api/workspace", {
    method: "POST",
    body: {
      action: "approval.save",
      caseId: caseNumber,
      approval: finalized.payload.approval,
      expectedUpdatedAt: finalized.payload.approval.updatedAt,
      expectedRowVersion: finalized.payload.approval.revision,
    },
  });
  expectStatus(
    repeatFinalization.response.status,
    409,
    "afsluttet D-GITA-sag er låst",
    repeatFinalization.payload,
  );

  const closedDetail = await user.json(`/api/cases/${caseNumber}/detail`);
  expectStatus(closedDetail.response.status, 200, "afsluttet sagsdetalje", closedDetail.payload);
  assert.equal(closedDetail.payload.case.status, "closed");
  assert.equal(closedDetail.payload.case.phase, "Afsluttet");

  const finalReceipt = await user.request(`/api/cases/${caseNumber}/receipt?kind=final`);
  expectStatus(finalReceipt.status, 200, "afsluttende kvittering", null);
  assert.match(finalReceipt.headers.get("content-disposition") || "", /afsluttet/u);
  assert.equal(
    new TextDecoder().decode(new Uint8Array(await finalReceipt.arrayBuffer()).slice(0, 4)),
    "%PDF",
  );

  const statusKey = `e2e-status:${runId}`;
  const statusMail = await consultant.json(`/api/cases/${caseNumber}/mail`, {
    method: "POST",
    body: { message: "Sagen er modtaget og behandles nu.", idempotencyKey: statusKey },
  });
  expectStatus(statusMail.response.status, 202, "kø statusmail", statusMail.payload);
  assert.equal(statusMail.payload.duplicate, false);

  const duplicateMail = await consultant.json(`/api/cases/${caseNumber}/mail`, {
    method: "POST",
    body: { message: "Denne tekst må ikke oprette en ny mail.", idempotencyKey: statusKey },
  });
  expectStatus(duplicateMail.response.status, 202, "idempotent statusmail", duplicateMail.payload);
  assert.equal(duplicateMail.payload.duplicate, true);
  assert.equal(duplicateMail.payload.id, statusMail.payload.id);

  const userMail = await user.json(`/api/cases/${caseNumber}/mail`, {
    method: "POST",
    body: { message: "Må ikke sendes", idempotencyKey: `e2e-user-mail:${runId}` },
  });
  expectStatus(userMail.response.status, 403, "bruger sender statusmail", userMail.payload);

  const mailDashboard = await admin.json("/api/mail/status");
  expectStatus(mailDashboard.response.status, 200, "maildashboard", mailDashboard.payload);
  assert.equal(mailDashboard.payload.configured, providerFixtures);
  assert.equal(
    mailDashboard.payload.messages.filter((item) => item.id === statusMail.payload.id).length,
    1,
  );
  assert.equal(
    mailDashboard.payload.messages.some(
      (item) => item.caseNumber === caseNumber && item.templateKey === "application.closed",
    ),
    true,
  );

  const processMail = await admin.json("/api/mail/process", {
    method: "POST",
    body: { limit: 5 },
  });
  if (providerFixtures) {
    expectStatus(processMail.response.status, 200, "mail til lokal Graph-fixture", processMail.payload);
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await admin.json("/api/mail/process", { method: "POST", body: { limit: 10 } });
      expectStatus(result.response.status, 200, "tøm syntetisk mailkø", result.payload);
      if (!result.payload.processed) break;
    }
    const dashboard = await admin.json("/api/mail/status");
    assert.equal(dashboard.payload.messages.find((item) => item.id === statusMail.payload.id)?.status, "sent");
    const forbiddenProcess = await user.json("/api/mail/process", { method: "POST", body: { limit: 1 } });
    expectStatus(forbiddenProcess.response.status, 403, "mailjob kræver autorisation", forbiddenProcess.payload);
  } else {
    expectStatus(processMail.response.status, 503, "mail uden Graph-konfiguration", processMail.payload);
    assert.equal(processMail.payload.code, "MAIL_NOT_CONFIGURED");
  }

  const correctionApplicationId = randomUUID();
  const correctionV1State = structuredClone(state);
  correctionV1State.hasContract = "nej";
  correctionV1State.attachments = Object.fromEntries(Object.keys(state.attachments).map((kind) => [kind, []]));
  correctionV1State.manualSystemName = `E2E rettelsessag ${runId}`;
  correctionV1State.remarks = "Første indsendte version";
  const correctionV1 = await user.json("/api/drafts", {
    method: "POST",
    body: { id: correctionApplicationId, draft: correctionV1State, status: "submitted" },
  });
  expectStatus(correctionV1.response.status, 200, "indsend rettelsessag version 1", correctionV1.payload);
  assert.equal(correctionV1.payload.versionNumber, 1);
  const correctionCaseNumber = correctionV1.payload.caseNumber;
  const correctionV1Receipt = await user.request(`/api/cases/${correctionCaseNumber}/receipt`);
  expectStatus(correctionV1Receipt.status, 200, "rettelsessag version 1-kvittering", null);
  const correctionV1Hash = createHash("sha256").update(new Uint8Array(await correctionV1Receipt.arrayBuffer())).digest("hex");

  const correctionApprovalRequest = await consultant.json(`/api/cases/${correctionCaseNumber}/approval-request`, {
    method: "POST",
    body: {},
  });
  expectStatus(correctionApprovalRequest.response.status, 202, "send rettelsessag til leder", correctionApprovalRequest.payload);
  const correctionToken = await approvalTokenForRequest(correctionApprovalRequest.payload.id, baseUrl);
  const leaderRejection = await anonymous.json(`/api/approvals/${correctionToken}`, {
    method: "POST",
    body: { decision: "rejected", comment: "Tilføj en tydeligere gevinstbeskrivelse." },
  });
  expectStatus(leaderRejection.response.status, 200, "leder afviser version 1", leaderRejection.payload);
  assert.equal(leaderRejection.payload.approval.decision, "rejected");

  const rejectedCases = await user.json("/api/cases");
  expectStatus(rejectedCases.response.status, 200, "hent afvist rettelsessag", rejectedCases.payload);
  const rejectedCase = rejectedCases.payload.cases.find((item) => item.id === correctionCaseNumber);
  assert.equal(rejectedCase?.status, "changes_requested");
  assert.equal(rejectedCase?.approval, "Afvist");

  const correctionDraft = await user.json("/api/drafts", {
    method: "POST",
    body: { action: "begin-correction", caseNumber: correctionCaseNumber },
  });
  expectStatus(correctionDraft.response.status, 200, "åbn afvist sag til rettelser", correctionDraft.payload);
  assert.equal(correctionDraft.payload.draft.mode, "correction");
  assert.equal(correctionDraft.payload.draft.currentVersionNumber, 1);
  assert.equal(correctionDraft.payload.draft.nextVersionNumber, 2);
  const correctionV2State = structuredClone(correctionDraft.payload.draft.state);
  correctionV2State.remarks = "Rettet gevinstbeskrivelse til version 2";
  const savedCorrection = await user.json("/api/drafts", {
    method: "POST",
    body: {
      id: correctionApplicationId,
      draft: correctionV2State,
      status: "draft",
      expectedRowVersion: correctionDraft.payload.draft.rowVersion,
    },
  });
  expectStatus(savedCorrection.response.status, 200, "gem rettelser", savedCorrection.payload);
  assert.equal(savedCorrection.payload.status, "changes_requested");
  const correctionV2 = await user.json("/api/drafts", {
    method: "POST",
    body: {
      id: correctionApplicationId,
      draft: correctionV2State,
      status: "submitted",
      expectedRowVersion: savedCorrection.payload.rowVersion,
    },
  });
  expectStatus(correctionV2.response.status, 200, "genindsend version 2", correctionV2.payload);
  assert.equal(correctionV2.payload.mode, "correction");
  assert.equal(correctionV2.payload.versionNumber, 2);
  const repeatedCorrection = await user.json("/api/drafts", {
    method: "POST",
    body: {
      id: correctionApplicationId,
      draft: correctionV2State,
      status: "submitted",
      expectedRowVersion: correctionV2.payload.rowVersion,
    },
  });
  expectStatus(repeatedCorrection.response.status, 409, "version 2 kan ikke genindsendes igen", repeatedCorrection.payload);
  const correctionV2Detail = await user.json(`/api/cases/${correctionCaseNumber}/detail`);
  expectStatus(correctionV2Detail.response.status, 200, "hent versionslåst rettelse", correctionV2Detail.payload);
  assert.equal(correctionV2Detail.payload.case.versionNumber, 2);
  assert.equal(correctionV2Detail.payload.snapshot.remarks, correctionV2State.remarks);
  const correctionV2Receipt = await user.request(`/api/cases/${correctionCaseNumber}/receipt`);
  expectStatus(correctionV2Receipt.status, 200, "rettelsessag version 2-kvittering", null);
  const correctionV2Hash = createHash("sha256").update(new Uint8Array(await correctionV2Receipt.arrayBuffer())).digest("hex");
  assert.notEqual(correctionV2Hash, correctionV1Hash, "version 2 skal have sin egen uforanderlige kvittering");

  const imageEntryId = `e2e.image.${randomUUID()}`;
  const imageUpload = await admin.json("/api/workspace", {
    method: "POST",
    body: {
      action: "image.upsert",
      entry: {
        id: imageEntryId,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        alt: "E2E-testbillede",
        location: "Automatisk E2E-test",
      },
    },
  });
  expectStatus(imageUpload.response.status, 200, "gem portalbillede i R2", imageUpload.payload);
  assert.match(imageUpload.payload.entry.src, /^\/api\/content-images\/[0-9a-f-]+$/u);
  const storedImage = await user.request(imageUpload.payload.entry.src);
  expectStatus(storedImage.status, 200, "hent tenant-beskyttet portalbillede", null);
  assert.equal(storedImage.headers.get("content-type"), "image/png");
  assert.equal(new Uint8Array(await storedImage.arrayBuffer())[0], 0x89);
  const anonymousImage = await anonymous.json(imageUpload.payload.entry.src);
  expectStatus(anonymousImage.response.status, 401, "portalbillede kræver session", anonymousImage.payload);
  const resetImages = await admin.json("/api/workspace", {
    method: "POST",
    body: { action: "image.reset" },
  });
  expectStatus(resetImages.response.status, 200, "gendan standardbilleder", resetImages.payload);
  const removedImage = await user.json(imageUpload.payload.entry.src);
  expectStatus(removedImage.response.status, 404, "erstattet portalbillede slettes", removedImage.payload);

  const finalCases = await user.json("/api/cases");
  expectStatus(finalCases.response.status, 200, "opdateret sagsliste", finalCases.payload);
  const finalCase = finalCases.payload.cases.find((item) => item.id === caseNumber);
  assert.ok(finalCase, "den indsendte sag skal være synlig for ejeren");
  assert.equal(finalCase.phase, "Afsluttet");
  assert.equal(finalCase.approval, "Godkendt");

  const notifications = await user.json("/api/notifications");
  expectStatus(notifications.response.status, 200, "brugernotifikationer", notifications.payload);
  const eventTypes = new Set(notifications.payload.notifications.map((item) => item.eventType));
  assert.equal(eventTypes.has("application.submitted"), true);
  assert.equal(eventTypes.has("approval.requested"), true);
  assert.equal(eventTypes.has("approval.approved"), true);
  assert.equal(eventTypes.has("application.closed"), true);
  assert.equal(eventTypes.has("field_comment.created"), true);

  const approvalNotification = notifications.payload.notifications.find(
    (item) => item.eventType === "approval.approved" && item.caseNumber === caseNumber,
  );
  assert.ok(approvalNotification, "godkendelsesnotifikationen skal findes");
  assert.match(approvalNotification.id, /^approval-notification:/u);
  const readApprovalNotification = await user.json("/api/notifications", {
    method: "POST",
    body: { id: approvalNotification.id },
  });
  expectStatus(
    readApprovalNotification.response.status,
    200,
    "markér deterministisk notifikation som læst",
    readApprovalNotification.payload,
  );
  assert.equal(
    readApprovalNotification.payload.notifications.find(
      (item) => item.id === approvalNotification.id,
    )?.status,
    "read",
  );

  const activity = await user.json(`/api/cases/${caseNumber}/activity`);
  expectStatus(activity.response.status, 200, "brugerens auditaktivitet", activity.payload);
  assert.equal(activity.payload.events.some((item) => item.eventType === "approval.approved"), true);
  assert.equal(activity.payload.events.some((item) => item.eventType === "application.closed"), true);
  assert.equal(
    activity.payload.events.some(
      (item) => item.eventType === "case_comment.created" && item.summary.includes("intern"),
    ),
    false,
  );

  console.log(JSON.stringify({
    ok: true,
    caseNumber,
    suite: providerFixtures ? "Next full lifecycle and provider contracts" : "Cloudflare full lifecycle",
    receiptSha256: firstHash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fixtureDatabase?.close());
