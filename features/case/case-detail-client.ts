import type {
  ApplicationFormState,
  AttachmentDraft,
  SelectedCatalogSystem,
  UploadKind,
} from "../application/engine";
import { isApplicationKleSelection } from "../application/kle-selection";

export type CaseDetailStatus =
  | "draft"
  | "submitted"
  | "awaiting_leader"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "closed";

export type CaseDetailPhase =
  | "Kladde"
  | "Indsendt"
  | "Under behandling"
  | "Afsluttet";

export type CaseDetailMetadata = {
  id: string;
  caseNumber: string;
  title: string;
  systemName: string | null;
  status: CaseDetailStatus;
  phase: CaseDetailPhase;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  applicantName: string;
  applicantEmail: string;
  consultantName: string | null;
};

export type CaseDetail = {
  case: CaseDetailMetadata;
  snapshot: ApplicationFormState;
};

export class CaseDetailApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CaseDetailApiError";
    this.status = status;
  }
}

export async function getCaseDetail(
  caseNumber: string,
  signal?: AbortSignal,
): Promise<CaseDetail> {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseNumber)}/detail`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    throw await responseError(response);
  }

  return parseCaseDetail(await response.json());
}

function parseCaseDetail(value: unknown): CaseDetail {
  if (!isRecord(value) || !isCaseMetadata(value.case)) {
    throw invalidResponseError();
  }
  if (!isApplicationFormState(value.snapshot)) {
    throw invalidResponseError("Sagens ansøgningsversion er ufuldstændig eller ugyldig.");
  }
  return { case: value.case, snapshot: value.snapshot };
}

function isCaseMetadata(value: unknown): value is CaseDetailMetadata {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.caseNumber) &&
    isNonEmptyString(value.title) &&
    isNullableString(value.systemName) &&
    isCaseStatus(value.status) &&
    isCasePhase(value.phase) &&
    typeof value.versionNumber === "number" &&
    Number.isInteger(value.versionNumber) &&
    value.versionNumber >= 0 &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isNullableString(value.submittedAt) &&
    isNonEmptyString(value.applicantName) &&
    isNonEmptyString(value.applicantEmail) &&
    isNullableString(value.consultantName)
  );
}

const yesNoFields = [
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
] as const satisfies readonly (keyof ApplicationFormState)[];

const stringFields = [
  "replacementSystem",
  "catalogQuery",
  "manualSystemName",
  "businessType",
  "systemDescription",
  "descriptionUrl",
  "supplier",
  "supplierCvr",
  "rightsHolder",
  "rightsHolderCvr",
  "contactPerson",
  "department",
  "dataOwner",
  "systemOwner",
  "contractOwner",
  "systemAdministrators",
  "superUsers",
  "esdhContractUrl",
  "esdhDpaUrl",
  "responsibleOrganization",
  "acquisitionMethod",
  "marketResearchSystems",
  "relatedSystem",
  "purpose",
  "functionDescription",
  "existingProcessSystems",
  "crossFunctionality",
  "budgetAmount",
  "oneTimeCost",
  "yearlyCost",
  "otherCost",
  "benefits",
  "dataClassification",
  "employeeAccess",
  "implementationResources",
  "startDate",
  "endDate",
  "implementationUsers",
  "approvingLeaderId",
  "approvingLeader",
  "remarks",
] as const satisfies readonly (keyof ApplicationFormState)[];

const stringArrayFields = [
  "kleTopics",
  "crossDepartments",
  "milestones",
] as const satisfies readonly (keyof ApplicationFormState)[];

const uploadKinds = [
  "risk-assessment",
  "data-processing-agreement",
  "contract",
  "supplier-checklist",
  "architecture",
] as const satisfies readonly UploadKind[];

function isApplicationFormState(value: unknown): value is ApplicationFormState {
  if (!isRecord(value) || value.schemaVersion !== "dgita-v1") return false;
  if (value.kleSelection !== undefined && value.kleSelection !== null && !isApplicationKleSelection(value.kleSelection)) return false;
  if (
    typeof value.manualCatalogEntry !== "boolean" ||
    typeof value.consent !== "boolean" ||
    (value.acquisitionType !== "nyanskaffelse" &&
      value.acquisitionType !== "tilkøb") ||
    !isSelectedSystem(value.selectedSystem) ||
    !isAttachments(value.attachments)
  ) {
    return false;
  }

  for (const field of yesNoFields) {
    if (value[field] !== "ja" && value[field] !== "nej") return false;
  }
  for (const field of stringFields) {
    if (typeof value[field] !== "string") return false;
  }
  for (const field of stringArrayFields) {
    if (!isStringArray(value[field])) return false;
  }
  return true;
}

function isSelectedSystem(value: unknown): value is SelectedCatalogSystem | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.supplier === "string" &&
    typeof value.rightsHolder === "string" &&
    (value.source === "kitos" ||
      value.source === "kalundborg" ||
      value.source === "both") &&
    typeof value.usedInKalundborg === "boolean" &&
    isOptionalString(value.localSystemId) &&
    isOptionalString(value.localStatus) &&
    isOptionalString(value.kitosStatus)
  );
}

function isAttachments(
  value: unknown,
): value is ApplicationFormState["attachments"] {
  if (!isRecord(value)) return false;
  return uploadKinds.every(
    (kind) => Array.isArray(value[kind]) && value[kind].every(isAttachment),
  );
}

function isAttachment(value: unknown): value is AttachmentDraft {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    uploadKinds.includes(value.kind as UploadKind) &&
    isNonEmptyString(value.name) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.type === "string" &&
    (value.status === "selected" ||
      value.status === "uploading" ||
      value.status === "uploaded" ||
      value.status === "failed") &&
    isOptionalString(value.error)
  );
}

function isCaseStatus(value: unknown): value is CaseDetailStatus {
  return (
    value === "draft" ||
    value === "submitted" ||
    value === "awaiting_leader" ||
    value === "under_review" ||
    value === "changes_requested" ||
    value === "approved" ||
    value === "rejected" ||
    value === "closed"
  );
}

function isCasePhase(value: unknown): value is CaseDetailPhase {
  return (
    value === "Kladde" ||
    value === "Indsendt" ||
    value === "Under behandling" ||
    value === "Afsluttet"
  );
}

async function responseError(response: Response) {
  let message = "Sagen kunne ikke hentes.";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.error === "string") {
      message = payload.error;
    }
  } catch {
    // API-fejl uden JSON bruger den sikre standardbesked.
  }
  return new CaseDetailApiError(message, response.status);
}

function invalidResponseError(
  message = "Serveren returnerede ugyldige sagsdata.",
) {
  return new CaseDetailApiError(message, 502);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
