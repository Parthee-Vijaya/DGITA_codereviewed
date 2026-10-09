import {
  COMMENTABLE_APPLICATION_FIELDS,
  D_GITA_LEGAL_BASES,
  D_GITA_PHASES,
  normalizeDgitaApproval,
  type DgitaApproval,
  type FieldComment,
  type ContentEntry,
  type ImageEntry,
  CONTENT_CATEGORY_LABELS,
  isSafeContentUrl,
  isSafeImageUrl,
} from "./model";

const YES_NO_OR_EMPTY = new Set(["", "Ja", "Nej"]);
const LEGAL_BASES = new Set<string>(["", ...D_GITA_LEGAL_BASES]);
const PHASES = new Set<string>(D_GITA_PHASES);
const FIELD_LABELS = new Map<string, string>(
  COMMENTABLE_APPLICATION_FIELDS.map((field) => [field.id, field.label]),
);

export function normalizeContentInput(value: unknown): ContentEntry {
  const input = objectInput(value, "Indholdet er ugyldigt.");
  const id = boundedString(input.id, "Indholds-id", 160);
  const title = boundedString(input.title, "Titel", 500).trim();
  const body = boundedString(input.body, "Tekst", 60_000).trim();
  const location = boundedString(input.location, "Placering", 300);
  const category = enumString(input.category, new Set(Object.keys(CONTENT_CATEGORY_LABELS)), "Indholdstypen er ugyldig.") as ContentEntry["category"];
  if (!id || !title || !body || typeof input.published !== "boolean") throw new WorkspaceInputError(422, "Titel, tekst og publiceringsstatus skal være gyldige.");
  const url = input.url === undefined ? undefined : boundedString(input.url, "Link", 2048);
  if (url && !isSafeContentUrl(url)) throw new WorkspaceInputError(422, "Linkadressen er ikke tilladt.");
  return { id, title, body, location, category, published: input.published, ...(url !== undefined ? { url } : {}) };
}

export function normalizeImageInput(value: unknown): ImageEntry {
  const input = objectInput(value, "Billedet er ugyldigt.");
  const id = boundedString(input.id, "Billed-id", 160);
  const src = boundedString(input.src, "Billede", 6_000_000);
  const alt = boundedString(input.alt, "Alttekst", 1000).trim();
  const location = boundedString(input.location, "Placering", 300);
  if (!id || !alt || !isSafeImageUrl(src)) throw new WorkspaceInputError(422, "Billede eller alttekst er ugyldig.");
  return { id, src, alt, location };
}

export class WorkspaceInputError extends Error {
  constructor(
    readonly status: 400 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceInputError";
  }
}

export type ApplicationLifecycle = {
  status:
    | "draft"
    | "submitted"
    | "under_review"
    | "approved"
    | "rejected"
    | "closed";
  phase: DgitaApproval["phase"];
  closedAt: string | null;
};

export function normalizeDgitaApprovalInput(value: unknown): DgitaApproval {
  const input = objectInput(value, "D-GITA-felterne er ugyldige.");
  const approved = enumString(input.approved, YES_NO_OR_EMPTY, "D-GITA-beslutningen er ugyldig.");
  const date = boundedString(input.date, "Datoen", 10);
  const legalBasis = enumString(input.legalBasis, LEGAL_BASES, "Lovgrundlaget er ugyldigt.");
  const responsible = boundedString(input.responsible, "D-GITA-ansvarlig", 240);
  const hasAdditionalResponsible = enumString(
    input.hasAdditionalResponsible,
    YES_NO_OR_EMPTY,
    "Valget for flere D-GITA-ansvarlige er ugyldigt.",
  );
  const additionalResponsible = boundedString(
    input.additionalResponsible,
    "Yderligere D-GITA-ansvarlige",
    1_000,
  );
  const itConsultant = boundedString(input.itConsultant, "IT-konsulent", 240);
  const infrastructureChanges = enumString(
    input.infrastructureChanges,
    YES_NO_OR_EMPTY,
    "Valget for infrastrukturændringer er ugyldigt.",
  );
  const infrastructureDescription = boundedString(
    input.infrastructureDescription ?? "",
    "Beskrivelse af infrastrukturændringer",
    8_000,
  ).trim();
  const notes = boundedString(input.notes, "Bemærkninger", 8_000);
  const internalComments = boundedString(
    input.internalComments,
    "Interne kommentarer",
    8_000,
  );
  const phase = enumString(input.phase, PHASES, "D-GITA-fasen er ugyldig.");

  if (date && !isCalendarDate(date)) {
    throw new WorkspaceInputError(422, "Datoen skal være en gyldig dato i formatet ÅÅÅÅ-MM-DD.");
  }
  if (hasAdditionalResponsible === "Ja" && !additionalResponsible.trim()) {
    throw new WorkspaceInputError(
      422,
      "Angiv mindst én yderligere D-GITA-ansvarlig.",
    );
  }
  if (infrastructureChanges === "Ja" && !infrastructureDescription) {
    throw new WorkspaceInputError(422, "Beskriv ændringerne i infrastrukturen.");
  }

  return normalizeDgitaApproval({
    approved: approved as DgitaApproval["approved"],
    date,
    legalBasis: legalBasis as DgitaApproval["legalBasis"],
    responsible,
    hasAdditionalResponsible:
      hasAdditionalResponsible as DgitaApproval["hasAdditionalResponsible"],
    additionalResponsible,
    itConsultant,
    infrastructureChanges:
      infrastructureChanges as DgitaApproval["infrastructureChanges"],
    infrastructureDescription,
    notes,
    internalComments,
    phase: phase as DgitaApproval["phase"],
  });
}

