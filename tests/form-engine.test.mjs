import assert from "node:assert/strict";
import test from "node:test";

import {
  canOpenStep,
  createAttachmentDraft,
  demoApplicationState,
  getFinanceTotal,
  getUploadPolicy,
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
    /PDF, DOC, DOCX, XLS, XLSX/,
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


test("påkrævet tekst og lister kan ikke opfyldes med mellemrum", () => {
  for (const [field, step] of [["manualSystemName", 0], ["contactPerson", 0], ["dataOwner", 1], ["purpose", 3], ["benefits", 4], ["implementationResources", 6]]) {
    const errors = getStepErrors(state({ knownSystem: "nej", [field]: " \t\n " }), step);
    assert.ok(errors.some((error) => error.field === (field === "manualSystemName" ? "manualSystem" : field)), field);
  }
  assert.ok(getStepErrors(state({ crossDepartments: [" ", "\t"] }), 3).some((error) => error.field === "crossDepartments"));
  assert.ok(getStepErrors(state({ hasBudget: "ja", budgetAmount: " " }), 4).some((error) => error.field === "budgetAmount"));
});

test("valg kontrolleres mod UI-valgene, og skjulte svar blokerer ikke", () => {
  for (const [field, step] of [["acquisitionMethod", 2], ["dataClassification", 5], ["employeeAccess", 5], ["implementationUsers", 6]]) {
    assert.ok(getStepErrors(state({ personalData: "ja", [field]: "Ukendt valg" }), step).some((error) => error.field === field), field);
  }
  assert.equal(getStepErrors(state({ personalData: "nej", dataClassification: "Gammelt svar" }), 5).some((error) => error.field === "dataClassification"), false);
  assert.equal(getStepErrors(state({ employeeAccess: "" }), 5).some((error) => error.field === "employeeAccess"), false);
});

test("datoer skal være reelle kalenderdatoer, også i direkte API-input", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "01-10-2026", "2026-1-01", "0000-01-01", "2026-10-01T12:00:00Z"]) {
    assert.ok(getStepErrors(state({ startDate: value }), 6).some((error) => error.field === "startDate"), value);
  }
  assert.equal(getStepErrors(state({ startDate: "2028-02-29", endDate: "2028-02-29" }), 6).length, 0);
});

test("CVR og links valideres kun, når det relevante felt er udfyldt og synligt", () => {
  for (const field of ["supplierCvr", "rightsHolderCvr"]) {
    assert.ok(getStepErrors(state({ knownSystem: "nej", [field]: "1234567X" }), 0).some((error) => error.field === field));
    for (const value of ["", " ", "12345678", "12 34 56 78"]) {
      assert.equal(getStepErrors(state({ knownSystem: "nej", [field]: value }), 0).some((error) => error.field === field), false);
    }
    assert.equal(getStepErrors(state({ knownSystem: "ja", [field]: "historisk værdi" }), 0).some((error) => error.field === field), false);
  }
  for (const [field, step] of [["descriptionUrl", 0], ["esdhContractUrl", 1], ["esdhDpaUrl", 1]]) {
    for (const value of ["javascript:alert(1)", "ikke et link", "ftp://example.invalid", "https://user:password@example.invalid"]) {
      assert.ok(getStepErrors(state({ knownSystem: "nej", [field]: value }), step).some((error) => error.field === field), `${field}: ${value}`);
    }
    for (const value of ["", " https://esdh.example.invalid/sag/123 ", "http://intranet/sag/123"]) {
      assert.equal(getStepErrors(state({ knownSystem: "nej", [field]: value }), step).some((error) => error.field === field), false);
    }
  }
});

test("gratis anskaffelse og nul kroner er fortsat gyldigt", () => {
  const free = state({ acquisitionMethod: "Gratis", hasBudget: "ja", budgetAmount: "0", oneTimeCost: "0,00", yearlyCost: "0", otherCost: "0" });
  assert.equal(getStepErrors(free, 2).length, 0);
  assert.equal(getStepErrors(free, 4).length, 0);
  assert.equal(getFinanceTotal(free), 0);
  assert.match(getStepErrors(state({ oneTimeCost: "-1" }), 4)[0].message, /0 kr. eller derover/);
});

test("filvalg og serverpolitik bruger samme tilladte udvidelser", () => {
  for (const kind of Object.keys(initialApplicationState.attachments)) {
    const policy = getUploadPolicy(kind);
    assert.deepEqual(policy.accept.split(","), policy.extensions.map((extension) => `.${extension}`));
    for (const extension of ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "exe", "svg"]) {
      assert.equal(validateUpload(kind, { name: `bilag.${extension}`, size: 10, type: "" }) === null, policy.extensions.includes(extension), `${kind}: ${extension}`);
    }
  }
  assert.match(validateUpload("contract", { name: "bad\n.pdf", size: 10, type: "" }), /Filnavnet/);
  assert.match(validateUpload("contract", { name: "bilag.pdf", size: Number.NaN, type: "" }), /størrelse/);
});
