import assert from "node:assert/strict";
import test from "node:test";
import { filterConsultantCases, caseRowsCsv, EMPTY_CASE_FILTERS } from "../features/workspace/case-filters.ts";

const viewer = { tenantId: "one", subject: "consultant-one", provider: "entra", role: "consultant" };
const base = { tenantId: "one", ownerSubject: "applicant", ownerEmail: "applicant@example.invalid", system: "Portal", phase: "Indsendt", status: "submitted", created: "09-10-2026", changed: "09-10-2026", consultant: "Samme navn", applicant: "Ansøger", municipality: "Testkommune", leader: "Leder", approval: "Ikke startet", awaitingLeader: false, assignedConsultantUserId: null, assignedConsultantSubject: null, assignedConsultantProvider: null };
const cases = [
  { ...base, id: "unassigned" },
  { ...base, id: "mine", assignedConsultantUserId: "user-one", assignedConsultantSubject: viewer.subject, assignedConsultantProvider: "entra", approval: "Afventer", awaitingLeader: true },
  { ...base, id: "same-name", assignedConsultantUserId: "user-two", assignedConsultantSubject: "other", assignedConsultantProvider: "entra" },
  { ...base, id: "same-subject-other-provider", assignedConsultantUserId: "user-three", assignedConsultantSubject: viewer.subject, assignedConsultantProvider: "fk" },
  { ...base, id: "needs-information", status: "changes_requested", phase: "Under behandling" },
  { ...base, id: "rejected", status: "rejected", approval: "Afvist" },
  { ...base, id: "foreign", tenantId: "two", assignedConsultantUserId: "foreign-user", assignedConsultantSubject: viewer.subject, assignedConsultantProvider: "entra", approval: "Afventer", awaitingLeader: true },
];
const select = (filters = {}, actor = viewer) => filterConsultantCases(cases, actor, { ...EMPTY_CASE_FILTERS, ...filters });

test("all work filters remain tenant-scoped and combine with search and phase", () => {
  assert.equal(select().length, 6);
  assert.deepEqual(select({ assignment: "mine", workStatus: "awaiting-leader", query: "  portal  ", phase: "Indsendt" }).map(x => x.id), ["mine"]);
  assert.deepEqual(select({ assignment: "mine", phase: "Afsluttet" }), []);
  assert.deepEqual(select({ assignment: "mine", query: "foreign" }), []);
});

test("assignment uses subject and provider, never display name or missing identity", () => {
  assert.deepEqual(select({ assignment: "mine" }).map(x => x.id), ["mine"]);
  assert.deepEqual(select({ assignment: "mine" }, { ...viewer, provider: undefined }), []);
  assert.deepEqual(select({ assignment: "unassigned", workStatus: "needs-information" }).map(x => x.id), ["needs-information"]);
  assert.deepEqual(filterConsultantCases([{ ...base, id: "legacy", assignedConsultantUserId: undefined }], viewer, { ...EMPTY_CASE_FILTERS, assignment: "unassigned" }), []);
});

test("missing information is an explicit correction state, not a rejected decision", () => {
  assert.deepEqual(filterConsultantCases([{ ...base, id: "expired", approval: "Afventer", awaitingLeader: false }], viewer, { ...EMPTY_CASE_FILTERS, workStatus: "awaiting-leader" }), []);
  assert.deepEqual(select({ workStatus: "needs-information" }).map(x => x.id), ["needs-information"]);
  assert.deepEqual(select({ workStatus: "awaiting-leader" }).map(x => x.id), ["mine"]);
});

test("CSV matches selected rows and neutralizes spreadsheet formulas", () => {
  const rows = select({ assignment: "mine", workStatus: "awaiting-leader" });
  const csv = caseRowsCsv(rows);
  assert.equal(csv.split("\r\n").length, rows.length + 1);
  assert.match(csv, /"mine"/);
  assert.doesNotMatch(csv, /"foreign"|"unassigned"|"same-name"/);
  assert.ok(caseRowsCsv([{ ...rows[0], system: '=HYPERLINK("unsafe")' }]).includes('"\'=HYPERLINK'));
});
