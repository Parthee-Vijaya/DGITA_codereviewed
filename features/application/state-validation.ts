import type { CatalogRelation } from "../catalog/relations";
import {
  initialApplicationState,
  type ApplicationFormState,
  type AttachmentDraft,
  type SelectedCatalogSystem,
  type UploadKind,
} from "./engine";

const YES_NO_FIELDS = new Set<keyof ApplicationFormState>([
  "knownSystem",
  "replacesExisting",
  "existsInKitos",
  "municipalityAlreadyUsesSystem",
  "marketResearch",
  "existingProcessSystem",
  "crossCutting",
  "hasBudget",
  "hasRiskAssessment",
  "needsRiskHelp",
  "personalData",
  "hasDpa",
  "hasContract",
  "hasSupplierChecklist",
  "hasArchitecture",
  "checklistJournalized",
]);

const UPLOAD_KINDS: UploadKind[] = [
  "risk-assessment",
  "data-processing-agreement",
  "contract",
  "supplier-checklist",
  "architecture",
];

const RELATION_KEYS = ["replacementCatalogRelation", "relatedCatalogRelation"] as const;
const APPLICATION_STATE_KEYS = Object.keys(initialApplicationState);
const CATALOG_REQUIRED_KEYS = [
  "id",
  "name",
  "supplier",
  "rightsHolder",
  "source",
  "usedInKalundborg",
] as const;
const CATALOG_OPTIONAL_KEYS = ["localSystemId", "localStatus", "kitosStatus"] as const;
const ATTACHMENT_REQUIRED_KEYS = ["id", "kind", "name", "size", "type", "status"] as const;
const ATTACHMENT_OPTIONAL_KEYS = ["error"] as const;

/**
 * Validates the complete persisted dgita-v1 shape without applying business
 * required-field rules. Drafts may be incomplete, but every field must have
 * the expected runtime type so a saved draft can always be rendered safely.
 */
export function isApplicationFormState(value: unknown): value is ApplicationFormState {
  if (!isRecord(value) || !hasOnlyKeys(value, APPLICATION_STATE_KEYS)) return false;
  if (!APPLICATION_STATE_KEYS.filter((key) => !RELATION_KEYS.includes(key as typeof RELATION_KEYS[number])).every((key) => Object.hasOwn(value, key))) return false;
  if (!RELATION_KEYS.every((key) => isCatalogRelation(value[key]))) return false;
  if (value.schemaVersion !== "dgita-v1") return false;
  if (!isSelectedCatalogSystem(value.selectedSystem)) return false;
  if (!isAttachmentMap(value.attachments)) return false;
  if (value.acquisitionType !== "nyanskaffelse" && value.acquisitionType !== "tilkøb") {
    return false;
  }

  const template = initialApplicationState as unknown as Record<string, unknown>;
  for (const key of APPLICATION_STATE_KEYS) {
    if (
      RELATION_KEYS.includes(key as typeof RELATION_KEYS[number]) ||
      key === "schemaVersion" ||
      key === "selectedSystem" ||
      key === "attachments" ||
      key === "acquisitionType"
    ) {
      continue;
    }
    const actual = value[key];
    if (YES_NO_FIELDS.has(key as keyof ApplicationFormState)) {
      if (actual !== "ja" && actual !== "nej") return false;
      continue;
    }
    const expected = template[key];
    if (typeof expected === "string" && typeof actual !== "string") return false;
    if (typeof expected === "boolean" && typeof actual !== "boolean") return false;
    if (Array.isArray(expected) && !isStringArray(actual)) return false;
  }
  return true;
}

/**
 * Restores fields intentionally removed from a submitted snapshot while
 * retaining only the known dgita-v1 contract. This is used when a rejected,
 * immutable snapshot becomes the starting point for a correction draft.
 */
export function normalizePersistedApplicationFormState(
  value: unknown,
): ApplicationFormState | null {
  if (!isRecord(value) || value.schemaVersion !== "dgita-v1") return null;

  const defaults = structuredClone(initialApplicationState) as unknown as Record<string, unknown>;
  const candidate = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of APPLICATION_STATE_KEYS) {
    normalized[key] = Object.hasOwn(candidate, key) ? candidate[key] : defaults[key];
  }
  // Older test fixtures used display casing for the catalog source. Normalize
  // this known representation only; new API input remains strictly validated.
  if (isRecord(normalized.selectedSystem) && typeof normalized.selectedSystem.source === "string") {
    normalized.selectedSystem = { ...normalized.selectedSystem, source: normalized.selectedSystem.source.toLowerCase() };
  }

  return isApplicationFormState(normalized)
    ? normalized
    : null;
}

function isSelectedCatalogSystem(value: unknown): value is SelectedCatalogSystem | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [...CATALOG_REQUIRED_KEYS, ...CATALOG_OPTIONAL_KEYS])) return false;
  if (!CATALOG_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key))) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.supplier !== "string" ||
    typeof value.rightsHolder !== "string" ||
    typeof value.usedInKalundborg !== "boolean" ||
    (value.source !== "kitos" && value.source !== "kalundborg" && value.source !== "both")
  ) {
    return false;
  }
  return CATALOG_OPTIONAL_KEYS.every(
    (key) => !Object.hasOwn(value, key) || typeof value[key] === "string",
  );
}

function isAttachmentMap(value: unknown): value is ApplicationFormState["attachments"] {
  if (!isRecord(value) || !hasExactKeys(value, UPLOAD_KINDS)) return false;
  return UPLOAD_KINDS.every(
    (kind) => Array.isArray(value[kind]) && value[kind].every((item) => isAttachment(item, kind)),
  );
}

function isAttachment(value: unknown, expectedKind: UploadKind): value is AttachmentDraft {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [...ATTACHMENT_REQUIRED_KEYS, ...ATTACHMENT_OPTIONAL_KEYS])) return false;
  if (!ATTACHMENT_REQUIRED_KEYS.every((key) => Object.hasOwn(value, key))) return false;
  if (
    typeof value.id !== "string" ||
    value.kind !== expectedKind ||
    typeof value.name !== "string" ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    typeof value.type !== "string" ||
    !["selected", "uploading", "uploaded", "failed"].includes(value.status as string)
  ) {
    return false;
  }
  return !Object.hasOwn(value, "error") || typeof value.error === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isCatalogRelation(value: unknown): value is CatalogRelation | null | undefined {
  if (value === null || value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "manual") return hasExactKeys(value, ["kind", "reason"]) && typeof value.reason === "string" && value.reason.length <= 2000;
  return value.kind === "catalog" && hasExactKeys(value, ["kind", "id", "name", "revision"]) &&
    typeof value.id === "string" && value.id.length <= 200 &&
    typeof value.name === "string" && value.name.length <= 500 &&
    typeof value.revision === "string" && value.revision.length <= 100;
}
