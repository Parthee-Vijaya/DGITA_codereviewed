import { isCatalogRelation } from "../application/state-validation";
import { isAiUsage } from "../application/ai-screening";
import type { CatalogRelation } from "../catalog/relations";
import type {
  ApplicationFormState,
  AttachmentDraft,
  SelectedCatalogSystem,
  UploadKind,
} from "../application/engine";

export type CaseDetailSummary = {
  id: string;
  caseNumber: string;
  title: string;
  systemName: string | null;
  status: string;
  phase: string;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  applicantName: string;
  applicantEmail: string;
  consultantName: string | null;
};

export type CaseDetailResponse = {
  case: CaseDetailSummary;
  snapshot: ApplicationFormState;
};

export type CaseDetailRole = "user" | "consultant" | "admin";

export class CaseDetailError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;

  constructor(status: 400 | 404 | 409, code: string, message: string) {
    super(message);
    this.name = "CaseDetailError";
    this.status = status;
    this.code = code;
  }
}

/** A user query must bind this owner id; privileged tenant roles bind null. */
export function ownerScopeUserId(role: CaseDetailRole, userId: string) {
  return role === "user" ? userId : null;
}

/**
 * Converts the stored JSON to the public v1 form contract. Only known form
 * fields are copied, so injected audit/internal/storage fields cannot escape.
 * Sparse legacy demo records are completed with the canonical form defaults.
 */
export function normalizeApplicationSnapshotJson(
  serialized: string,
  baseState: ApplicationFormState,
  fallbackSystemName?: string | null,
): ApplicationFormState {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw invalidSnapshot();
  }
  if (!isRecord(value)) throw invalidSnapshot();
  if ("schemaVersion" in value && value.schemaVersion !== "dgita-v1") {
    throw new CaseDetailError(
      409,
      "UNSUPPORTED_SNAPSHOT_VERSION",
      "Sagens formularversion understøttes ikke af portalen.",
    );
  }

  const normalized = neutralApplicationState(baseState);
  const target = normalized as unknown as Record<string, unknown>;
  const base = baseState as unknown as Record<string, unknown>;

  for (const [key, baseValue] of Object.entries(base)) {
    if (key === "attachments" || key === "selectedSystem" || key === "schemaVersion" || key === "replacementCatalogRelation" || key === "relatedCatalogRelation") {
      continue;
    }
    const candidate = value[key];
    if (isCompatibleScalarOrStringArray(baseValue, candidate)) {
      target[key] = candidate;
    }
  }

  normalized.schemaVersion = "dgita-v1";
  normalized.selectedSystem = normalizeSelectedSystem(value.selectedSystem);
  normalized.attachments = normalizeAttachments(value.attachments);
  // Additive relation fields are absent from legacy versions. Project null in
  // memory without inventing an id or rewriting any historical snapshot bytes.
  normalized.replacementCatalogRelation = normalizeCatalogRelation(value.replacementCatalogRelation);
  normalized.relatedCatalogRelation = normalizeCatalogRelation(value.relatedCatalogRelation);
  // Missing legacy screening stays unanswered in this read projection. Never
  // infer No or write this default back into immutable historical versions.
  normalized.aiUsage = isAiUsage(value.aiUsage) ? value.aiUsage : "";

  if (value.schemaVersion !== "dgita-v1") {
    const legacy = isRecord(value._demo) ? value._demo : null;
    if (legacy && typeof legacy.leader === "string") {
      normalized.approvingLeader = legacy.leader;
    }
    if (fallbackSystemName) {
      normalized.catalogQuery = fallbackSystemName;
    }
  }

  return normalized;
}

export type SafeDraftAttachment = {
  id: string;
  kind: string;
  original_name: string;
  size_bytes: number;
  content_type: string;
};

