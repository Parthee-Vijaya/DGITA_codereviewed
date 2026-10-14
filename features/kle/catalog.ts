import type { KleCatalog, KleCatalogEntry, KleSource } from "./domain";

/** Portable, prepared catalogue. Provenance describes an input file, not permission to use it. */
export type KleCatalogPackage = {
  schemaVersion: 1;
  catalog: KleCatalog;
  provenance: {
    sourceUrl: string;
    retrievedAt: string;
    sha256: string;
    format: "kle-rest-xml" | "dgita-kle-catalog-v1";
  };
};

export const KLE_CATALOG_LIMITS = {
  entries: 100_000, title: 500, description: 10_000, keywords: 100, keyword: 256,
  sourceId: 200, version: 200, sourceLabel: 500, sourceUrl: 2048,
  totalText: 30_000_000, totalKeywords: 500_000,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LICENSED_CODES = { "main-group": /^\d{2}$/u, group: /^\d{2}\.\d{2}$/u, topic: /^\d{2}\.\d{2}\.\d{2}$/u };
const SYNTHETIC_CODES = { "main-group": /^DEMO$/u, group: /^DEMO\.\d{2}$/u, topic: /^DEMO\.\d{2}\.\d{2}$/u };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function text(value: unknown, maximum: number, multiline = false): value is string {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  return typeof value === "string" && value.length <= maximum && !controls.test(value);
}
function label(value: unknown, maximum: number): value is string {
  return text(value, maximum) && value.length > 0 && value.trim() === value;
}
function isSource(value: unknown): value is KleSource {
  if (!object(value) || !keys(value, ["id", "version", "label", "kind", "status", "acceptedForUse"])) return false;
  if (!label(value.id, KLE_CATALOG_LIMITS.sourceId) || !label(value.version, KLE_CATALOG_LIMITS.version) || !label(value.label, KLE_CATALOG_LIMITS.sourceLabel)) return false;
  if (value.kind !== "synthetic" && value.kind !== "licensed") return false;
  if (value.status !== "available" && value.status !== "unavailable") return false;
  return typeof value.acceptedForUse === "boolean" && (value.kind !== "synthetic" || !value.acceptedForUse);
}
function isEntry(value: unknown, kind: KleSource["kind"]): value is KleCatalogEntry {
  if (!object(value) || !keys(value, ["uuid", "code", "title", "level", "retired", "keywords", "description"])) return false;
  if (!text(value.uuid, 36) || !UUID.test(value.uuid) || !label(value.title, KLE_CATALOG_LIMITS.title)) return false;
  if (value.level !== "main-group" && value.level !== "group" && value.level !== "topic") return false;
  const codes = kind === "licensed" ? LICENSED_CODES : SYNTHETIC_CODES;
  if (typeof value.code !== "string" || !codes[value.level].test(value.code) || typeof value.retired !== "boolean") return false;
  if (value.description !== undefined && !text(value.description, KLE_CATALOG_LIMITS.description, true)) return false;
  if (value.keywords === undefined) return true;
  return Array.isArray(value.keywords) && value.keywords.length <= KLE_CATALOG_LIMITS.keywords
    && value.keywords.every((keyword) => label(keyword, KLE_CATALOG_LIMITS.keyword))
    && new Set(value.keywords.map((keyword) => keyword.toLocaleLowerCase("da"))).size === value.keywords.length;
}

/** Validate the complete snapshot before publishing an index, including global size/identity limits. */
export function isKleCatalog(value: unknown): value is KleCatalog {
  if (!object(value) || !keys(value, ["source", "entries"]) || !isSource(value.source)) return false;
  if (!Array.isArray(value.entries) || value.entries.length > KLE_CATALOG_LIMITS.entries) return false;
  const uuids = new Set<string>(); const codes = new Set<string>();
  let totalText = 0; let totalKeywords = 0;
  for (const entry of value.entries) {
    if (!isEntry(entry, value.source.kind)) return false;
    const uuid = entry.uuid.toLowerCase();
    if (uuids.has(uuid) || codes.has(entry.code)) return false;
    uuids.add(uuid); codes.add(entry.code);
    totalText += entry.title.length + (entry.description?.length ?? 0);
    for (const keyword of entry.keywords ?? []) totalText += keyword.length;
    totalKeywords += entry.keywords?.length ?? 0;
    if (totalText > KLE_CATALOG_LIMITS.totalText || totalKeywords > KLE_CATALOG_LIMITS.totalKeywords) return false;
  }
  return true;
}

function isSourceUrl(value: unknown): value is string {
  if (!label(value, KLE_CATALOG_LIMITS.sourceUrl)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
function isRetrievedAt(value: unknown): value is string {
  if (!text(value, 24) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function isKleCatalogPackage(value: unknown): value is KleCatalogPackage {
  if (!object(value) || !keys(value, ["schemaVersion", "catalog", "provenance"]) || value.schemaVersion !== 1) return false;
  if (!isKleCatalog(value.catalog) || value.catalog.source.acceptedForUse) return false;
  const provenance = value.provenance;
  if (!object(provenance) || !keys(provenance, ["sourceUrl", "retrievedAt", "sha256", "format"])) return false;
  if (!isSourceUrl(provenance.sourceUrl) || !isRetrievedAt(provenance.retrievedAt)) return false;
  return typeof provenance.sha256 === "string" && /^[0-9a-f]{64}$/u.test(provenance.sha256)
    && (provenance.format === "kle-rest-xml" || provenance.format === "dgita-kle-catalog-v1");
}

/** A fresh copy prevents later input mutation; imported packages never silently grant acceptance. */
export function parseKleCatalogPackage(value: unknown): KleCatalogPackage {
  if (!isKleCatalogPackage(value)) throw new Error("KLE-katalogpakken har et ugyldigt format eller er markeret som godkendt til brug.");
  return {
    schemaVersion: 1,
    catalog: {
      source: { ...value.catalog.source },
      entries: value.catalog.entries.map((entry) => ({ ...entry, uuid: entry.uuid.toLowerCase(), ...(entry.keywords ? { keywords: [...entry.keywords] } : {}) })),
    },
    provenance: { ...value.provenance },
  };
}
