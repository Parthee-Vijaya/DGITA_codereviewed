import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import { parseKleCatalogPackage, type KleCatalogPackage } from "../features/kle/catalog";
import type { KleCatalogEntry } from "../features/kle/domain";

/** Offline adapter for the documented full-emneplan 1.2 structure, not an XSD 1.1 validator. */
export const KLE_XML_SCHEMA_URL = "https://skemaer.kle-online.dk/rest_1_2/KLE-REST-Emneplan-fuld-version-1-2.xsd";
export const KLE_XML_LIMITS = { bytes: 32 * 1024 * 1024, nodes: 500_000, depth: 32 } as const;
type Metadata = { version: string; sourceUrl: string; retrievedAt: string };
type Field = readonly [name: string, min: number, max: number];

function fail(message: string): never { throw new Error(`KLE-klargøring: ${message}`); }
function elements(node: Node): Element[] {
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) result.push(child as Element);
    else if (child.nodeType !== 8 && (child.nodeType !== 3 || child.nodeValue?.trim())) fail(`Uventet indhold i ${node.nodeName}.`);
  }
  return result;
}

/** Enforce supported fields, cardinality and ordering; unknown schema variants stop the import. */
function sequence(node: Element, fields: readonly Field[]): Map<string, Element[]> {
  const result = new Map<string, Element[]>();
  let last = -1;
  for (const child of elements(node)) {
    const index = fields.findIndex(([name]) => name === child.tagName);
    if (index < last || index < 0) fail(`Ukendt eller forkert placeret felt ${child.tagName} i ${node.tagName}.`);
    last = index;
    const items = result.get(child.tagName) ?? [];
    items.push(child);
    result.set(child.tagName, items);
  }
  for (const [name, min, max] of fields) {
    const count = result.get(name)?.length ?? 0;
    if (count < min || count > max) fail(`Feltet ${name} forekommer ${count} gange i ${node.tagName}.`);
  }
  return result;
}

function plain(node: Element, max = 10_000, allowEmpty = false): string {
  let value = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) value += child.nodeValue ?? "";
    else if (child.nodeType !== 8) fail(`Feltet ${node.tagName} skal være ren tekst.`);
  }
  value = value.trim().replace(/\s+/gu, " ");
  if ((!allowEmpty && !value) || value.length > max) fail(`Teksten i ${node.tagName} er tom eller for lang.`);
  return value;
}
function date(node: Element): string {
  const value = plain(node, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`Ugyldig dato i ${node.tagName}. Kun YYYY-MM-DD understøttes.`);
  return value;
}
function guidance(node: Element): string {
  const fields = sequence(node, [["VejledningTekst", 1, 1]]);
  const body = fields.get("VejledningTekst")![0];
  const paragraphs = sequence(body, [["p", 1, Infinity]]).get("p")!;
  function flatten(current: Element, depth: number): string {
    if (depth > 8) fail("Vejledningens formatering er for dyb.");
    let value = "";
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4) value += child.nodeValue ?? "";
      else if (child.nodeType === 1) {
        const element = child as Element;
        if (!["i", "b", "ul", "ol", "li"].includes(element.tagName)) fail(`Vejledning indeholder ikke-understøttet formatering: ${element.tagName}.`);
        const block = ["ul", "ol", "li"].includes(element.tagName);
        value += `${block ? " " : ""}${flatten(element, depth + 1)}${block ? " " : ""}`;
      } else if (child.nodeType !== 8) fail("Vejledning indeholder andet end tekst og tilladt formatering.");
    }
    return value;
  }
  // No XML/HTML is emitted. Consumers render this string as text, never innerHTML.
  const result = paragraphs.map((item) => flatten(item, 0).trim().replace(/\s+/gu, " ")).join("\n");
  if (result.length > 10_000) fail("Vejledning er længere end 10.000 tegn.");
  return result;
}
function historical(node: Element): boolean {
  const fields = sequence(node, [["OprettetDato", 1, 1], ["RettetDato", 0, Infinity], ["Historisk", 0, 1]]);
  date(fields.get("OprettetDato")![0]);
  for (const item of fields.get("RettetDato") ?? []) date(item);
  const history = fields.get("Historisk")?.[0];
  if (!history) return false;
  const children = elements(history);
  if (children.length !== 1) fail("Historisk skal have præcis én udgået- eller flytteoplysning.");
  if (children[0].tagName === "UdgaaetDato") date(children[0]);
  else if (children[0].tagName === "Flyttet") {
    const moved = sequence(children[0], [["FlyttetDato", 1, 1], ["AfloestAf", 0, Infinity]]);
    date(moved.get("FlyttetDato")![0]);
    for (const replacement of moved.get("AfloestAf") ?? []) {
      const targets = elements(replacement);
      if (targets.length !== 1 || !["HovedgruppeNr", "GruppeNr", "EmneNr", "HandlingsfacetNr"].includes(targets[0].tagName)) fail("AfloestAf har et ukendt format.");
      plain(targets[0], 8);
    }
  } else fail("Ukendt historikformat.");
  // Both documented historical variants are conservatively unavailable for new selection.
  return true;
}

