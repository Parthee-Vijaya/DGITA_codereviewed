import assert from "node:assert/strict";
import test from "node:test";
import { createKleSearchIndex, searchKleCatalog, KLE_SEARCH_LIMITS } from "../features/kle/search.ts";
import { createEmptyKleReview, getKleInputBinding } from "../features/kle/domain.ts";
import { SYNTHETIC_KLE_CATALOG, SYNTHETIC_KL_TASK_CATALOG } from "../features/kle/synthetic.ts";

const index = createKleSearchIndex(SYNTHETIC_KLE_CATALOG);
const search = (query, options = {}) => searchKleCatalog(index, { query, ...options });
const entry = (number, title, extra = {}) => ({ uuid: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, code: `DEMO.00.${String(number).padStart(2, "0")}`, title, level: "topic", retired: false, ...extra });
const catalog = (entries) => ({ source: { ...SYNTHETIC_KLE_CATALOG.source }, entries });

test("integrated search finds code, title, keywords and descriptions with AND semantics", () => {
  assert.equal(search("DEMO.00.01").results[0].code, "DEMO.00.01");
  assert.equal(search("lokal drift").results[0].code, "DEMO.00.01");
  assert.equal(search("login").results[0].code, "DEMO.00.02");
  assert.equal(search("arbejdsopgave").results[0].code, "DEMO.00.01");
  assert.equal(search("login integration").total, 1);
  assert.equal(search("login driftsopgave").total, 0);
  assert.equal(search("DEMO.0.1").total, 0);
});

test("search folds Danish casing, accents and æ/ø transcriptions without changing stored text", () => {
  const local = createKleSearchIndex(catalog([entry(1, "Årlig hjælp til børn i caféen", { keywords: ["Søknad"] })]));
  for (const query of ["ÅRLIG", "arlig", "hjaelp boern cafeen", "SØKNAD", "soeknad"]) {
    const result = searchKleCatalog(local, { query });
    assert.equal(result.total, 1, query);
    assert.equal(result.results[0].title, "Årlig hjælp til børn i caféen");
  }
});

test("exact code and title precede keyword and description matches with stable tie ordering", () => {
  const local = createKleSearchIndex(catalog([
    entry(4, "Other", { keywords: ["Demo.00.01", "service"] }),
    entry(2, "Service", { description: "Demo.00.01" }),
    entry(3, "Other", { keywords: ["service"] }),
    entry(1, "Other", { description: "service" }),
  ]));
  assert.equal(searchKleCatalog(local, { query: "DEMO.00.01" }).results[0].code, "DEMO.00.01");
  assert.deepEqual(searchKleCatalog(local, { query: "service" }).results.map(({ code }) => code), ["DEMO.00.02", "DEMO.00.03", "DEMO.00.04", "DEMO.00.01"]);
  const reversed = createKleSearchIndex(catalog([...local.rows.map(({ entry: value }) => value)].reverse()));
  assert.deepEqual(searchKleCatalog(local, { query: "service" }), searchKleCatalog(reversed, { query: "service" }));
});

test("retired entries and unavailable catalogues are never offered, while groups stay separate", () => {
  assert.equal(search("DEMO.00.04").total, 0);
  assert.equal(search("").total, 4);
  assert.equal(search("DEMO.00").results[0].level, "group");
  const unavailable = structuredClone(SYNTHETIC_KLE_CATALOG);
  unavailable.source.status = "unavailable";
  assert.equal(searchKleCatalog(createKleSearchIndex(unavailable), { query: "" }).total, 0);
});

test("bounded paging has accurate totals, no duplicates and predictable final pages", () => {
  const first = search("", { limit: 2 }); const second = search("", { offset: 2, limit: 2 });
  assert.equal(first.total, 4); assert.equal(first.hasMore, true);
  assert.equal(second.total, 4); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.results, ...second.results].map(({ uuid }) => uuid)).size, 4);
  assert.equal(search("", { offset: 100 }).results.length, 0);
  assert.equal(search("", { offset: 100 }).hasMore, false);
  assert.equal(search("  login  ").query, "login");
  for (const request of [
    { query: "x".repeat(KLE_SEARCH_LIMITS.query + 1) }, { query: "\u0000" }, { query: 1 },
    { query: "", offset: -1 }, { query: "", offset: 0.5 }, { query: "", offset: Infinity },
    { query: "", limit: 0 }, { query: "", limit: 51 }, { query: "", limit: 1.5 },
  ]) assert.throws(() => searchKleCatalog(index, request), RangeError);
});

test("search snapshots and returned entries do not mutate catalogue or subsequent results", () => {
  const source = structuredClone(SYNTHETIC_KLE_CATALOG); const local = createKleSearchIndex(source);
  source.entries[2].keywords.push("changed"); source.entries[2].title = "Changed title";
  assert.equal(searchKleCatalog(local, { query: "changed" }).total, 0);
  const result = searchKleCatalog(local, { query: "login" });
  result.results[0].keywords.push("modified"); result.results[0].title = "Modified";
  assert.notEqual(searchKleCatalog(local, { query: "login" }).results[0].title, "Modified");
  assert.equal(searchKleCatalog(local, { query: "modified" }).total, 0);
  const invalid = structuredClone(source); invalid.entries[2].code = "bad-code";
  assert.throws(() => createKleSearchIndex(invalid), /ugyldigt/u);
});

test("search-only metadata does not invalidate a reviewed selection", () => {
  const review = { ...createEmptyKleReview(), selectedCodes: [{ uuid: SYNTHETIC_KLE_CATALOG.entries[2].uuid, code: "DEMO.00.02" }] };
  const before = getKleInputBinding(review, SYNTHETIC_KLE_CATALOG, SYNTHETIC_KL_TASK_CATALOG);
  const updated = structuredClone(SYNTHETIC_KLE_CATALOG);
  updated.entries[2].keywords = ["new search term"]; updated.entries[2].description = "A new search description.";
  assert.equal(getKleInputBinding(review, updated, SYNTHETIC_KL_TASK_CATALOG), before);
});

test("a large invented catalogue indexes and pages deterministically without bundling official data", () => {
  const source = { ...SYNTHETIC_KLE_CATALOG.source, kind: "licensed", id: "invented-stress-test", label: "Invented records, licensed-format validation only" };
  const entries = Array.from({ length: 20_000 }, (_, number) => ({
    uuid: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    code: `${String(Math.floor(number / 10_000)).padStart(2, "0")}.${String(Math.floor(number / 100) % 100).padStart(2, "0")}.${String(number % 100).padStart(2, "0")}`,
    title: `Invented record ${number}`, level: "topic", retired: false, keywords: [number % 2 ? "odd" : "even"],
  }));
  const local = createKleSearchIndex({ source, entries });
  const middle = searchKleCatalog(local, { query: "even", offset: 5000, limit: 50 });
  assert.equal(middle.total, 10_000); assert.equal(middle.results.length, 50); assert.equal(middle.hasMore, true);
  assert.equal(middle.results[0].code, "01.00.00");
  assert.equal(searchKleCatalog(local, { query: "00.00.02" }).results[0].code, "00.00.02");
  assert.equal(searchKleCatalog(local, { query: "even", offset: 9999, limit: 50 }).hasMore, false);
});
