import { isKleCatalog } from "./catalog";
import type { KleCatalog, KleCatalogEntry } from "./domain";

export const KLE_SEARCH_LIMITS = { query: 256, limit: 50, defaultLimit: 20 } as const;
type SearchRow = { entry: KleCatalogEntry; code: string; title: string; keywords: string; description: string };
export type KleSearchIndex = { readonly rows: readonly SearchRow[]; readonly available: boolean };
export type KleSearchRequest = { query: string; offset?: number; limit?: number };
export type KleSearchResult = { results: KleCatalogEntry[]; total: number; offset: number; limit: number; hasMore: boolean; query: string };

/** Fold accents and common Danish letter transcriptions without coercing numeric codes. */
function normalize(value: string): string {
  return value.toLocaleLowerCase("da").replace(/æ/gu, "ae").replace(/ø/gu, "oe")
    .normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Build once per source snapshot. Indexing copies records, so caller mutation cannot change matches. */
export function createKleSearchIndex(catalog: KleCatalog): KleSearchIndex {
  if (!isKleCatalog(catalog)) throw new Error("KLE-kataloget har et ugyldigt format.");
  const rows = catalog.entries.filter((entry) => !entry.retired).map((entry) => ({
    entry: { ...entry, ...(entry.keywords ? { keywords: [...entry.keywords] } : {}) },
    code: normalize(entry.code), title: normalize(entry.title),
    keywords: normalize((entry.keywords ?? []).join(" ")), description: normalize(entry.description ?? ""),
  }));
  rows.sort((a, b) => compare(a.entry.code, b.entry.code) || compare(a.title, b.title) || compare(a.entry.uuid, b.entry.uuid));
  return { rows, available: catalog.source.status === "available" };
}

function validateRequest(request: KleSearchRequest): Required<KleSearchRequest> {
  if (typeof request.query !== "string" || request.query.length > KLE_SEARCH_LIMITS.query || /[\u0000-\u001f\u007f]/u.test(request.query)) throw new RangeError("Søgeteksten må højst være 256 tegn og skal være uden kontroltegn.");
  const offset = request.offset ?? 0; const limit = request.limit ?? KLE_SEARCH_LIMITS.defaultLimit;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("Søgningens start skal være et positivt heltal eller nul.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > KLE_SEARCH_LIMITS.limit) throw new RangeError("Søgningen skal vise mellem 1 og 50 resultater ad gangen.");
  return { query: request.query.trim(), offset, limit };
}
function rank(row: SearchRow, query: string): number {
  if (!query) return 0;
  if (row.code === query) return 0;
  if (row.title === query) return 1;
  if (row.code.startsWith(query)) return 2;
  if (row.title.startsWith(query)) return 3;
  if (row.title.includes(query)) return 4;
  if (row.keywords.includes(query)) return 5;
  return 6;
}
function tokenScore(row: SearchRow, tokens: readonly string[]): number {
  return tokens.reduce((score, token) => score + (row.code.includes(token) ? 100 : row.title.includes(token) ? 80 : row.keywords.includes(token) ? 40 : 10), 0);
}

/** Every token must match; no network or user search terms leave this pure local search. */
export function searchKleCatalog(index: KleSearchIndex, request: KleSearchRequest): KleSearchResult {
  const { query, offset, limit } = validateRequest(request);
  const normalized = normalize(query); const tokens = [...new Set(normalized.split(" ").filter(Boolean))];
  const matches = index.available ? index.rows.filter((row) => tokens.every((token) => [row.code, row.title, row.keywords, row.description].some((field) => field.includes(token)))) : [];
  const ranked = matches.map((row, stableOrder) => ({ row, stableOrder, rank: rank(row, normalized), score: tokenScore(row, tokens) }));
  ranked.sort((a, b) => a.rank - b.rank || b.score - a.score || a.stableOrder - b.stableOrder);
  const results = ranked.slice(offset, offset + limit).map(({ row }) => ({ ...row.entry, ...(row.entry.keywords ? { keywords: [...row.entry.keywords] } : {}) }));
  return { results, total: ranked.length, offset, limit, hasMore: offset + results.length < ranked.length, query };
}
