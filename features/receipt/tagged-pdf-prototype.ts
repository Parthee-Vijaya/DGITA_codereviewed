import { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, PDFOperator, PDFOperatorNames, StandardFonts, endMarkedContent, type PDFRef, type PDFDict, type PDFPage, type PDFFont } from "pdf-lib";
import { formatReceiptDate, type ReceiptView } from "./view-model";

/** Research renderer only: never stores/replaces a production receipt. Tagged
 * structure is tested below, but standard fonts are not embedded and PDF/UA,
 * visual rendering and real screen-reader acceptance remain unverified. */
export async function renderTaggedReceiptPrototype(receipt: ReceiptView, portalOrigin: string) {
  const origin = new URL(portalOrigin);
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Prototype requires a trusted portal origin");
  }
  const document = await PDFDocument.create();
  document.setTitle(`${receipt.title} · ${receipt.caseNumber}`);
  document.setAuthor("D-GITA");
  document.setSubject("Tagget prototype – kræver dokument- og skærmlæseraccept");
  document.setCreator("D-GITA tagged receipt prototype v1");
  document.setLanguage("da-DK");
  const date = new Date(receipt.submittedAt);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid receipt date");
  document.setCreationDate(date);
  document.setModificationDate(date);
  document.catalog.set(PDFName.of("MarkInfo"), document.context.obj({ Marked: true }));
  document.catalog.set(PDFName.of("ViewerPreferences"), document.context.obj({ DisplayDocTitle: true }));
  const root = document.context.obj({ Type: "StructTreeRoot" });
  const rootRef = document.context.register(root);
  const body = document.context.obj({ Type: "StructElem", S: "Document", P: rootRef, Lang: PDFString.of("da-DK") });
  const bodyRef = document.context.register(body);
  root.set(PDFName.of("K"), document.context.obj([bodyRef]));
  document.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const blocks: PDFRef[] = [];
  const parents: Array<number | PDFRef | PDFRef[]> = [];
  const pageParents = new Map<PDFPage, PDFRef[]>();
  let parentKey = 0;
  let page!: PDFPage;
  let y = 0;
  function addPage() {
    page = document.addPage([595.28, 841.89]);
    page.node.set(PDFName.of("StructParents"), PDFNumber.of(parentKey));
    page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
    const refs: PDFRef[] = [];
    pageParents.set(page, refs);
    parents.push(parentKey++, refs);
    y = 780;
  }
  addPage();

  function block(tag: "H1" | "H2" | "P" | "Link", text: string, href?: string) {
    const size = tag === "H1" ? 20 : tag === "H2" ? 14 : 11;
    const activeFont = tag === "H1" || tag === "H2" ? bold : font;
    // Reject unsupported glyphs rather than silently changing a case record.
    const lines = wrapText(text || "Ikke oplyst", activeFont, size, 475);
    const element = document.context.obj({ Type: "StructElem", S: tag, P: bodyRef });
    const ref = document.context.register(element);
    blocks.push(ref);
    const kids: PDFDict[] = [];
    for (const line of lines) {
      if (y < 64) addPage();
      const parentRefs = pageParents.get(page)!;
      const mcid = parentRefs.length;
      parentRefs.push(ref);
      page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of(tag), document.context.obj({ MCID: mcid, ActualText: PDFHexString.fromText(`${line}\n`) }).toString()]));
      page.drawText(line, { x: 60, y, font: activeFont, size });
      page.pushOperators(endMarkedContent());
      kids.push(document.context.obj({ Type: "MCR", Pg: page.ref, MCID: mcid }));
      if (href) {
        const annotation = document.context.obj({ Type: "Annot", Subtype: "Link", Rect: [60, y - 3, 60 + activeFont.widthOfTextAtSize(line, size), y + size], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(href) }, StructParent: parentKey, Contents: PDFHexString.fromText(text) });
        const annotationRef = document.context.register(annotation);
        page.node.addAnnot(annotationRef);
        parents.push(parentKey++, ref);
        kids.push(document.context.obj({ Type: "OBJR", Pg: page.ref, Obj: annotationRef }));
      }
      y -= size + 6;
    }
    element.set(PDFName.of("K"), document.context.obj(kids));
    y -= tag === "H2" ? 8 : 5;
  }

  block("H1", receipt.title);
  block("P", `Sag ${receipt.caseNumber} · Version ${receipt.versionNumber}`);
  block("P", `Indsendt: ${formatReceiptDate(receipt.submittedAt)}`);
  block("P", "Tagget prototype – denne fil erstatter ikke den eksisterende kvittering.");
  if (receipt.decision) {
    block("H2", receipt.decision.label);
    block("P", `${receipt.decision.outcome} · ${receipt.decision.name} · ${formatReceiptDate(receipt.decision.decidedAt)}`);
    if (receipt.decision.comment) block("P", `Bemærkning: ${receipt.decision.comment}`);
  }
  for (const section of receipt.sections) {
    block("H2", section.title);
    for (const [label, value] of section.rows) block("P", `${label}: ${value || "Ikke oplyst"}`);
  }
  block("H2", "Versionskontrol");
  block("P", `Versions-id: ${receipt.applicationVersionId}`);
  block("P", `SHA-256: ${receipt.snapshotSha256}`);
  const path = `/cases/${encodeURIComponent(receipt.caseNumber)}/receipt?${new URLSearchParams({ kind: receipt.kind, version: receipt.applicationVersionId })}`;
  block("Link", "Åbn samme sagsversion i portalen (kræver login)", new URL(path, origin).href);
  body.set(PDFName.of("K"), document.context.obj(blocks));
  root.set(PDFName.of("ParentTree"), document.context.register(document.context.obj({ Nums: parents })));
  root.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(parentKey));
  return document.save({ useObjectStreams: false });
}

function wrapText(value: string, font: PDFFont, size: number, width: number) {
  if (value.length > 200_000) throw new Error("Prototype paragraph too large");
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/u)) {
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}
