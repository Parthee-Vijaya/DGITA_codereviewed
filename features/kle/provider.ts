import { isKleCatalog } from "./catalog";
import type { KleCatalog } from "./domain";
import { createKleSearchIndex, searchKleCatalog } from "./search";
import { SYNTHETIC_KLE_CATALOG } from "./synthetic";

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** A provider holds one immutable publication, never a mutable remote response. */
export function createKleCatalogProvider(input: KleCatalog) {
  if (!isKleCatalog(input) || input.source.status !== "available" ||
      (input.source.kind === "licensed" && !input.source.acceptedForUse)) {
    throw new Error("KLE-kataloget er ikke accepteret eller tilgængeligt til søgning.");
  }
  const catalog = freezeTree(structuredClone(input));
  const index = createKleSearchIndex(catalog);
  return Object.freeze({
    catalog,
    search(parameters: { query: string; offset?: number; limit?: number }) {
      const result = searchKleCatalog(index, parameters);
      // A caller cannot change a published entry by modifying its response.
      return structuredClone({ source: catalog.source, ...result });
    },
  });
}

// Official packages are prepared offline only. No environment variable or HTTP
// parameter can promote one into this personal synthetic preview.
export const previewKleProvider = createKleCatalogProvider(SYNTHETIC_KLE_CATALOG);