export function lifecycleForDgitaApproval(
  approval: DgitaApproval,
  application: {
    status: string;
    currentVersionId: string | null;
  },
  now: string,
): ApplicationLifecycle {
  if (application.status === "changes_requested") {
    throw new WorkspaceInputError(409, "Anmoderen skal genindsende rettelserne, før D-GITA kan fortsætte behandlingen.");
  }
  if (!application.currentVersionId && (approval.phase !== "Kladde" || approval.approved)) {
    throw new WorkspaceInputError(409, "Ansøgningen skal være indsendt og versionslåst, før D-GITA kan behandle den.");
  }
  if (application.status === "closed") {
    throw new WorkspaceInputError(
      409,
      "Den afsluttede sag er låst og kan ikke genåbnes fra D-GITA-felterne.",
    );
  }
  if (approval.phase === "Kladde" && application.currentVersionId) {
    throw new WorkspaceInputError(
      422,
      "En indsendt ansøgning kan ikke flyttes tilbage til kladde.",
    );
  }
  if (approval.approved && !application.currentVersionId) {
    throw new WorkspaceInputError(
      409,
      "D-GITA kan først træffe en beslutning, når ansøgningen er versionslåst.",
    );
  }
  if (approval.phase === "Afsluttet") {
    if (!approval.approved) {
      throw new WorkspaceInputError(
        422,
        "Vælg Ja eller Nej i D-GITA-beslutningen, før sagen afsluttes.",
      );
    }
    if (!application.currentVersionId) {
      throw new WorkspaceInputError(
        409,
        "Sagen kan først afsluttes, når ansøgningen er versionslåst.",
      );
    }
    return { status: "closed", phase: "Afsluttet", closedAt: now };
  }
  if (approval.approved === "Ja") {
    return { status: "approved", phase: approval.phase, closedAt: null };
  }
  if (approval.approved === "Nej") {
    return { status: "rejected", phase: approval.phase, closedAt: null };
  }
  if (approval.phase === "Under behandling") {
    return { status: "under_review", phase: approval.phase, closedAt: null };
  }
  if (approval.phase === "Indsendt") {
    return { status: "submitted", phase: approval.phase, closedAt: null };
  }
  return { status: "draft", phase: "Kladde", closedAt: null };
}

export function normalizeFieldCommentInput(value: unknown): Pick<
  FieldComment,
  "id" | "caseId" | "fieldId" | "fieldLabel" | "body" | "visibility"
> {
  const input = objectInput(value, "Feltkommentaren er ugyldig.");
  const id = boundedString(input.id, "Kommentar-id", 64);
  if (!isUuid(id)) {
    throw new WorkspaceInputError(422, "Kommentar-id'et er ugyldigt.");
  }
  const caseId = boundedString(input.caseId, "Sagsnummeret", 64).toUpperCase();
  if (!/^ITA-\d{6,8}$/u.test(caseId)) {
    throw new WorkspaceInputError(422, "Sagsnummeret er ugyldigt.");
  }
  const fieldId = boundedString(input.fieldId, "Felt-id", 80);
  const fieldLabel = FIELD_LABELS.get(fieldId);
  if (!fieldLabel) {
    throw new WorkspaceInputError(422, "Det valgte ansøgningsfelt er ugyldigt.");
  }
  const body = boundedString(input.body, "Kommentaren", 8_000).trim();
  if (!body) {
    throw new WorkspaceInputError(422, "Kommentaren er tom.");
  }
  if (input.visibility !== "applicant" && input.visibility !== "internal") {
    throw new WorkspaceInputError(422, "Kommentarens synlighed er ugyldig.");
  }
  return {
    id,
    caseId,
    fieldId,
    fieldLabel,
    body,
    visibility: input.visibility,
  };
}

export function normalizeWorkspaceCaseId(value: unknown) {
  if (typeof value !== "string") {
    throw new WorkspaceInputError(400, "Sagsnummeret mangler.");
  }
  const caseId = value.trim().toUpperCase();
  if (!/^ITA-\d{6,8}$/u.test(caseId)) {
    throw new WorkspaceInputError(422, "Sagsnummeret er ugyldigt.");
  }
  return caseId;
}

function objectInput(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceInputError(400, message);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new WorkspaceInputError(400, `${label} mangler eller er ugyldig.`);
  }
  if (value.length > maxLength) {
    throw new WorkspaceInputError(422, `${label} er for lang.`);
  }
  return value;
}

function enumString(value: unknown, allowed: ReadonlySet<string>, message: string) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new WorkspaceInputError(422, message);
  }
  return value;
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
