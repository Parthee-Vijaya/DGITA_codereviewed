import assert from "node:assert/strict";
import test from "node:test";

import {
  canOpenStep,
  createAttachmentDraft,
  demoApplicationState,
  getFinanceTotal,
  getStepErrors,
  getStepWarnings,
  initialApplicationState,
  isFieldVisible,
  parseDanishAmount,
  pruneHiddenAnswers,
  validateUpload,
} from "../features/application/engine.ts";
import { normalizeSearchText, searchCatalog } from "../features/catalog/search.ts";

function state(overrides = {}) {
  return structuredClone({ ...demoApplicationState, ...overrides });
}

test("en ny produktionsansøgning indeholder ingen demooplysninger", () => {
  assert.equal(initialApplicationState.catalogQuery, "");
  assert.equal(initialApplicationState.contactPerson, "");
  assert.equal(initialApplicationState.department, "");
  assert.equal(initialApplicationState.purpose, "");
  assert.equal(initialApplicationState.approvingLeaderId, "");
});

test("underspørgsmål følger de dokumenterede Power Pages-regler", () => {
  const base = state();
  assert.equal(isFieldVisible("replacementSystem", base), false);
  assert.equal(isFieldVisible("marketResearchSystems", base), true);
  assert.equal(isFieldVisible("relatedSystem", base), false);
  assert.equal(isFieldVisible("crossDepartments", base), true);
  assert.equal(isFieldVisible("architecture", base), false);

  const conditional = state({
    replacesExisting: "ja",
    acquisitionType: "tilkøb",
    hasArchitecture: "ja",
  });
  assert.equal(isFieldVisible("replacementSystem", conditional), true);
  assert.equal(isFieldVisible("relatedSystem", conditional), true);
  assert.equal(isFieldVisible("architecture", conditional), true);
  assert.equal(isFieldVisible("manualSystem", state({ knownSystem: "nej" })), true);
});

test("skjulte undersvar valideres ikke og fjernes fra snapshot", () => {
  const draft = state({
    marketResearch: "nej",
    marketResearchSystems: "Dette svar skal ikke med",
    crossCutting: "nej",
    crossDepartments: ["Skjult afdeling"],
  });
  assert.equal(getStepErrors(draft, 2).some((error) => error.field === "marketResearchSystems"), false);

  const snapshot = pruneHiddenAnswers(draft);
  assert.equal("marketResearchSystems" in snapshot, false);
  assert.equal("crossDepartments" in snapshot, false);

  const manualSnapshot = pruneHiddenAnswers(
    state({
      knownSystem: "nej",
      manualCatalogEntry: false,
      manualSystemName: "Nyt lokalt system",
      supplier: "Testleverandør",
    }),
  );
  assert.equal(manualSnapshot.manualSystemName, "Nyt lokalt system");
  assert.equal(manualSnapshot.supplier, "Testleverandør");

  const noPersonalData = pruneHiddenAnswers(
    state({ personalData: "nej", hasDpa: "ja", dataClassification: "Skjult" }),
  );
  assert.equal("hasDpa" in noPersonalData, false);
  assert.equal("dataClassification" in noPersonalData, false);

  const completedRisk = pruneHiddenAnswers(
    state({ hasRiskAssessment: "ja", needsRiskHelp: "ja" }),
  );
  assert.equal("needsRiskHelp" in completedRisk, false);
});

test("tværgående funktionalitet kræver både beskrivelse og enheder", () => {
  const errors = getStepErrors(
    state({ crossCutting: "ja", crossFunctionality: "", crossDepartments: [] }),
    3,
  );
  assert.equal(errors.some((error) => error.field === "crossFunctionality"), true);
  assert.equal(errors.some((error) => error.field === "crossDepartments"), true);
});

test("ansvarlig organisation kræves kun, når kommunen ikke allerede bruger systemet", () => {
  assert.equal(
    getStepErrors(
      state({ municipalityAlreadyUsesSystem: "nej", responsibleOrganization: "" }),
      1,
    ).some((error) => error.field === "responsibleOrganization"),
    true,
  );
  assert.equal(
    getStepErrors(
      state({ municipalityAlreadyUsesSystem: "ja", responsibleOrganization: "" }),
      1,
    ).some((error) => error.field === "responsibleOrganization"),
    false,
  );
});

test("dansk beløbsformat beregnes korrekt", () => {
  assert.equal(parseDanishAmount("1.250,50"), 1250.5);
  assert.equal(parseDanishAmount("100"), 100);
  assert.equal(parseDanishAmount("12,345"), null);
  assert.equal(
    getFinanceTotal(
      state({ oneTimeCost: "1.000,00", yearlyCost: "250,50", otherCost: "49,50" }),
    ),
    1300,
  );
});

