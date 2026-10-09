/** Internal documentation records. These statuses never establish a legal approval. */
export const ASSESSMENT_STATUSES = ["not-started", "in-progress", "documented"] as const;
export const CONTROLLER_RELATIONS = ["", "processor", "independent-controller", "joint-controller", "not-applicable", "needs-clarification"] as const;
export const ASSESSMENT_NEEDS = ["", "required", "not-required", "needs-clarification"] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];
export type AssessmentMetadata = {
  recordedBy?: string;
  recordedByName?: string;
  recordedAt?: string;
  applicationVersionId?: string | null;
};
export type PrivacyAssessment = AssessmentMetadata & {
  status: AssessmentStatus;
  processingBasis: string;
  controllerRelation: (typeof CONTROLLER_RELATIONS)[number];
  relationReason: string;
  dpaNeed: (typeof ASSESSMENT_NEEDS)[number];
  dpaReason: string;
  dpiaScreening: (typeof ASSESSMENT_NEEDS)[number];
  dpiaReason: string;
  reference: string;
};
export type ProcurementAssessment = AssessmentMetadata & {
  status: AssessmentStatus;
  procedure: string;
  rationale: string;
  reference: string;
  ruleCheckedOn: string;
};

export const CASE_ASSESSMENT_LIMITS = {
  processingBasis: 2_000,
  relationReason: 4_000,
  dpaReason: 4_000,
  dpiaReason: 4_000,
  procedure: 1_000,
  rationale: 4_000,
  reference: 1_000,
  ruleCheckedOn: 10,
} as const;

export const EMPTY_PRIVACY_ASSESSMENT: PrivacyAssessment = {
  status: "not-started", processingBasis: "", controllerRelation: "", relationReason: "",
  dpaNeed: "", dpaReason: "", dpiaScreening: "", dpiaReason: "", reference: "",
};
export const EMPTY_PROCUREMENT_ASSESSMENT: ProcurementAssessment = {
  status: "not-started", procedure: "", rationale: "", reference: "", ruleCheckedOn: "",
};

const PRIVACY_TEXT_FIELDS = ["processingBasis", "relationReason", "dpaReason", "dpiaReason", "reference"] as const;
const PROCUREMENT_TEXT_FIELDS = ["procedure", "rationale", "reference", "ruleCheckedOn"] as const;
const FIELD_LABELS: Record<keyof typeof CASE_ASSESSMENT_LIMITS, string> = {
  processingBasis: "Behandlingsgrundlag", relationReason: "Begrundelse for dataansvar",
  dpaReason: "Begrundelse for databehandleraftale", dpiaReason: "Begrundelse for konsekvensanalyse",
  procedure: "Anskaffelsesprocedure", rationale: "Begrundelse for anskaffelsesprocedure",
  reference: "Dokument- eller journalreference", ruleCheckedOn: "Dato for regelkontrol",
};
const INVALID_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safeString(value: unknown, max: number) {
  return typeof value === "string" && value.length <= max && !INVALID_CONTROLS.test(value) ? value.trim() : "";
}
function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}
function metadata(value: Record<string, unknown>): AssessmentMetadata {
  return {
    ...(safeString(value.recordedBy, 512) ? { recordedBy: safeString(value.recordedBy, 512) } : {}),
    ...(safeString(value.recordedByName, 240) ? { recordedByName: safeString(value.recordedByName, 240) } : {}),
    ...(typeof value.recordedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.recordedAt)
      && Number.isFinite(Date.parse(value.recordedAt)) ? { recordedAt: value.recordedAt } : {}),
    ...(value.applicationVersionId === null ? { applicationVersionId: null }
      : safeString(value.applicationVersionId, 160) ? { applicationVersionId: safeString(value.applicationVersionId, 160) } : {}),
  };
}

/** Safe legacy/UI read projection. Validate raw input separately before every write. */
export function normalizePrivacyAssessment(value: unknown): PrivacyAssessment {
  const input = record(value);
  return {
    status: safeEnum(input.status, ASSESSMENT_STATUSES, "not-started"),
    processingBasis: safeString(input.processingBasis, CASE_ASSESSMENT_LIMITS.processingBasis),
    controllerRelation: safeEnum(input.controllerRelation, CONTROLLER_RELATIONS, ""),
    relationReason: safeString(input.relationReason, CASE_ASSESSMENT_LIMITS.relationReason),
    dpaNeed: safeEnum(input.dpaNeed, ASSESSMENT_NEEDS, ""),
    dpaReason: safeString(input.dpaReason, CASE_ASSESSMENT_LIMITS.dpaReason),
    dpiaScreening: safeEnum(input.dpiaScreening, ASSESSMENT_NEEDS, ""),
    dpiaReason: safeString(input.dpiaReason, CASE_ASSESSMENT_LIMITS.dpiaReason),
    reference: safeString(input.reference, CASE_ASSESSMENT_LIMITS.reference),
    ...metadata(input),
  };
}
export function normalizeProcurementAssessment(value: unknown): ProcurementAssessment {
  const input = record(value);
  return {
    status: safeEnum(input.status, ASSESSMENT_STATUSES, "not-started"),
    procedure: safeString(input.procedure, CASE_ASSESSMENT_LIMITS.procedure),
    rationale: safeString(input.rationale, CASE_ASSESSMENT_LIMITS.rationale),
    reference: safeString(input.reference, CASE_ASSESSMENT_LIMITS.reference),
    ruleCheckedOn: safeString(input.ruleCheckedOn, CASE_ASSESSMENT_LIMITS.ruleCheckedOn),
    ...metadata(input),
  };
}

