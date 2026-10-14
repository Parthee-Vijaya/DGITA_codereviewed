import assert from "node:assert/strict";
import test from "node:test";
import { isKleCatalog, isKleCatalogPackage, parseKleCatalogPackage, KLE_CATALOG_LIMITS } from "../features/kle/catalog.ts";
import { SYNTHETIC_KLE_CATALOG } from "../features/kle/synthetic.ts";

const makePackage = () => ({
  schemaVersion: 1,
  catalog: structuredClone(SYNTHETIC_KLE_CATALOG),
  provenance: { sourceUrl: "https://example.invalid/invented-test-source", retrievedAt: "2026-10-14T12:00:00.000Z", sha256: "1".repeat(64), format: "dgita-kle-catalog-v1" },
});
const licensedShape = () => ({
  source: { id: "invented-test-catalogue", version: "test-1", label: "Invented test data in licensed data format", kind: "licensed", status: "available", acceptedForUse: false },
  entries: [
    { uuid: "abcdef00-0000-4000-8000-000000000001", code: "00", title: "Invented main group", level: "main-group", retired: false },
    { uuid: "abcdef00-0000-4000-8000-000000000002", code: "00.01", title: "Invented group", level: "group", retired: false },
    { uuid: "abcdef00-0000-4000-8000-000000000003", code: "00.01.02", title: "Invented topic", level: "topic", retired: false, keywords: ["test"], description: "Invented text.\nAnother line." },
  ],
});

test("prepared packages preserve source/provenance and clone records without accepting a source", () => {
  const input = makePackage();
  input.catalog = licensedShape();
  input.catalog.entries[0].uuid = input.catalog.entries[0].uuid.toUpperCase();
  input.provenance.format = "kle-rest-xml";
  assert.equal(isKleCatalogPackage(input), true);
  const parsed = parseKleCatalogPackage(input);
  assert.equal(parsed.catalog.entries[0].uuid, "abcdef00-0000-4000-8000-000000000001");
  assert.deepEqual(parsed.catalog.entries.map(({ code }) => code), ["00", "00.01", "00.01.02"]);
  assert.equal(parsed.catalog.source.acceptedForUse, false);
  assert.deepEqual(parsed.provenance, input.provenance);
  parsed.catalog.entries[2].keywords.push("changed");
  parsed.catalog.source.label = "Changed";
  assert.deepEqual(input.catalog.entries[2].keywords, ["test"]);
  assert.notEqual(input.catalog.source.label, "Changed");
});

test("synthetic snapshots remain valid and new package acceptance must be explicitly false", () => {
  assert.equal(isKleCatalog(SYNTHETIC_KLE_CATALOG), true);
  assert.equal(isKleCatalogPackage(makePackage()), true);
  const input = makePackage(); input.catalog = licensedShape();
  input.catalog.source.acceptedForUse = true;
  assert.equal(isKleCatalog(input.catalog), true);
  assert.equal(isKleCatalogPackage(input), false);
  assert.throws(() => parseKleCatalogPackage(input), /godkendt/u);
  input.catalog = structuredClone(SYNTHETIC_KLE_CATALOG);
  input.catalog.source.acceptedForUse = true;
  assert.equal(isKleCatalog(input.catalog), false);
});

test("catalogue validation rejects ambiguous identities, wrong levels, numeric codes and unknown fields", () => {
  const variations = [
    (catalog) => { catalog.entries[1].uuid = catalog.entries[0].uuid.toUpperCase(); },
    (catalog) => { catalog.entries[2].code = catalog.entries[1].code; catalog.entries[2].level = "group"; },
    (catalog) => { catalog.entries[0].code = 0; },
    (catalog) => { catalog.entries[2].code = "0.1.2"; },
    (catalog) => { catalog.entries[2].code = "00.01"; },
    (catalog) => { catalog.entries[2].code = "DEMO.00.01"; },
    (catalog) => { catalog.entries[2].level = "collection"; },
    (catalog) => { catalog.entries[2].retired = "false"; },
    (catalog) => { catalog.entries[2].uuid = "not-a-uuid"; },
    (catalog) => { catalog.entries[2].url = "https://example.invalid"; },
    (catalog) => { catalog.extra = true; },
    (catalog) => { catalog.source.secret = "not permitted"; },
  ];
  for (const mutate of variations) { const catalog = licensedShape(); mutate(catalog); assert.equal(isKleCatalog(catalog), false, mutate.toString()); }
});

test("bounded text and source metadata reject malformed, oversized and control-character content", () => {
  const variations = [
    (catalog) => { catalog.source.id = ""; },
    (catalog) => { catalog.source.version = " "; },
    (catalog) => { catalog.source.status = "ready"; },
    (catalog) => { catalog.source.kind = "official"; },
    (catalog) => { catalog.source.acceptedForUse = "false"; },
    (catalog) => { catalog.entries[2].title = "x".repeat(KLE_CATALOG_LIMITS.title + 1); },
    (catalog) => { catalog.entries[2].title = "\u0000"; },
    (catalog) => { catalog.entries[2].keywords = ["test", "TEST"]; },
    (catalog) => { catalog.entries[2].keywords = [" "]; },
    (catalog) => { catalog.entries[2].keywords = ["x".repeat(KLE_CATALOG_LIMITS.keyword + 1)]; },
    (catalog) => { catalog.entries[2].keywords = Array.from({ length: KLE_CATALOG_LIMITS.keywords + 1 }, (_, i) => `test-${i}`); },
    (catalog) => { catalog.entries[2].description = "x".repeat(KLE_CATALOG_LIMITS.description + 1); },
    (catalog) => { catalog.entries[2].description = "Text\u0000"; },
  ];
  for (const mutate of variations) { const catalog = licensedShape(); mutate(catalog); assert.equal(isKleCatalog(catalog), false, mutate.toString()); }
  for (const value of [null, [], {}, { source: licensedShape().source, entries: new Array(KLE_CATALOG_LIMITS.entries + 1) }]) assert.equal(isKleCatalog(value), false);
});

test("provenance must be bounded HTTPS without credentials, a real UTC timestamp and a digest", () => {
  const variations = [
    (input) => { input.schemaVersion = 2; },
    (input) => { input.approved = true; },
    (input) => { input.provenance.extra = true; },
    (input) => { input.provenance.sourceUrl = "http://example.invalid"; },
    (input) => { input.provenance.sourceUrl = "https://user:password@example.invalid"; },
    (input) => { input.provenance.sourceUrl = "not a URL"; },
    (input) => { input.provenance.retrievedAt = "2026-02-30T12:00:00.000Z"; },
    (input) => { input.provenance.retrievedAt = "2026-10-14"; },
    (input) => { input.provenance.sha256 = "g".repeat(64); },
    (input) => { input.provenance.sha256 = "a".repeat(63); },
    (input) => { input.provenance.format = "unverified"; },
  ];
  for (const mutate of variations) { const input = makePackage(); mutate(input); assert.equal(isKleCatalogPackage(input), false, mutate.toString()); }
});

test("aggregate text is bounded even when every individual field is within its limit", () => {
  const catalog = licensedShape();
  catalog.entries = Array.from({ length: 3000 }, (_, index) => ({
    uuid: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    code: `00.${String(Math.floor(index / 100)).padStart(2, "0")}.${String(index % 100).padStart(2, "0")}`,
    title: "Invented", level: "topic", retired: false, description: "x".repeat(KLE_CATALOG_LIMITS.description),
  }));
  assert.equal(isKleCatalog(catalog), false);
});
