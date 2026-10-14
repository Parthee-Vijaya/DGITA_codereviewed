import assert from "node:assert/strict";
import test from "node:test";

import { isSafeNotificationId } from "../features/notifications/id.ts";
import { EMPTY_D_GITA_APPROVAL } from "../features/workspace/model.ts";
import {
  WorkspaceInputError,
  lifecycleForDgitaApproval,
  normalizeDgitaApprovalInput,
  normalizeFieldCommentInput,
} from "../features/workspace/validation.ts";

test("notifikationer accepterer UUID og afgrænsede deterministiske id'er", () => {
  assert.equal(
    isSafeNotificationId("019c7a82-0181-7457-9c4a-8ebf2ce0121f"),
    true,
  );
  assert.equal(
    isSafeNotificationId(
      "approval-notification:019c7a82-0181-7457-9c4a-8ebf2ce0121f",
    ),
    true,
  );
  assert.equal(isSafeNotificationId("approval-notification:../secret"), false);
  assert.equal(isSafeNotificationId("approval notification:token"), false);
  assert.equal(isSafeNotificationId("x".repeat(201)), false);
});

test("D-GITA-input valideres og ukendte felter kopieres ikke", () => {
  const normalized = normalizeDgitaApprovalInput({
    ...EMPTY_D_GITA_APPROVAL,
    phase: "Under behandling",
    unknownSecret: "må ikke gemmes",
  });
  assert.equal(normalized.phase, "Under behandling");
  assert.equal("unknownSecret" in normalized, false);

  assert.throws(
    () => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, phase: "Slettet" }),
    WorkspaceInputError,
  );
  assert.throws(
    () => normalizeDgitaApprovalInput({ ...EMPTY_D_GITA_APPROVAL, date: "2026-02-31" }),
    WorkspaceInputError,
  );
});

test("afslutning kræver beslutning og versionslåser teknisk status", () => {
  const now = "2026-08-27T09:00:00.000Z";
  assert.throws(
    () => lifecycleForDgitaApproval(
      { ...EMPTY_D_GITA_APPROVAL, phase: "Afsluttet" },
      { status: "under_review", currentVersionId: "version-1" },
      now,
    ),
    /Vælg Ja eller Nej/u,
  );
  assert.deepEqual(
    lifecycleForDgitaApproval(
      { ...EMPTY_D_GITA_APPROVAL, approved: "Ja", phase: "Afsluttet" },
      { status: "under_review", currentVersionId: "version-1" },
      now,
    ),
    { status: "closed", phase: "Afsluttet", closedAt: now },
  );
  assert.throws(
    () => lifecycleForDgitaApproval(
      { ...EMPTY_D_GITA_APPROVAL, approved: "Ja", phase: "Afsluttet" },
      { status: "under_review", currentVersionId: null },
      now,
    ),
    /versionslåst/u,
  );
});

test("infrastructure changes require an explanation and clear hidden answers", () => {
  for (const description of [undefined, "", "   "]) {
    assert.throws(() => normalizeDgitaApprovalInput({
      ...EMPTY_D_GITA_APPROVAL, infrastructureChanges: "Ja", infrastructureDescription: description,
    }), /Beskriv ændringerne/u);
  }
  const explained = normalizeDgitaApprovalInput({
    ...EMPTY_D_GITA_APPROVAL, infrastructureChanges: "Ja", infrastructureDescription: "  New test integration  ",
  });
  assert.equal(explained.infrastructureDescription, "New test integration");
  for (const choice of ["", "Nej"]) {
    assert.equal(normalizeDgitaApprovalInput({ ...explained, infrastructureChanges: choice }).infrastructureDescription, "");
  }
  assert.throws(() => normalizeDgitaApprovalInput({
    ...explained, infrastructureDescription: "x".repeat(8001),
  }), WorkspaceInputError);
  const legacy = { ...EMPTY_D_GITA_APPROVAL };
  delete legacy.infrastructureDescription;
  assert.equal(normalizeDgitaApprovalInput(legacy).infrastructureDescription, "");
});

test("feltkommentar bruger serverens feltlabel og afviser ugyldige værdier", () => {
  const normalized = normalizeFieldCommentInput({
    id: "019c7a82-0181-7457-9c4a-8ebf2ce0121f",
    caseId: "ita-001284",
    fieldId: "purpose",
    fieldLabel: "Manipuleret label",
    body: "  Afklar effekten  ",
    visibility: "applicant",
  });
  assert.equal(normalized.caseId, "ITA-001284");
  assert.equal(normalized.fieldLabel, "Formål og ønsket effekt");
  assert.equal(normalized.body, "Afklar effekten");

  assert.throws(
    () => normalizeFieldCommentInput({ ...normalized, visibility: "public" }),
    WorkspaceInputError,
  );
  assert.throws(
    () => normalizeFieldCommentInput({ ...normalized, fieldId: "password" }),
    WorkspaceInputError,
  );
});