function optionalFields(fields: Map<string, Element[]>, prefix: string): void {
  for (const filter of fields.get(`${prefix}Filter`) ?? []) {
    const values = sequence(filter, [["FilterTitel", 0, Infinity]]);
    for (const value of values.get("FilterTitel") ?? []) plain(value, 500, true);
  }
  for (const reference of fields.get(`${prefix}RetskildeReference`) ?? []) {
    const values = sequence(reference, [["RetskildeTitel", 1, 1], ["ParagrafEllerKapitel", 0, 1], ["RetsinfoAccessionsNr", 1, 1]]);
    for (const items of values.values()) for (const item of items) plain(item, 10_000, true);
  }
  for (const item of fields.get("BevaringJaevnfoerArkivloven") ?? []) {
    if (!/^(?:K|K5|K10|B|tom)$/u.test(plain(item, 3))) fail("Ukendt bevaringsværdi.");
  }
  for (const item of fields.get("SletningJaevnfoerPersondataloven") ?? []) {
    if (!/^-?P(?=\d|T)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u.test(plain(item, 80))) fail("Ukendt sletningsperiode.");
  }
  // Facet-scoped keywords are intentionally not flattened into a topic's own keywords.
  for (const item of fields.get("EmneOgHandlingsfacetStikord") ?? []) {
    const values = sequence(item, [["Orden", 1, 1], ["Tekst", 1, 1], ["HandlingsfacetNr", 1, 1]]);
    plain(values.get("Orden")![0], 100, true);
    plain(values.get("Tekst")![0], 256);
    if (!/^[APSGKIØ]\d{2}$/u.test(plain(values.get("HandlingsfacetNr")![0], 3))) fail("Ukendt handlingsfacet.");
  }
}

function entriesFrom(root: Element): KleCatalogEntry[] {
  const fields = sequence(root, [["UdgivelsesDato", 1, 1], ["Hovedgruppe", 1, Infinity]]);
  date(fields.get("UdgivelsesDato")![0]);
  const result: KleCatalogEntry[] = [];
  function add(node: Element, parentCode?: string): void {
    const prefix = node.tagName;
    const main = prefix === "Hovedgruppe";
    const topic = prefix === "Emne";
    const childrenName = main ? "Gruppe" : "Emne";
    const rules: Field[] = [[`${prefix}Nr`, 1, 1], [`${prefix}Titel`, 1, 1], [`${prefix}Vejledning`, main ? 1 : 0, 1]];
    if (!main) rules.push([`${prefix}RetskildeReference`, 0, Infinity]);
    rules.push([`${prefix}AdministrativInfo`, 1, 1]);
    if (topic) rules.push(["BevaringJaevnfoerArkivloven", 0, 1], ["SletningJaevnfoerPersondataloven", 0, 1]);
    rules.push([`${prefix}Filter`, 0, Infinity], [`${prefix}Stikord`, 0, Infinity]);
    if (topic) rules.push(["EmneOgHandlingsfacetStikord", 0, Infinity]);
    rules.push(["UUID", 1, 1]);
    if (!topic) rules.push([childrenName, 1, Infinity]);
    const data = sequence(node, rules);
    const code = plain(data.get(`${prefix}Nr`)![0], 8);
    const codePattern = main ? /^\d{2}$/u : topic ? /^\d{2}\.\d{2}\.\d{2}$/u : /^\d{2}\.\d{2}$/u;
    if (!codePattern.test(code) || parentCode && !code.startsWith(`${parentCode}.`)) fail("KLE-nummer og hierarki stemmer ikke overens.");
    const uuid = plain(data.get("UUID")![0], 36).toLowerCase();
    const title = plain(data.get(`${prefix}Titel`)![0], 500);
    const keywords = [...new Set((data.get(`${prefix}Stikord`) ?? []).map((item) => {
      const keyword = sequence(item, [["Orden", 1, 1], ["Tekst", 1, 1]]);
      plain(keyword.get("Orden")![0], 100, true);
      return plain(keyword.get("Tekst")![0], 256);
    }))];
    const descriptionNode = data.get(`${prefix}Vejledning`)?.[0];
    const description = descriptionNode ? guidance(descriptionNode) : "";
    optionalFields(data, prefix);
    result.push({ uuid, code, title, level: main ? "main-group" : topic ? "topic" : "group", retired: historical(data.get(`${prefix}AdministrativInfo`)![0]), ...(keywords.length ? { keywords } : {}), ...(description ? { description } : {}) });
    for (const child of data.get(childrenName) ?? []) add(child, code);
  }
  for (const node of fields.get("Hovedgruppe")!) add(node);
  return result;
}