function baseError(value: unknown, fields: readonly (keyof typeof CASE_ASSESSMENT_LIMITS)[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Vurderingen skal være et gyldigt objekt.";
  const input = record(value);
  if (!ASSESSMENT_STATUSES.includes(input.status as AssessmentStatus)) return "Vælg en gyldig dokumentationsstatus.";
  for (const field of fields) {
    const text = input[field] ?? "";
    if (typeof text !== "string" || input[field] === null) return `${FIELD_LABELS[field]} skal være tekst.`;
    if (text.length > CASE_ASSESSMENT_LIMITS[field]) return `${FIELD_LABELS[field]} må højst være ${CASE_ASSESSMENT_LIMITS[field]} tegn.`;
    if (INVALID_CONTROLS.test(text)) return `${FIELD_LABELS[field]} indeholder ugyldige kontroltegn.`;
  }
  return null;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function concrete(value: string) { return value.trim().length >= 3; }

/** Undefined means absent legacy documentation, never a fabricated assessment. */
export function getPrivacyAssessmentValidationError(value: unknown): string | null {
  if (value === undefined) return null;
  const error = baseError(value, PRIVACY_TEXT_FIELDS);
  if (error) return error;
  const input = record(value);
  if (!CONTROLLER_RELATIONS.includes((input.controllerRelation ?? "") as PrivacyAssessment["controllerRelation"]) || input.controllerRelation === null) {
    return "Vælg en gyldig relation for dataansvar.";
  }
  if (!ASSESSMENT_NEEDS.includes((input.dpaNeed ?? "") as PrivacyAssessment["dpaNeed"]) || input.dpaNeed === null) return "Vælg et gyldigt behov for databehandleraftale.";
  if (!ASSESSMENT_NEEDS.includes((input.dpiaScreening ?? "") as PrivacyAssessment["dpiaScreening"]) || input.dpiaScreening === null) return "Vælg et gyldigt resultat af DPIA-screeningen.";
  const assessment = normalizePrivacyAssessment(value);
  if (assessment.status === "documented") {
    if (!concrete(assessment.processingBasis)) return "Beskriv det konkrete behandlingsgrundlag eller begrundet ikke-relevans før vurderingen markeres som dokumenteret.";
    if (!assessment.controllerRelation || assessment.controllerRelation === "needs-clarification" || !concrete(assessment.relationReason)) return "Afklar dataansvaret og angiv en konkret begrundelse før vurderingen markeres som dokumenteret.";
    if (!assessment.dpaNeed || assessment.dpaNeed === "needs-clarification" || !concrete(assessment.dpaReason)) return "Afklar behovet for databehandleraftale og angiv en konkret begrundelse.";
    if (!assessment.dpiaScreening || assessment.dpiaScreening === "needs-clarification" || !concrete(assessment.dpiaReason)) return "Afklar DPIA-screeningen og angiv en konkret begrundelse.";
    if (!assessment.reference) return "Angiv en dokument- eller journalreference for databeskyttelsesvurderingen.";
  }
  return null;
}
export function getProcurementAssessmentValidationError(value: unknown): string | null {
  if (value === undefined) return null;
  const error = baseError(value, PROCUREMENT_TEXT_FIELDS);
  if (error) return error;
  const assessment = normalizeProcurementAssessment(value);
  if (assessment.ruleCheckedOn && !validDate(assessment.ruleCheckedOn)) return "Dato for regelkontrol skal være en gyldig dato i formatet ÅÅÅÅ-MM-DD.";
  if (assessment.status === "documented") {
    if (!concrete(assessment.procedure)) return "Beskriv den valgte anskaffelsesprocedure før vurderingen markeres som dokumenteret.";
    if (!concrete(assessment.rationale)) return "Angiv en konkret begrundelse for anskaffelsesproceduren.";
    if (!assessment.reference) return "Angiv en dokument- eller journalreference for anskaffelsesvurderingen.";
    if (!assessment.ruleCheckedOn) return "Angiv datoen for kontrol af de relevante regler.";
  }
  return null;
}

type CaseAssessments = { privacyAssessment?: PrivacyAssessment; procurementAssessment?: ProcurementAssessment };
function assessmentFields<T extends AssessmentMetadata>(value: T): T {
  const fields = { ...value };
  delete fields.recordedBy;
  delete fields.recordedByName;
  delete fields.recordedAt;
  delete fields.applicationVersionId;
  return fields;
}
/** Called only with validated fields and a trusted current-version database snapshot. */
export function recordCaseAssessmentChanges(
  incoming: CaseAssessments, previous: CaseAssessments,
  actor: { userId: string; displayName: string }, applicationVersionId: string | null, now: string,
): CaseAssessments {
  function recordChange<T extends AssessmentMetadata>(value: T | undefined, prior: T | undefined, empty: T): T | undefined {
    // Older clients can omit new optional fields without erasing existing documentation.
    if (value === undefined) return prior;
    const fields = assessmentFields(value);
    const priorFields = assessmentFields(prior ?? empty);
    if (JSON.stringify(fields) === JSON.stringify(priorFields)) return prior ?? empty;
    return { ...fields, recordedBy: actor.userId, recordedByName: actor.displayName, recordedAt: now, applicationVersionId } as T;
  }
  const privacyAssessment = recordChange(incoming.privacyAssessment, previous.privacyAssessment, EMPTY_PRIVACY_ASSESSMENT);
  const procurementAssessment = recordChange(incoming.procurementAssessment, previous.procurementAssessment, EMPTY_PROCUREMENT_ASSESSMENT);
  return {
    ...(privacyAssessment !== undefined ? { privacyAssessment } : {}),
    ...(procurementAssessment !== undefined ? { procurementAssessment } : {}),
  };
}
