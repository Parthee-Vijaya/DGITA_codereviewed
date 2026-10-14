import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFArray, decodePDFRawStream } from "pdf-lib";
import { readJsonObject } from "../features/auth/http.ts";
import { canonicalCatalogSelection } from "../features/catalog/selection.ts";
import { demoApplicationState } from "../features/application/engine.ts";
import { EMPTY_D_GITA_APPROVAL, DEFAULT_CONTENT, DEFAULT_IMAGES } from "../features/workspace/model.ts";
import { lifecycleForDgitaApproval, normalizeContentInput, normalizeImageInput } from "../features/workspace/validation.ts";
import { csvCell } from "../features/workspace/csv.ts";
import { renderReceipt } from "../features/receipt/server.ts";
import catalog from "../features/catalog/data/system-catalog.json" with { type: "json" };

test("invalid JSON returns 400; oversized bodies return 413", async () => {
  for (const body of ["null", "[]", "{", '"text"', ""]) {
    await assert.rejects(readJsonObject(new Request("https://portal.test/api", { method: "POST", body })), { status: 400 });
  }
  await assert.rejects(readJsonObject(new Request("https://portal.test/api", { method: "POST", body: JSON.stringify({ value: "x".repeat(750_000) }) })), { status: 413 });
  assert.deepEqual(await readJsonObject(new Request("https://portal.test/api", { method: "POST", body: '{"ok":true}' })), { ok: true });
});

test("KITOS identity is canonical but the explicit applicant answer is preserved", () => {
  const actual = catalog.find((system) => system.usedInKalundborg);
  const state = structuredClone(demoApplicationState);
  state.selectedSystem = { ...actual, name: "Forged", supplier: "Forged", usedInKalundborg: false };
  state.municipalityAlreadyUsesSystem = "nej";
  const normalized = canonicalCatalogSelection(state);
  assert.equal(normalized.selectedSystem.name, actual.name);
  assert.equal(normalized.selectedSystem.supplier, actual.supplier);
  assert.equal(normalized.selectedSystem.usedInKalundborg, true);
  assert.equal(normalized.municipalityAlreadyUsesSystem, "nej");
  state.selectedSystem.id = "not-in-catalog";
  assert.throws(() => canonicalCatalogSelection(state), /KITOS/);
  state.selectedSystem = null;
  assert.equal(canonicalCatalogSelection(state), state);
});

test("all illegal draft and correction transitions are rejected", () => {
  for (const phase of ["Indsendt", "Under behandling", "Afsluttet"]) {
    for (const approved of ["", "Ja", "Nej"]) {
      assert.throws(() => lifecycleForDgitaApproval({ ...EMPTY_D_GITA_APPROVAL, phase, approved }, { status: "draft", currentVersionId: null }, new Date().toISOString()), { status: 409 });
    }
  }
  for (const phase of ["Kladde", "Indsendt", "Under behandling", "Afsluttet"]) {
    assert.throws(() => lifecycleForDgitaApproval({ ...EMPTY_D_GITA_APPROVAL, phase }, { status: "changes_requested", currentVersionId: "v1" }, new Date().toISOString()), { status: 409 });
  }
});

test("CMS normalizes known fields and rejects invalid publication/location types", () => {
  const content = normalizeContentInput({ ...DEFAULT_CONTENT[0], keywords: "crash", arbitrary: { secret: true } });
  assert.equal("keywords" in content, false);
  assert.equal("arbitrary" in content, false);
  assert.throws(() => normalizeContentInput({ ...DEFAULT_CONTENT[0], published: "false" }));
  assert.throws(() => normalizeContentInput({ ...DEFAULT_CONTENT[0], location: {} }));
  assert.throws(() => normalizeContentInput({ ...DEFAULT_CONTENT[0], category: "unknown" }));
  assert.equal("unknown" in normalizeImageInput({ ...DEFAULT_IMAGES[0], unknown: true }), false);
});

test("CSV output neutralizes formulas including whitespace-prefixed formulas", () => {
  for (const value of ["=SUM(1)", "+1", "-1", "@SUM(1)", "  =1", "\t=1", "\nformula"]) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('System "A"'), '"System ""A"""');
});

test("historical PDF system metadata uses the locked version after a correction changes the live name", async () => {
  const state = {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: "FROZEN_V1_SYSTEM", catalogQuery: "",
  };
  const bytes = await renderReceipt({
    case_number: "ITA-12345678", owner_name: "Testperson", owner_email: "test@example.invalid",
    system_name: "MUTABLE_V2_SYSTEM", receipt_version_number: 1, submitted_at: "2026-09-05T10:00:00Z",
  }, state, "submission");
  const document = await PDFDocument.load(bytes);
  const streams = document.getPages().flatMap((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    return refs.map((ref) => new TextDecoder().decode(decodePDFRawStream(document.context.lookup(ref)).decode()));
  }).join("\n");
  const text = [...streams.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map((match) => Buffer.from(match[1], "hex").toString("latin1")).join(" ");
  assert.ok(text.includes("FROZEN_V1_SYSTEM"));
  assert.ok(!text.includes("MUTABLE_V2_SYSTEM"), "a V1 receipt must never name the newer correction");
});

test("final PDF includes actual decision and paginates all long answers safely", async () => {
  const state = structuredClone(demoApplicationState);
  state.purpose = "Langt svar med alle detaljer. ".repeat(650) + "SLUTMARKERING";
  const bytes = await renderReceipt({
    case_number: "ITA-12345678", owner_name: "Testperson", owner_email: "test@example.invalid",
    system_name: "Systemnavn ".repeat(50), receipt_version_number: 2, submitted_at: "2026-09-05T10:00:00Z",
    decided_at: null, dgita_status: "rejected", dgita_reviewer: "Testkonsulent",
    dgita_comment: "Beslutningsbegrundelse", dgita_decided_at: "2026-09-05T11:00:00Z",
  }, state, "final");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 5);
  let text = "";
  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      const stream = new TextDecoder().decode(decodePDFRawStream(document.context.lookup(ref)).decode());
      text += [...stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join(" ");
      for (const match of stream.matchAll(/1 0 0 1 [\d.]+ ([\d.-]+) Tm/g)) assert.ok(Number(match[1]) >= 27, "text stays inside the page");
    }
  }
  for (const expected of ["Afvist", "Testkonsulent", "Beslutningsbegrundelse", "SLUTMARKERING"]) assert.ok(text.includes(expected), expected);
});