export function withSafeDraftAttachments(
  snapshot: ApplicationFormState,
  rows: SafeDraftAttachment[],
) {
  const attachments = emptyAttachments();
  for (const row of rows) {
    if (!isUploadKind(row.kind)) continue;
    attachments[row.kind].push({
      id: row.id,
      kind: row.kind,
      name: row.original_name,
      size: row.size_bytes,
      type: row.content_type,
      status: "uploaded",
    });
  }
  return { ...snapshot, attachments } satisfies ApplicationFormState;
}

function normalizeCatalogRelation(value: unknown): CatalogRelation | null {
  return value && isCatalogRelation(value) ? { ...value } : null;
}

function normalizeSelectedSystem(value: unknown): SelectedCatalogSystem | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.supplier !== "string" ||
    typeof value.rightsHolder !== "string" ||
    (value.source !== "kitos" && value.source !== "kalundborg" && value.source !== "both") ||
    typeof value.usedInKalundborg !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    supplier: value.supplier,
    rightsHolder: value.rightsHolder,
    source: value.source,
    usedInKalundborg: value.usedInKalundborg,
    ...(typeof value.localSystemId === "string" ? { localSystemId: value.localSystemId } : {}),
    ...(typeof value.localStatus === "string" ? { localStatus: value.localStatus } : {}),
    ...(typeof value.kitosStatus === "string" ? { kitosStatus: value.kitosStatus } : {}),
  };
}

function normalizeAttachments(value: unknown) {
  const attachments = emptyAttachments();
  if (!isRecord(value)) return attachments;
  for (const kind of Object.keys(attachments) as UploadKind[]) {
    const files = value[kind];
    if (!Array.isArray(files)) continue;
    attachments[kind] = files.flatMap((file) => {
      const normalized = normalizeAttachment(kind, file);
      return normalized ? [normalized] : [];
    });
  }
  return attachments;
}

function normalizeAttachment(kind: UploadKind, value: unknown): AttachmentDraft | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.size !== "number" ||
    !Number.isFinite(value.size) ||
    value.size < 0 ||
    typeof value.type !== "string" ||
    (value.status !== "selected" &&
      value.status !== "uploading" &&
      value.status !== "uploaded" &&
      value.status !== "failed")
  ) {
    return null;
  }
  return {
    id: value.id,
    kind,
    name: value.name,
    size: value.size,
    type: value.type,
    status: value.status,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function emptyAttachments(): ApplicationFormState["attachments"] {
  return {
    "risk-assessment": [],
    "data-processing-agreement": [],
    contract: [],
    "supplier-checklist": [],
    architecture: [],
  };
}

function isUploadKind(value: string): value is UploadKind {
  return (
    value === "risk-assessment" ||
    value === "data-processing-agreement" ||
    value === "contract" ||
    value === "supplier-checklist" ||
    value === "architecture"
  );
}

function isCompatibleScalarOrStringArray(base: unknown, value: unknown) {
  if (typeof base === "string") return typeof value === "string";
  if (typeof base === "boolean") return typeof value === "boolean";
  if (Array.isArray(base)) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
  return false;
}

function neutralApplicationState(baseState: ApplicationFormState) {
  const neutral: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseState)) {
    if (key === "schemaVersion") {
      neutral[key] = "dgita-v1";
    } else if (key === "attachments") {
      neutral[key] = emptyAttachments();
    } else if (key === "selectedSystem" || key === "replacementCatalogRelation" || key === "relatedCatalogRelation") {
      neutral[key] = null;
    } else if (key === "acquisitionType") {
      neutral[key] = "nyanskaffelse";
    } else if (YES_NO_FIELDS.has(key)) {
      neutral[key] = "nej";
    } else if (typeof value === "boolean") {
      neutral[key] = false;
    } else if (Array.isArray(value)) {
      neutral[key] = [];
    } else {
      neutral[key] = "";
    }
  }
  return neutral as unknown as ApplicationFormState;
}

const YES_NO_FIELDS = new Set([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSnapshot() {
  return new CaseDetailError(
    409,
    "INVALID_CASE_SNAPSHOT",
    "Sagens formularoplysninger er beskadigede eller ufuldstændige.",
  );
}
