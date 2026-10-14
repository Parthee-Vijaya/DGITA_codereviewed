/** Manual task mapping. These states describe source matches, never legal scope or approval. */
export type KleMatchState = "direct" | "possible" | "no-match" | "incomplete";
export type LocalCriticalityLevel = "needs-clarification" | "low" | "medium" | "high" | "critical";

export type KleSource = {
  id: string;
  version: string;
  label: string;
  kind: "synthetic" | "licensed";
  status: "available" | "unavailable";
  acceptedForUse: boolean;
};
export type KleCodeReference = { uuid: string; code: string };
export type KleCatalogEntry = KleCodeReference & {
  title: string;
  level: "group" | "topic";
  retired: boolean;
};
export type KleCatalog = { source: KleSource; entries: readonly KleCatalogEntry[] };
export type KlTask = {
  id: string;
  title: string;
  codeReferences: readonly { kleUuid: string; code: string; match: "direct" | "possible" }[];
};
export type KlTaskCatalog = { source: KleSource; tasks: readonly KlTask[] };
export type KleReview = {
  schemaVersion: 1;
  selectedCodes: KleCodeReference[];
  localTaskDescription: string;
  /** Historical free text is retained as free text, never silently converted to verified codes. */
  legacyTopics: string[];
  localAssessment?: {
    level: LocalCriticalityLevel;
    rationale: string;
    inputBinding: string;
  };
  /** The server supplies actor/time. A matching binding is not proof of the actor's identity. */
  confirmation?: { inputBinding: string; confirmedBy: string; confirmedAt: string };
};
export type KleTaskMatch = {
  taskId: string;
  taskTitle: string;
  kleUuid: string;
  code: string;
  match: "direct" | "possible";
};
export type KleEvaluation = {
  state: KleMatchState;
  matches: KleTaskMatch[];
  issues: string[];
  confirmationCurrent: boolean;
  assessmentCurrent: boolean;
  synthetic: boolean;
  /** Only source acceptance; this is not a production, NIS2 or security approval. */
  sourceReadyForProduction: boolean;
};

export const KLE_LIMITS = {
  selectedCodes: 50,
  legacyTopics: 50,
  text: 2000,
  legacyTopic: 256,
  binding: 65536,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/iu;
const LEVELS: readonly LocalCriticalityLevel[] = ["needs-clarification", "low", "medium", "high", "critical"];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const key = (value: KleCodeReference) => `${value.uuid}:${value.code}`;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((name) => keys.includes(name));
}
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === "string" && value.length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
}
function isCodeReference(value: unknown): value is KleCodeReference {
  return object(value) && onlyKeys(value, ["uuid", "code"]) && text(value.uuid, 36) && UUID.test(value.uuid) && text(value.code, 64) && CODE.test(value.code);
}

/** Accept incomplete drafts while rejecting unexpected fields and unbounded/untyped input. */
export function isKleReview(value: unknown): value is KleReview {
  if (!object(value) || !onlyKeys(value, ["schemaVersion", "selectedCodes", "localTaskDescription", "legacyTopics", "localAssessment", "confirmation"])) return false;
  if (value.schemaVersion !== 1 || !text(value.localTaskDescription, KLE_LIMITS.text, true)) return false;
  if (!Array.isArray(value.selectedCodes) || value.selectedCodes.length > KLE_LIMITS.selectedCodes || !value.selectedCodes.every(isCodeReference)) return false;
  const codes = value.selectedCodes as KleCodeReference[];
  // Each UUID and each code must identify exactly one selected entry.
  if (new Set(codes.map((item) => item.uuid.toLowerCase())).size !== codes.length || new Set(codes.map((item) => item.code)).size !== codes.length) return false;
  if (!Array.isArray(value.legacyTopics) || value.legacyTopics.length > KLE_LIMITS.legacyTopics || !value.legacyTopics.every((item) => text(item, KLE_LIMITS.legacyTopic))) return false;
  if (new Set(value.legacyTopics).size !== value.legacyTopics.length) return false;
  if (value.localAssessment !== undefined) {
    const assessment = value.localAssessment;
    if (!object(assessment) || !onlyKeys(assessment, ["level", "rationale", "inputBinding"]) || !LEVELS.includes(assessment.level as LocalCriticalityLevel) || !text(assessment.rationale, KLE_LIMITS.text, true) || !text(assessment.inputBinding, KLE_LIMITS.binding)) return false;
  }
  if (value.confirmation !== undefined) {
    const confirmation = value.confirmation;
    if (!object(confirmation) || !onlyKeys(confirmation, ["inputBinding", "confirmedBy", "confirmedAt"]) || !text(confirmation.inputBinding, KLE_LIMITS.binding) || !text(confirmation.confirmedBy, 200) || !confirmation.confirmedBy.trim() || !text(confirmation.confirmedAt, 32)) return false;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(confirmation.confirmedAt) || !Number.isFinite(Date.parse(confirmation.confirmedAt))) return false;
    if (new Date(confirmation.confirmedAt).toISOString() !== confirmation.confirmedAt) return false;
  }
  return true;
}

export function createEmptyKleReview(legacyTopics: readonly string[] = []): KleReview {
  return { schemaVersion: 1, selectedCodes: [], localTaskDescription: "", legacyTopics: [...new Set(legacyTopics)] };
}

