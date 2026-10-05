import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, decodePDFRawStream } from "pdf-lib";
import { demoApplicationState } from "../features/application/engine.ts";
import { createReceiptView } from "../features/receipt/view-model.ts";
import { ReceiptDocument } from "../features/receipt/ReceiptDocument.tsx";
import { renderTaggedReceiptPrototype } from "../features/receipt/tagged-pdf-prototype.ts";

function source() {
  return { case_number: "ITA-12345678", receipt_version_id: "version-immutable", receipt_version_number: 2,
    snapshot_json: JSON.stringify({ ...structuredClone(demoApplicationState), remarks: '<img src=x onerror="alert(1)">', internalComments: "DO_NOT_DISCLOSE" }),
    snapshot_sha256: "a".repeat(64), submitted_at: "2026-10-05T10:00:00.000Z", approval_status: "rejected",
    approver_name: "Testgodkender", decision_comment: "Første versionsbegrundelse", decided_at: "2026-10-05T11:00:00Z",
    dgita_status: "approved", dgita_reviewer_snapshot: "Testkonsulent ved beslutningen", dgita_comment: "Endelig faglig beslutning", dgita_decided_at: "2026-10-05T12:00:00Z",
    internal_fields_json: JSON.stringify({ internalComments: "PRIVATE_REVIEW" }), owner_name: "MUTABLE_OWNER", dgita_reviewer: "MUTABLE_REVIEWER" };
}

test("HTML view binds case/version/decision, escapes markup and omits private/live profile fields", () => {
  const row = source();
  const view = createReceiptView(row, "final");
  const html = renderToStaticMarkup(createElement(ReceiptDocument, { receipt: view }));
  assert.match(html, /lang="da-DK"/);
  assert.match(html, /<h1>Afsluttende kvittering<\/h1>/);
  assert.match(html, /Endelig faglig beslutning/);
  assert.match(html, /Testkonsulent ved beslutningen/);
  assert.match(html, /version=version-immutable/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /DO_NOT_DISCLOSE|PRIVATE_REVIEW|MUTABLE_OWNER|MUTABLE_REVIEWER|<img/);
  const changedProfile = { ...row, owner_name: "New name", dgita_reviewer: "New reviewer", internal_fields_json: '{"internalComments":"new private text"}' };
  assert.deepEqual(createReceiptView(changedProfile, "final"), view);
  assert.equal(createReceiptView(row, "approval").decision.outcome, "Afvist");
  assert.equal(createReceiptView(row, "submission").decision, null);
});

test("nonfinal decisions are never presented as accepted receipt outcomes", () => {
  assert.throws(() => createReceiptView({ ...source(), dgita_status: "in_review" }, "final"), /not final/);
  assert.throws(() => createReceiptView({ ...source(), approval_status: null }, "approval"), /not final/);
});

test("tagged prototype has language, semantic order, complete MCID parent map and tagged login link", async () => {
  const row = source();
  const state = JSON.parse(row.snapshot_json);
  state.purpose = "Lang syntetisk beskrivelse med æøå. ".repeat(800) + "SIDSTEDETALJE";
  row.snapshot_json = JSON.stringify(state);
  const view = createReceiptView(row, "final");
  const document = await PDFDocument.load(await renderTaggedReceiptPrototype(view, "https://portal.example.invalid"));
  const context = document.context;
  const root = document.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
  const body = context.lookup(root.lookup(PDFName.of("K"), PDFArray).get(0), PDFDict);
  assert.equal(document.catalog.lookup(PDFName.of("Lang"), PDFString).decodeText(), "da-DK");
  assert.equal(document.catalog.lookup(PDFName.of("MarkInfo"), PDFDict).get(PDFName.of("Marked")).toString(), "true");
  const elements = body.lookup(PDFName.of("K"), PDFArray).asArray();
  assert.equal(context.lookup(elements[0], PDFDict).get(PDFName.of("S")).toString(), "/H1");
  assert.equal(elements.filter((ref) => context.lookup(ref, PDFDict).get(PDFName.of("S")).toString() === "/H2").length, view.sections.length + 2);
  const nums = root.lookup(PDFName.of("ParentTree"), PDFDict).lookup(PDFName.of("Nums"), PDFArray).asArray();
  const parents = new Map();
  for (let i = 0; i < nums.length; i += 2) parents.set(nums[i].asNumber(), nums[i + 1]);
  assert.ok(document.getPageCount() > 5);
  let contents = ""; let links = 0;
  for (const page of document.getPages()) {
    assert.equal(page.node.get(PDFName.of("Tabs")).toString(), "/S");
    const parentRefs = parents.get(page.node.get(PDFName.of("StructParents")).asNumber());
    const streams = page.node.Contents();
    const streamRefs = streams instanceof PDFArray ? streams.asArray() : [streams];
    const text = streamRefs.map((ref) => new TextDecoder().decode(decodePDFRawStream(context.lookup(ref)).decode())).join("\n");
    contents += text;
    const mcids = [...text.matchAll(/\/MCID (\d+)/gu)].map((match) => Number(match[1]));
    assert.equal(mcids.length, new Set(mcids).size);
    assert.equal(parentRefs.size(), mcids.length);
    for (const mcid of mcids) {
      const element = context.lookup(parentRefs.get(mcid), PDFDict);
      assert.ok(element.lookup(PDFName.of("K"), PDFArray).asArray().some((kid) => kid.get(PDFName.of("Type"))?.toString() === "/MCR" && kid.get(PDFName.of("Pg")).toString() === page.ref.toString() && kid.get(PDFName.of("MCID")).asNumber() === mcid));
    }
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annotation = context.lookup(ref, PDFDict); links++;
      const link = context.lookup(parents.get(annotation.get(PDFName.of("StructParent")).asNumber()), PDFDict);
      assert.equal(link.get(PDFName.of("S")).toString(), "/Link");
      assert.match(annotation.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText(), /^https:\/\/portal\.example\.invalid\/cases\/ITA-12345678\/receipt\?kind=final&version=version-immutable$/);
      assert.ok(link.lookup(PDFName.of("K"), PDFArray).asArray().some((kid) => kid.get(PDFName.of("Type"))?.toString() === "/OBJR" && kid.get(PDFName.of("Obj")).toString() === ref.toString()));
    }
  }
  assert.ok(links > 0);
  assert.ok(contents.includes(Buffer.from("SIDSTEDETALJE").toString("hex").toUpperCase()));
  assert.equal((contents.match(/\bBDC\b/gu) ?? []).length, (contents.match(/\bEMC\b/gu) ?? []).length);
  assert.equal(document.catalog.has(PDFName.of("Metadata")), false, "prototype must not claim a PDF/UA conformance identifier");
});

test("prototype refuses unsafe destinations and unsupported glyphs instead of silently losing content", async () => {
  const view = createReceiptView(source(), "submission");
  for (const origin of ["javascript:alert(1)", "https://user:pass@example.invalid", "https://example.invalid/?token=secret", "https://example.invalid/path"]) await assert.rejects(renderTaggedReceiptPrototype(view, origin));
  view.sections[0].rows[0][1] = "Unicode prototype limitation 🐈";
  await assert.rejects(renderTaggedReceiptPrototype(view, "https://portal.example.invalid"), /encode/);
});