function validateTree(document: Node): void {
  const pending: { node: Node; depth: number }[] = [{ node: document, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > KLE_XML_LIMITS.nodes || depth > KLE_XML_LIMITS.depth) fail("XML-dokumentet er for stort eller for dybt.");
    if (![1, 3, 4, 7, 8, 9].includes(node.nodeType)) fail("XML indeholder en ikke-understøttet nodetype.");
    if (node.nodeType === 7 && (node.nodeName !== "xml" || node.parentNode !== document)) fail("XML-behandlingsinstruktioner er ikke tilladt.");
    if (node.nodeType === 1) {
      const element = node as Element;
      if (element.namespaceURI || element.prefix) fail("Kun fuld emneplan uden navnerum understøttes.");
      for (let i = 0; i < element.attributes.length; i++) {
        const attribute = element.attributes.item(i)!;
        const schemaHint = element.tagName === "KLE-Emneplan" && ((attribute.name === "xmlns:xsi" && attribute.value === "http://www.w3.org/2001/XMLSchema-instance") || (attribute.name === "xsi:noNamespaceSchemaLocation" && attribute.value === KLE_XML_SCHEMA_URL));
        if (!schemaHint) fail(`Attributten ${attribute.name} understøttes ikke.`);
      }
    }
    for (let child = node.lastChild; child; child = child.previousSibling) pending.push({ node: child, depth: depth + 1 });
  }
}

export function prepareKleCatalogXml(bytes: Uint8Array, metadata: Metadata): KleCatalogPackage {
  if (!bytes.length || bytes.length > KLE_XML_LIMITS.bytes) fail("Input skal være mellem 1 byte og 32 MiB.");
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("Input skal være gyldig UTF-8."); }
  // This is a denylist preflight, not an XML parser. No external declarations are processed.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) fail("DOCTYPE og ENTITY er ikke tilladt.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(xml)) fail("XML indeholder ugyldige kontroltegn.");
  const declaration = xml.match(/^\s*<\?xml\s[^?]*\?>/u)?.[0];
  if (declaration && /encoding\s*=\s*["'](?!utf-8["'])/iu.test(declaration)) fail("Kun UTF-8-kodning understøttes.");
  const document = new DOMParser({ onError: () => fail("XML er ikke velformet.") }).parseFromString(xml, "application/xml");
  validateTree(document);
  const root = document.documentElement;
  if (!root || root.tagName !== "KLE-Emneplan") fail("Kun KLE-Emneplan i det dokumenterede fuld-emneplan-format 1.2 understøttes.");
  const catalog = {
    source: { id: "kl-kle-emneplan", version: metadata.version, label: "KLE – afventer aftale og aktivering", kind: "licensed", status: "available", acceptedForUse: false },
    entries: entriesFrom(root),
  };
  return parseKleCatalogPackage({ schemaVersion: 1, catalog, provenance: { sourceUrl: metadata.sourceUrl, retrievedAt: metadata.retrievedAt, sha256: createHash("sha256").update(bytes).digest("hex"), format: "kle-rest-xml" } });
}

async function readBounded(path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > KLE_XML_LIMITS.bytes) fail("Input overstiger 32 MiB.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function writeNew(path: string, value: KleCatalogPackage): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    // Atomic publish with no overwrite, including concurrent calls and existing symlinks.
    await link(temporary, path);
  } finally {
    await handle.close();
    await unlink(temporary);
  }
}
async function main(args: string[]): Promise<void> {
  const names = ["--input", "--output", "--version", "--source-url", "--retrieved-at"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!names.includes(name) || values.has(name) || !value || value.startsWith("--")) fail("Brug: npm run kle:prepare -- --input FIL.xml --output NY.json --version VERSION --source-url HTTPS-URL --retrieved-at ISO-DATO");
    values.set(name, value);
  }
  if (values.size !== names.length) fail("Input, output, version, source-url og retrieved-at skal angives. Kommandoen henter ingen data.");
  const bytes = await readBounded(resolve(values.get("--input")!));
  const value = prepareKleCatalogXml(bytes, { version: values.get("--version")!, sourceUrl: values.get("--source-url")!, retrievedAt: values.get("--retrieved-at")! });
  await writeNew(resolve(values.get("--output")!), value);
  process.stdout.write(`Klargjort ${value.catalog.entries.length} poster. Pakken er ikke godkendt eller aktiveret. SHA-256: ${value.provenance.sha256}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "KLE-klargøring fejlede."}\n`);
    process.exitCode = 1;
  });
}