function findMatches(review: KleReview, taskCatalog: KlTaskCatalog): KleTaskMatch[] {
  const selected = new Set(review.selectedCodes.map(key));
  const matches = taskCatalog.tasks.flatMap((task) => task.codeReferences
    .filter((reference) => selected.has(key({ uuid: reference.kleUuid, code: reference.code })))
    .map((reference) => ({ taskId: task.id, taskTitle: task.title, kleUuid: reference.kleUuid, code: reference.code, match: reference.match })));
  return matches.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
}

/** Canonical snapshot, not a cryptographic signature or an authorization mechanism. */
export function getKleInputBinding(review: KleReview, catalog: KleCatalog, taskCatalog: KlTaskCatalog): string {
  const selectedCodes = review.selectedCodes.map(({ uuid, code }) => ({ uuid, code })).sort((a, b) => compare(key(a), key(b)));
  const selectedKeys = new Set(selectedCodes.map(key));
  const entries = catalog.entries.filter((entry) => selectedKeys.has(key(entry)))
    .map(({ uuid, code, title, level, retired }) => ({ uuid, code, title, level, retired }))
    .sort((a, b) => compare(key(a), key(b)));
  const source = ({ id, version, kind, status, acceptedForUse }: KleSource) => ({ id, version, kind, status, acceptedForUse });
  return JSON.stringify({
    schemaVersion: 1,
    catalogSource: source(catalog.source),
    taskSource: source(taskCatalog.source),
    selectedCodes,
    entries,
    matches: findMatches(review, taskCatalog),
    localTaskDescription: review.localTaskDescription,
    legacyTopics: [...review.legacyTopics].sort(compare),
  });
}

/** Confirmation additionally covers the exact local assessment presented to the confirmer. */
export function getKleConfirmationBinding(review: KleReview, catalog: KleCatalog, taskCatalog: KlTaskCatalog): string {
  const inputBinding = getKleInputBinding(review, catalog, taskCatalog);
  return JSON.stringify({
    bindingVersion: 1,
    // Parse only the JSON produced above, never a client-supplied binding. Keep
    // the inputs once as an object so escaping cannot recursively amplify them.
    inputs: JSON.parse(inputBinding),
    localAssessment: review.localAssessment ? {
      level: review.localAssessment.level,
      rationale: review.localAssessment.rationale,
      assessmentInputCurrent: review.localAssessment.inputBinding === inputBinding,
    } : null,
  });
}

export function evaluateKleReview(review: KleReview, catalog: KleCatalog, taskCatalog: KlTaskCatalog): KleEvaluation {
  const issues: string[] = [];
  const synthetic = catalog.source.kind === "synthetic" || taskCatalog.source.kind === "synthetic";
  const sourceReadyForProduction = [catalog.source, taskCatalog.source].every((source) => source.kind === "licensed" && source.status === "available" && source.acceptedForUse && !!source.id && !!source.version);
  if (!isKleReview(review)) return { state: "incomplete", matches: [], issues: ["Oplysningerne har et ugyldigt format."], confirmationCurrent: false, assessmentCurrent: false, synthetic, sourceReadyForProduction };
  const catalogAvailable = catalog.source.status === "available" && !!catalog.source.id && !!catalog.source.version;
  const taskSourceAvailable = taskCatalog.source.status === "available" && !!taskCatalog.source.id && !!taskCatalog.source.version;
  if (!catalogAvailable) issues.push("KLE-kilden mangler eller er ikke tilgængelig.");
  if (!taskSourceAvailable) issues.push("Kilden til kritiske opgaver mangler eller er ikke tilgængelig.");
  if (!review.selectedCodes.length) issues.push("Vælg mindst ét KLE-emne; tidligere fritekst tæller ikke som bekræftede koder.");
  if (!review.localTaskDescription.trim()) issues.push("Beskriv den lokale opgave, som systemet understøtter.");
  for (const selection of review.selectedCodes) {
    const entries = catalog.entries.filter((entry) => entry.uuid === selection.uuid || entry.code === selection.code);
    if (entries.length !== 1 || entries[0].uuid !== selection.uuid || entries[0].code !== selection.code) issues.push(`Koden ${selection.code} kan ikke identificeres entydigt i den aktuelle KLE-kilde.`);
    else if (entries[0].retired) issues.push(`Koden ${selection.code} er udgået og skal afklares, før den kan bekræftes.`);
  }
  // Exact UUID AND code are required. A group never expands implicitly to its children.
  const matches = catalogAvailable && taskSourceAvailable ? findMatches(review, taskCatalog) : [];
  let state: KleMatchState = matches.some((match) => match.match === "direct") ? "direct" : matches.length ? "possible" : "no-match";
  if (issues.length) state = "incomplete";
  const inputBinding = getKleInputBinding(review, catalog, taskCatalog);
  const assessmentCurrent = state !== "incomplete" && !!review.localAssessment?.rationale.trim() && review.localAssessment.inputBinding === inputBinding;
  const confirmationCurrent = assessmentCurrent && !!review.confirmation && review.confirmation.inputBinding === getKleConfirmationBinding(review, catalog, taskCatalog);
  return { state, matches, issues, confirmationCurrent, assessmentCurrent, synthetic, sourceReadyForProduction };
}
