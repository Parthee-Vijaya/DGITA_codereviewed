import test from "node:test";
import assert from "node:assert/strict";
import { createKleCatalogProvider, previewKleProvider } from "../features/kle/provider.ts";
import { readKleSearchParameters } from "../features/kle/search-request.ts";
import { SYNTHETIC_KLE_CATALOG } from "../features/kle/synthetic.ts";

const officialShape = () => ({ source: { id: "fictional-import", label: "Invented test source", version: "test-1", kind: "licensed", status: "available", acceptedForUse: false },
  entries: [{ uuid: "00000000-0000-4000-8000-000000000001", code: "99.99.99", title: "Opdigtet testemne", level: "topic", retired: false }] });

test("a prepared licensed package cannot become a search provider without explicit source acceptance", () => {
  assert.throws(() => createKleCatalogProvider(officialShape()), /ikke accepteret/u);
  const accepted = officialShape(); accepted.source.acceptedForUse = true;
  assert.equal(createKleCatalogProvider(accepted).search({ query: "99.99.99" }).results.length, 1);
  accepted.source.status = "unavailable";
  assert.throws(() => createKleCatalogProvider(accepted), /ikke accepteret/u);
  assert.equal(previewKleProvider.catalog.source.kind, "synthetic");
  assert.equal(previewKleProvider.catalog.source.acceptedForUse, false);
});

test("published search data cannot be changed through the input, catalog or returned result", () => {
  const original = structuredClone(SYNTHETIC_KLE_CATALOG);
  const provider = createKleCatalogProvider(original);
  original.entries[1].title = "corrupted-input";
  const first = provider.search({ query: "DEMO.00.01" });
  first.results[0].title = "corrupted-response";
  first.source.version = "corrupted-version";
  assert.throws(() => { provider.catalog.entries[1].title = "mutated-publication"; }, TypeError);
  assert.equal(provider.search({ query: "corrupted" }).total, 0);
  assert.equal(provider.search({ query: "DEMO.00.01" }).source.version, SYNTHETIC_KLE_CATALOG.source.version);
});

test("search parameters reject extra fields, control characters and excessive or malformed pages", () => {
  assert.deepEqual(readKleSearchParameters({ query: "  fælles login  " }), { query: "  fælles login  ", offset: 0, limit: 20 });
  for (const value of [{}, { query: 12 }, { query: "x".repeat(257) }, { query: "x\ny" }, { query: "x", source: "licensed" },
    { query: "x", offset: -1 }, { query: "x", offset: 0.5 }, { query: "x", offset: "0" },
    { query: "x", limit: 0 }, { query: "x", limit: 51 }, { query: "x", limit: 1.5 }, { query: "x", limit: null }]) {
    assert.throws(() => readKleSearchParameters(value), (error) => error.status === 400 && error.code === "INVALID_KLE_SEARCH");
  }
});
