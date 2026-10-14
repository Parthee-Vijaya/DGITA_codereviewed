/** A versioned display snapshot; it never replaces the applicant's legacy text. */
export type ApplicationKleSelection = {
  schemaVersion: 1;
  source: { id: string; version: string; label: string; kind: "synthetic" | "licensed" };
  entries: { uuid: string; code: string; title: string }[];
};

export const MAX_APPLICATION_KLE_ENTRIES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function label(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Shape-only validation also supports immutable snapshots from older publications. */
export function isApplicationKleSelection(value: unknown): value is ApplicationKleSelection {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "source", "entries"]) || value.schemaVersion !== 1) return false;
  const source = value.source;
  if (!record(source) || !exactKeys(source, ["id", "version", "label", "kind"])) return false;
  if (!label(source.id, 200) || !label(source.version, 200) || !label(source.label, 500) || !["synthetic", "licensed"].includes(source.kind as string)) return false;
  if (!Array.isArray(value.entries) || value.entries.length > MAX_APPLICATION_KLE_ENTRIES) return false;
  const uuids = new Set<string>(); const codes = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || !exactKeys(entry, ["uuid", "code", "title"])) return false;
    if (!label(entry.uuid, 36) || !UUID.test(entry.uuid) || !label(entry.code, 32) || !label(entry.title, 500)) return false;
    if (uuids.has(entry.uuid.toLowerCase()) || codes.has(entry.code)) return false;
    uuids.add(entry.uuid.toLowerCase()); codes.add(entry.code);
  }
  return true;
}

export function applicationKleSummaryRows(selection: ApplicationKleSelection | null | undefined): [string, string][] {
  if (!selection || selection.entries.length === 0) return [];
  return [
    ["KLE-kilde og version", `${selection.source.label} · ${selection.source.version}${selection.source.kind === "synthetic" ? " (eksempeldata)" : ""}`],
    ["Valgte KLE-emner", selection.entries.map((entry) => `${entry.code} – ${entry.title}`).join("; ")],
  ];
}
