import assert from "node:assert/strict";
import test from "node:test";
import { demoApplicationState, legacyDemoApplicationState } from "../features/application/engine.ts";
import { receiptSections } from "../features/receipt/content.ts";
import { procurementSummaryRows } from "../features/cases/procurement-summary.ts";

test("receipts show public contract facts, multiple data categories and AI answers without internal assessments", () => {
  const state = { ...structuredClone(demoApplicationState), personalData: "ja", personalDataCategories: ["ordinary", "special"],
    contractValueStatus: "estimated", estimatedContractValueExVat: "1.234.567,89", contractDurationMonths: "48",
    contractOptionsDescription: "To syntetiske forlængelser", contractValueNote: "Syntetisk leverandøroverslag",
    contractCoverage: "existing-agreement", agreementReference: "SAG-123", aiUsage: "ja", aiPurpose: "Syntetisk AI-formål",
    aiAssessmentUrl: "https://example.invalid/assessment", privacyAssessment: { processingBasis: "PRIVATE_LEGAL" },
    procurementAssessment: { rationale: "PRIVATE_PROCUREMENT" } };
  const rows = new Map(receiptSections(state).flatMap(section => section.rows));
  assert.equal(rows.get("Anslået kontraktværdi ekskl. moms"), "1.234.567,89 kr.");
  assert.equal(rows.get("Aftaleperiode"), "48 måneder");
  assert.match(rows.get("Personoplysningskategorier"), /Almindelige/);
  assert.match(rows.get("Personoplysningskategorier"), /Særlige/);
  assert.equal(rows.get("Reference til eksisterende aftale"), "SAG-123");
  assert.equal(rows.get("Formål med AI"), "Syntetisk AI-formål");
  assert.equal(rows.get("Reference til AI-vurdering"), "https://example.invalid/assessment");
  assert.doesNotMatch(JSON.stringify([...rows]), /PRIVATE_LEGAL|PRIVATE_PROCUREMENT/);
});

test("legacy receipt fields remain unanswered and hidden conditional data never leaks into receipts", () => {
  const legacy = structuredClone(legacyDemoApplicationState);
  const before = JSON.stringify(legacy);
  const rows = new Map(receiptSections(legacy).flatMap(section => section.rows));
  assert.equal(rows.get("Kontraktværdi · afklaring"), "Ikke besvaret");
  assert.equal(rows.get("Aftaleform"), "Ikke besvaret");
  assert.equal(rows.has("Anslået kontraktværdi ekskl. moms"), false);
  assert.equal(JSON.stringify(legacy), before);
  const hidden = { ...legacy, personalData: "nej", personalDataCategories: ["criminal"], contractValueStatus: "needs-clarification",
    estimatedContractValueExVat: "999", contractOptionsDescription: "HIDDEN_OPTIONS", contractValueNote: "HIDDEN_NOTE",
    contractCoverage: "new-contract", agreementReference: "HIDDEN_AGREEMENT", aiUsage: "nej", aiPurpose: "HIDDEN_AI",
    aiAssessmentUrl: "javascript:HIDDEN_URL" };
  assert.doesNotMatch(JSON.stringify(receiptSections(hidden)), /HIDDEN_|999|Strafbare/);
  assert.equal(procurementSummaryRows(hidden).length, 2);
});