test("slutdato før startdato giver en trinfejl", () => {
  const errors = getStepErrors(
    state({ startDate: "2026-10-10", endDate: "2026-10-09" }),
    6,
  );
  assert.match(errors.find((error) => error.field === "endDate")?.message ?? "", /før startdatoen/);
});

test("arkitektur nej er et opmærksomhedspunkt, mens ja kræver bilag", () => {
  const noDrawing = state({ hasArchitecture: "nej" });
  assert.equal(getStepErrors(noDrawing, 7).length, 0);
  assert.equal(getStepWarnings(noDrawing, 7).length, 1);

  const promisedDrawing = state({ hasArchitecture: "ja" });
  assert.equal(getStepErrors(promisedDrawing, 7)[0]?.field, "architecture");
});

test("filpolitik håndhæver type og 25 MB", () => {
  assert.equal(
    validateUpload("risk-assessment", {
      name: "risiko.xlsx",
      size: 250_000,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    null,
  );
  assert.match(
    validateUpload("risk-assessment", { name: "risiko.exe", size: 250_000, type: "" }) ?? "",
    /PDF, DOCX eller XLSX/,
  );
  assert.match(
    validateUpload("architecture", {
      name: "tegning.pdf",
      size: 26 * 1024 * 1024,
      type: "application/pdf",
    }) ?? "",
    /25 MB/,
  );
  assert.match(
    validateUpload("architecture", {
      name: "tegning.pdf",
      size: 10_000,
      type: "application/x-msdownload",
    }) ?? "",
    /indholdstype/,
  );
  assert.equal(
    createAttachmentDraft("contract", {
      name: "kontrakt.pdf",
      size: 10_000,
      type: "application/pdf",
    }).status,
    "selected",
  );

  const failedAgreement = state({
    hasDpa: "ja",
    attachments: {
      ...demoApplicationState.attachments,
      "data-processing-agreement": [
        createAttachmentDraft("data-processing-agreement", {
          name: "virus.exe",
          size: 10_000,
          type: "application/octet-stream",
        }),
      ],
    },
  });
  assert.equal(
    getStepErrors(failedAgreement, 5).some(
      (error) => error.field === "data-processing-agreement",
    ),
    true,
  );

  const selectedAgreement = state({
    hasDpa: "ja",
    attachments: {
      ...demoApplicationState.attachments,
      "data-processing-agreement": [
        createAttachmentDraft("data-processing-agreement", {
          name: "aftale.pdf",
          size: 10_000,
          type: "application/pdf",
        }),
      ],
    },
  });
  assert.equal(
    getStepErrors(selectedAgreement, 5).some(
      (error) => error.field === "data-processing-agreement",
    ),
    true,
  );
});

test("fremtidige trin låses af den første ugyldige sektion", () => {
  const draft = state({ selectedSystem: null, manualCatalogEntry: false });
  assert.equal(canOpenStep(draft, 1), false);
  const completeFirstStep = state({
    selectedSystem: {
      id: "kitos-1",
      name: "Testsystem",
      supplier: "Leverandør",
      rightsHolder: "Leverandør",
      source: "kitos",
      usedInKalundborg: false,
    },
  });
  assert.equal(canOpenStep(completeFirstStep, 1), true);
});

test("godkendende chef kræver et strukturelt gyldigt id før serverens mandatkontrol", () => {
  assert.equal(getStepErrors(state(), 8).length, 0);
  const manipulated = state({
    approvingLeaderId: "ugyldigt/id",
    approvingLeader: "Peter Bjerre Ahlgren",
  });
  assert.equal(
    getStepErrors(manipulated, 8).some((error) => error.field === "approvingLeader"),
    true,
  );
});

test("katalogsøgning er accent- og case-insensitiv og prioriterer Kalundborg", () => {
  const catalog = [
    {
      id: "1",
      name: "Økonomisystem",
      supplier: "Leverandør A",
      rightsHolder: "Leverandør A",
      source: "kitos",
      usedInKalundborg: false,
      matchConfidence: "unmatched",
    },
    {
      id: "2",
      name: "Økonomisystem Plus",
      supplier: "Leverandør B",
      rightsHolder: "Leverandør B",
      source: "both",
      usedInKalundborg: true,
      matchConfidence: "exact-name",
    },
  ];
  assert.equal(normalizeSearchText("ØKONOMI-system"), "okonomi system");
  const result = searchCatalog(catalog, "økonomi");
  assert.equal(result.length, 2);
  assert.equal(result[0].usedInKalundborg, true);
});
