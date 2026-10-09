import { relationError, type CatalogRelation, type RelationField } from "../catalog/relations";
import { SYNTHETIC_APPROVERS } from "../workspace/model";

export type YesNo = "ja" | "nej";

export type UploadKind =
  | "risk-assessment"
  | "data-processing-agreement"
  | "contract"
  | "supplier-checklist"
  | "architecture";

export type AttachmentDraft = {
  id: string;
  kind: UploadKind;
  name: string;
  size: number;
  type: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  error?: string;
};

export type SelectedCatalogSystem = {
  id: string;
  name: string;
  supplier: string;
  rightsHolder: string;
  source: "kitos" | "kalundborg" | "both";
  usedInKalundborg: boolean;
  localSystemId?: string;
  localStatus?: string;
  kitosStatus?: string;
};

export const LEGACY_APPROVING_LEADERS = [
  {
    id: "kalundborg-consultant-peter-bjerre",
    name: "Peter Bjerre Ahlgren",
  },
  {
    id: "demo-user-partheepan",
    name: "Partheepan Vijayamohan",
  },
  {
    id: "kalundborg-user-anita-lauridsen",
    name: "Anita Mark Vig Lauridsen",
  },
] as const;

export const APPROVING_LEADERS = SYNTHETIC_APPROVERS;

export type ApplicationFormState = {
  schemaVersion: "dgita-v1";
  knownSystem: YesNo;
  replacesExisting: YesNo;
  replacementSystem: string;
  replacementCatalogRelation?: CatalogRelation | null;
  catalogQuery: string;
  selectedSystem: SelectedCatalogSystem | null;
  manualCatalogEntry: boolean;
  existsInKitos: YesNo;
  municipalityAlreadyUsesSystem: YesNo;
  manualSystemName: string;
  businessType: string;
  systemDescription: string;
  descriptionUrl: string;
  supplier: string;
  supplierCvr: string;
  rightsHolder: string;
  rightsHolderCvr: string;
  contactPerson: string;
  department: string;
  dataOwner: string;
  systemOwner: string;
  contractOwner: string;
  systemAdministrators: string;
  superUsers: string;
  esdhContractUrl: string;
  esdhDpaUrl: string;
  responsibleOrganization: string;
  acquisitionMethod: string;
  marketResearch: YesNo;
  marketResearchSystems: string;
  acquisitionType: "nyanskaffelse" | "tilkøb";
  relatedSystem: string;
  relatedCatalogRelation?: CatalogRelation | null;
  purpose: string;
  functionDescription: string;
  kleTopics: string[];
  existingProcessSystem: YesNo;
  existingProcessSystems: string;
  crossCutting: YesNo;
  crossFunctionality: string;
  crossDepartments: string[];
  hasBudget: YesNo;
  budgetAmount: string;
  oneTimeCost: string;
  yearlyCost: string;
  otherCost: string;
  benefits: string;
  hasRiskAssessment: YesNo;
  needsRiskHelp: YesNo;
  personalData: YesNo;
  hasDpa: YesNo;
  hasContract: YesNo;
  hasSupplierChecklist: YesNo;
  dataClassification: string;
  employeeAccess: string;
  milestones: string[];
  implementationResources: string;
  startDate: string;
  endDate: string;
  implementationUsers: string;
  hasArchitecture: YesNo;
  checklistJournalized: YesNo;
  approvingLeaderId: string;
  approvingLeader: string;
  remarks: string;
  consent: boolean;
  attachments: Record<UploadKind, AttachmentDraft[]>;
};

export type FormRule = {
  id: string;
  sourceField: keyof ApplicationFormState;
  equals: string;
  affectedFields: string[];
  required: boolean;
  sourceReference: string;
};

export type FieldError = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACQUISITION_METHODS = [
  "DIGIT udbud/aftale", "Direkte tildeling", "Gratis", "KOMBIT/KL/Offentligt projekt", "SKI-aftale",
] as const;
export const DATA_CLASSIFICATIONS = [
  "1. Almindelige personoplysninger", "2. Følsomme personoplysninger", "3. Fortrolige oplysninger", "4. CPR data",
] as const;
export const USER_COUNT_OPTIONS = ["0-9", "10-49", "50-99", "100-499", "500-100000"] as const;

const UPLOAD_MIME_TYPES = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
} satisfies Record<string, string[]>;
type UploadExtension = keyof typeof UPLOAD_MIME_TYPES;
const DOCUMENT_EXTENSIONS: readonly UploadExtension[] = ["pdf", "doc", "docx", "xls", "xlsx"];
const ALL_UPLOAD_EXTENSIONS: readonly UploadExtension[] = [...DOCUMENT_EXTENSIONS, "png", "jpg", "jpeg"];

/** The picker, visible guidance and server validation share this policy. */
export function getUploadPolicy(kind: UploadKind) {
  const extensions = kind === "risk-assessment" ? DOCUMENT_EXTENSIONS : ALL_UPLOAD_EXTENSIONS;
  const formats = extensions.map((extension) => extension.toUpperCase()).join(", ");
  return {
    extensions,
    accept: extensions.map((extension) => `.${extension}`).join(","),
    guidance: `${formats} · maks. ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
    invalidTypeMessage: `Vælg en fil af typen ${formats}.`,
  };
}

export const FORM_RULES: FormRule[] = [
  {
    id: "replacement-system",
    sourceField: "replacesExisting",
    equals: "ja",
    affectedFields: ["replacementSystem", "replacementCatalogRelation"],
    required: true,
    sourceReference: "Power Pages: fm_systemerstatning → fm_erstatsningssystem",
  },
  {
    id: "known-system",
    sourceField: "knownSystem",
    equals: "ja",
    affectedFields: ["catalogQuery", "selectedSystem"],
    required: true,
    sourceReference: "Power Pages: fm_forudbestemtsystemvalg → fm_nytsystemnavn",
  },
  {
    id: "market-research",
    sourceField: "marketResearch",
    equals: "ja",
    affectedFields: ["marketResearchSystems"],
    required: true,
    sourceReference: "Power Pages: fm_markedsafdaekning → fm_leverandorafdaekning",
  },
  {
    id: "related-system",
    sourceField: "acquisitionType",
    equals: "tilkøb",
    affectedFields: ["relatedSystem", "relatedCatalogRelation"],
    required: true,
    sourceReference: "Power Pages: fm_nyanskaffelsetilkob → fm_tilknyttetsystemnavn",
  },
  {
    id: "existing-process-system",
    sourceField: "existingProcessSystem",
    equals: "ja",
    affectedFields: ["existingProcessSystems"],
    required: true,
    sourceReference:
      "Power Pages: fm_eksisterendearbejdsprocessystem → fm_aktuelleundersttotendesystemer",
  },
  {
    id: "cross-cutting",
    sourceField: "crossCutting",
    equals: "ja",
    affectedFields: ["crossFunctionality", "crossDepartments"],
    required: true,
    sourceReference:
      "Power Pages: fm_istvaergaaendefunktionalitet → fm_tvaergaaendefunktionalitet/fm_tvaergaaendeenheder",
  },
  {
    id: "responsible-organization",
    sourceField: "municipalityAlreadyUsesSystem",
    equals: "nej",
    affectedFields: ["responsibleOrganization"],
    required: true,
    sourceReference:
      "Power Pages: fm_benytteseksisterendesystem=false → fm_ansvarligorganisation",
  },
  {
    id: "existing-budget",
    sourceField: "hasBudget",
    equals: "ja",
    affectedFields: ["budgetAmount"],
    required: true,
    sourceReference:
      "Power Pages: fm_eksisterendebudgettilraadighed → fm_eksisterendebudgetbelob",
  },
  {
    id: "risk-upload",
    sourceField: "hasRiskAssessment",
    equals: "ja",
    affectedFields: ["risk-assessment"],
    required: false,
    sourceReference: "Power Pages: fm_eksisterenderisikovurdering → Subgrid_Risiko",
  },
  {
    id: "dpa-upload",
    sourceField: "hasDpa",
    equals: "ja",
    affectedFields: ["data-processing-agreement"],
    required: true,
    sourceReference:
      "Power Pages: fm_eksisterendedatabehandleraftale → fm_databehandleraftale",
  },
  {
    id: "contract-upload",
    sourceField: "hasContract",
    equals: "ja",
    affectedFields: ["contract"],
    required: true,
    sourceReference: "Power Pages: fm_eksisterendekontrakt → fm_kontrakt/Subgrid_Kontrakt",
  },
  {
    id: "checklist-upload",
    sourceField: "hasSupplierChecklist",
    equals: "ja",
    affectedFields: ["supplier-checklist"],
    required: false,
    sourceReference: "Power Pages: fm_tjeklistenleverandor → Subgrid_Tjekliste",
  },
  {
    id: "architecture-upload",
    sourceField: "hasArchitecture",
    equals: "ja",
    affectedFields: ["architecture"],
    required: true,
    sourceReference:
      "Power Pages: fm_indhentetsystemarkitektur → fm_tegning/Subgrid_Tegning",
  },
];

/**
 * Production-safe defaults for a brand-new application. Domain answers are
 * deliberately empty so demo data can never be submitted as genuine input.
 */
export const initialApplicationState: ApplicationFormState = {
  schemaVersion: "dgita-v1",
  knownSystem: "ja",
  replacesExisting: "nej",
  replacementSystem: "",
  replacementCatalogRelation: null,
  catalogQuery: "",
  selectedSystem: null,
  manualCatalogEntry: false,
  existsInKitos: "nej",
  municipalityAlreadyUsesSystem: "nej",
  manualSystemName: "",
  businessType: "",
  systemDescription: "",
  descriptionUrl: "",
  supplier: "",
  supplierCvr: "",
  rightsHolder: "",
  rightsHolderCvr: "",
  contactPerson: "",
  department: "",
  dataOwner: "",
  systemOwner: "",
  contractOwner: "",
  systemAdministrators: "",
  superUsers: "",
  esdhContractUrl: "",
  esdhDpaUrl: "",
  responsibleOrganization: "",
  acquisitionMethod: "",
  marketResearch: "nej",
  marketResearchSystems: "",
  acquisitionType: "nyanskaffelse",
  relatedSystem: "",
  relatedCatalogRelation: null,
  purpose: "",
  functionDescription: "",
  kleTopics: [],
  existingProcessSystem: "nej",
  existingProcessSystems: "",
  crossCutting: "nej",
  crossFunctionality: "",
  crossDepartments: [],
  hasBudget: "nej",
  budgetAmount: "",
  oneTimeCost: "",
  yearlyCost: "",
  otherCost: "",
  benefits: "",
  hasRiskAssessment: "nej",
  needsRiskHelp: "nej",
  personalData: "nej",
  hasDpa: "nej",
  hasContract: "nej",
  hasSupplierChecklist: "nej",
  dataClassification: "",
  employeeAccess: "",
  milestones: [],
  implementationResources: "",
  startDate: "",
  endDate: "",
  implementationUsers: "",
  hasArchitecture: "nej",
  checklistJournalized: "nej",
  approvingLeaderId: "",
  approvingLeader: "",
  remarks: "",
  consent: false,
  attachments: {
    "risk-assessment": [],
    "data-processing-agreement": [],
    contract: [],
    "supplier-checklist": [],
    architecture: [],
  },
};

/** Fixture used exclusively by tests and seeded demonstration cases. */
export const legacyDemoApplicationState: ApplicationFormState = {
  schemaVersion: "dgita-v1",
  knownSystem: "ja",
  replacesExisting: "nej",
  replacementSystem: "",
  replacementCatalogRelation: null,
  catalogQuery: "WSUS klient",
  selectedSystem: null,
  manualCatalogEntry: false,
  existsInKitos: "ja",
  municipalityAlreadyUsesSystem: "nej",
  manualSystemName: "",
  businessType: "",
  systemDescription: "",
  descriptionUrl: "",
  supplier: "",
  supplierCvr: "",
  rightsHolder: "",
  rightsHolderCvr: "",
  contactPerson: "atlu@kalundborg.dk",
  department: "ORG – Digitalisering og IT",
  dataOwner: "peah@kalundborg.dk",
  systemOwner: "peah@kalundborg.dk",
  contractOwner: "atlu@kalundborg.dk",
  systemAdministrators: "",
  superUsers: "",
  esdhContractUrl: "",
  esdhDpaUrl: "",
  responsibleOrganization: "ORG – Digitalisering og IT",
  acquisitionMethod: "DIGIT udbud/aftale",
  marketResearch: "ja",
  marketResearchSystems: "System A, System B",
  acquisitionType: "nyanskaffelse",
  relatedSystem: "",
  relatedCatalogRelation: null,
  purpose:
    "Anskaffelsen skal sikre en stabil og ensartet håndtering af klientopdateringer på tværs af kommunen.",
  functionDescription:
    "Systemet understøtter central distribution, planlægning og dokumentation af opdateringer.",
  kleTopics: ["Digital drift", "Systemadministration"],
  existingProcessSystem: "ja",
  existingProcessSystems: "Kommunens nuværende løsning",
  crossCutting: "ja",
  crossFunctionality:
    "Funktionaliteten kan understøtte ensartet klientdrift på tværs af organisationen.",
  crossDepartments: ["ORG – HR og Udvikling"],
  hasBudget: "ja",
  budgetAmount: "2,00",
  oneTimeCost: "100,00",
  yearlyCost: "100,00",
  otherCost: "100,00",
  benefits: "Mere ensartet drift, færre manuelle opgaver og bedre dokumentation.",
  hasRiskAssessment: "nej",
  needsRiskHelp: "ja",
  personalData: "ja",
  hasDpa: "nej",
  hasContract: "nej",
  hasSupplierChecklist: "nej",
  dataClassification: "3. Fortrolige oplysninger",
  employeeAccess: "0-9",
  milestones: ["Kontraktindgåelse", "Test"],
  implementationResources:
    "Projektledelse, teknisk opsætning, test, brugerstyring og uddannelse.",
  startDate: "2026-09-18",
  endDate: "2026-10-09",
  implementationUsers: "0-9",
  hasArchitecture: "nej",
  checklistJournalized: "ja",
  approvingLeaderId: "kalundborg-consultant-peter-bjerre",
  approvingLeader: "Peter Bjerre Ahlgren",
  remarks: "",
  consent: false,
  attachments: {
    "risk-assessment": [],
    "data-processing-agreement": [],
    contract: [],
    "supplier-checklist": [],
    architecture: [],
  },
};

/** New test forms use non-deliverable, neutral identities. Historical snapshots are unchanged. */
export const demoApplicationState: ApplicationFormState = {
  ...structuredClone(legacyDemoApplicationState),
  catalogQuery: "Testsystem 01",
  contactPerson: "contact-01@example.invalid",
  department: "Testafdeling",
  dataOwner: "data-owner-01@example.invalid",
  systemOwner: "system-owner-01@example.invalid",
  contractOwner: "contract-owner-01@example.invalid",
  responsibleOrganization: "Testorganisation",
  crossDepartments: ["Testafdeling 02"],
  approvingLeaderId: SYNTHETIC_APPROVERS[0].id,
  approvingLeader: SYNTHETIC_APPROVERS[0].name,
};

export function isRuleActive(rule: FormRule, state: ApplicationFormState) {
  return String(state[rule.sourceField]) === rule.equals;
}

export function isFieldVisible(field: string, state: ApplicationFormState) {
  switch (field) {
    case "replacementSystem":
    case "replacementCatalogRelation":
      return state.replacesExisting === "ja";
    case "catalogQuery":
    case "selectedSystem":
      return state.knownSystem === "ja" && !state.manualCatalogEntry;
    case "manualSystem":
      return state.knownSystem === "nej" || state.manualCatalogEntry;
    case "marketResearchSystems":
      return state.marketResearch === "ja";
    case "relatedSystem":
    case "relatedCatalogRelation":
      return state.acquisitionType === "tilkøb";
    case "existingProcessSystems":
      return state.existingProcessSystem === "ja";
    case "crossDepartments":
    case "crossFunctionality":
      return state.crossCutting === "ja";
    case "budgetAmount":
      return state.hasBudget === "ja";
    case "riskHelp":
      return state.hasRiskAssessment === "nej";
    case "risk-assessment":
      return state.hasRiskAssessment === "ja";
    case "dpaQuestion":
    case "dataClassification":
      return state.personalData === "ja";
    case "data-processing-agreement":
      return state.personalData === "ja" && state.hasDpa === "ja";
    case "contract":
      return state.hasContract === "ja";
    case "supplier-checklist":
      return state.hasSupplierChecklist === "ja";
    case "architecture":
      return state.hasArchitecture === "ja";
    default:
      return true;
  }
}

function required(field: string, value: unknown, message: string): FieldError | null {
  const empty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && (value.length === 0 || value.every((item) => typeof item === "string" && item.trim() === "")));
  return empty ? { field, message, severity: "error" } : null;
}

function visibleRequired(
  state: ApplicationFormState,
  field: keyof ApplicationFormState | string,
  value: unknown,
  message: string,
) {
  return isFieldVisible(String(field), state) ? required(String(field), value, message) : null;
}

function compact(errors: Array<FieldError | null>) {
  return errors.filter((error): error is FieldError => error !== null);
}

function choiceError(field: string, value: string, options: readonly string[], message: string, mandatory = true): FieldError | null {
  if (!mandatory && !value.trim()) return null;
  return options.includes(value) ? null : { field, message, severity: "error" };
}

function urlError(field: string, value: string): FieldError | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password) return null;
  } catch { /* Present the same actionable error for malformed URLs. */ }
  return { field, message: "Angiv et gyldigt link, der starter med https:// eller http://, uden brugernavn og adgangskode.", severity: "error" };
}

function cvrError(field: string, value: string): FieldError | null {
  if (!value.trim() || /^\d{8}$/u.test(value.replace(/\s/gu, ""))) return null;
  return { field, message: "CVR-nummeret skal indeholde 8 cifre.", severity: "error" };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateError(field: string, value: string, label: string): FieldError | null {
  return required(field, value, `Angiv ${label}.`) ?? (isCalendarDate(value) ? null : {
    field, message: `Angiv en gyldig ${label}.`, severity: "error",
  });
}

function visibleRelationError(state: ApplicationFormState, field: RelationField): FieldError | null {
  if (!isFieldVisible(field, state)) return null;
  const message = relationError(state, field);
  return message ? { field, message, severity: "error" } : null;
}

export function getStepErrors(state: ApplicationFormState, step: number): FieldError[] {
  switch (step) {
    case 0:
      return compact([
        state.knownSystem === "ja" && !state.manualCatalogEntry
          ? required("selectedSystem", state.selectedSystem, "Vælg et system fra kataloget.")
          : null,
        visibleRequired(
          state,
          "manualSystem",
          state.manualSystemName,
          "Angiv systemets officielle navn.",
        ),
        visibleRelationError(state, "replacementSystem"),
        required("contactPerson", state.contactPerson, "Angiv en kontaktperson."),
        required("department", state.department, "Angiv center eller afdeling."),
        ...(isFieldVisible("manualSystem", state) ? [
          urlError("descriptionUrl", state.descriptionUrl),
          cvrError("supplierCvr", state.supplierCvr),
          cvrError("rightsHolderCvr", state.rightsHolderCvr),
        ] : []),
      ]);
    case 1:
      return compact([
        required("dataOwner", state.dataOwner, "Angiv dataejer."),
        required("systemOwner", state.systemOwner, "Angiv systemejer."),
        required("contractOwner", state.contractOwner, "Angiv kontraktejer."),
        state.municipalityAlreadyUsesSystem === "nej"
          ? required(
              "responsibleOrganization",
              state.responsibleOrganization,
              "Angiv ansvarlig afdeling eller enhed.",
            )
          : null,
        urlError("esdhContractUrl", state.esdhContractUrl),
        urlError("esdhDpaUrl", state.esdhDpaUrl),
      ]);
    case 2:
      return compact([
        choiceError("acquisitionMethod", state.acquisitionMethod, ACQUISITION_METHODS, "Vælg en anskaffelsesform fra listen."),
        visibleRequired(
          state,
          "marketResearchSystems",
          state.marketResearchSystems,
          "Angiv de afdækkede systemer.",
        ),
        visibleRelationError(state, "relatedSystem"),
      ]);
    case 3:
      return compact([
        required("purpose", state.purpose, "Beskriv formålet med anskaffelsen."),
        required(
          "functionDescription",
          state.functionDescription,
          "Beskriv systemets funktion.",
        ),
        visibleRequired(
          state,
          "existingProcessSystems",
          state.existingProcessSystems,
          "Angiv hvilke eksisterende systemer der understøtter processen.",
        ),
        visibleRequired(
          state,
          "crossFunctionality",
          state.crossFunctionality,
          "Beskriv den tværgående funktionalitet.",
        ),
        visibleRequired(
          state,
          "crossDepartments",
          state.crossDepartments,
          "Angiv hvilke centre eller teams der kan bruge funktionaliteten.",
        ),
      ]);
    case 4: {
      const errors = compact([
        visibleRequired(
          state,
          "budgetAmount",
          state.budgetAmount,
          "Angiv det eksisterende budgetbeløb.",
        ),
        required("benefits", state.benefits, "Beskriv gevinsten."),
      ]);
      const amountFields: Array<[string, string]> = [
        ["budgetAmount", state.budgetAmount],
        ["oneTimeCost", state.oneTimeCost],
        ["yearlyCost", state.yearlyCost],
        ["otherCost", state.otherCost],
      ];
      for (const [field, value] of amountFields) {
        if (field === "budgetAmount" && !isFieldVisible(field, state)) continue;
        if (value && parseDanishAmount(value) === null) {
          errors.push({
            field,
            message: "Angiv et gyldigt beløb på 0 kr. eller derover.",
            severity: "error",
          });
        }
      }
      return errors;
    }
    case 5:
      return compact([
        isFieldVisible("dataClassification", state)
          ? choiceError("dataClassification", state.dataClassification, DATA_CLASSIFICATIONS, "Vælg en dataklassifikation fra listen.")
          : null,
        choiceError("employeeAccess", state.employeeAccess, USER_COUNT_OPTIONS, "Vælg antal medarbejdere fra listen.", false),
        visibleRequired(
          state,
          "data-processing-agreement",
          state.attachments["data-processing-agreement"].filter(
            (attachment) => attachment.status === "uploaded",
          ),
          "Upload databehandleraftalen.",
        ),
        visibleRequired(
          state,
          "contract",
          state.attachments.contract.filter((attachment) => attachment.status === "uploaded"),
          "Upload kontrakten.",
        ),
      ]);
    case 6: {
      const errors = compact([
        required(
          "implementationResources",
          state.implementationResources,
          "Beskriv ressourcetrækket.",
        ),
        dateError("startDate", state.startDate, "startdato"),
        dateError("endDate", state.endDate, "slutdato"),
        choiceError("implementationUsers", state.implementationUsers, USER_COUNT_OPTIONS, "Vælg antal brugere fra listen."),
      ]);
      if (isCalendarDate(state.startDate) && isCalendarDate(state.endDate) && state.endDate < state.startDate) {
        errors.push({
          field: "endDate",
          message: "Slutdatoen må ikke ligge før startdatoen.",
          severity: "error",
        });
      }
      return errors;
    }
    case 7:
      return compact([
        visibleRequired(
          state,
          "architecture",
          state.attachments.architecture.filter((attachment) => attachment.status === "uploaded"),
          "Upload arkitekturtegningen.",
        ),
      ]);
    case 8:
      return resolveApprovingLeader(state.approvingLeaderId, state.approvingLeader)
        ? []
        : [{
            field: "approvingLeader",
            message: "Vælg en gyldig godkendende chef.",
            severity: "error",
          }];
    case 9:
      return state.consent
        ? []
        : [
            {
              field: "consent",
              message: "Bekræft, at oplysninger og bilag er kontrolleret.",
              severity: "error",
            },
          ];
    default:
      return [];
  }
}

export function resolveApprovingLeader(id: string, legacyName = "") {
  const legacy = [...APPROVING_LEADERS, ...LEGACY_APPROVING_LEADERS].find(
    (leader) => leader.id === id || (!id && leader.name === legacyName.trim()),
  );
  if (legacy) return legacy;
  // Structural client validation only. Submission and leader-link issuance
  // independently require a live tenant-scoped approver mandate in SQL.
  if (/^[A-Za-z0-9:_-]{1,200}$/u.test(id) && legacyName.trim().length > 0 &&
      legacyName.length <= 256 && !/[\r\n\u0000]/u.test(legacyName)) {
    return { id, name: legacyName.trim() };
  }
  return null;
}

export function normalizeApprovingLeader(state: ApplicationFormState) {
  const leader = resolveApprovingLeader(
    state.approvingLeaderId || "",
    state.approvingLeader,
  );
  return leader
    ? { ...state, approvingLeaderId: leader.id, approvingLeader: leader.name }
    : { ...state, approvingLeaderId: "", approvingLeader: "" };
}

export function getStepWarnings(state: ApplicationFormState, step: number): FieldError[] {
  const warnings: FieldError[] = [];
  if (step === 5 && state.hasRiskAssessment === "nej") {
    warnings.push({
      field: "hasRiskAssessment",
      message: "Risikovurderingen skal færdiggøres under sagsbehandlingen.",
      severity: "warning",
    });
  }
  if (step === 7 && state.hasArchitecture === "nej") {
    warnings.push({
      field: "hasArchitecture",
      message: "Arkitekturtegningen mangler og bliver et opmærksomhedspunkt på sagen.",
      severity: "warning",
    });
  }
  return warnings;
}

export function getAllErrors(state: ApplicationFormState) {
  return Array.from({ length: 10 }, (_, step) => getStepErrors(state, step)).flat();
}

export function firstInvalidStep(state: ApplicationFormState) {
  for (let step = 0; step < 10; step += 1) {
    if (getStepErrors(state, step).length > 0) return step;
  }
  return null;
}

export function canOpenStep(state: ApplicationFormState, targetStep: number) {
  if (targetStep <= 0) return true;
  for (let step = 0; step < targetStep; step += 1) {
    if (getStepErrors(state, step).length > 0) return false;
  }
  return true;
}

export function parseDanishAmount(value: string): number | null {
  const raw = value.trim();
  if (!raw) return 0;
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{0,2})?$|^\d+(?:,\d{0,2})?$/.test(raw)) return null;
  const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function formatDanishAmount(value: number) {
  return new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getFinanceTotal(state: ApplicationFormState) {
  return [state.oneTimeCost, state.yearlyCost, state.otherCost].reduce((total, value) => {
    const parsed = parseDanishAmount(value);
    return total + (parsed ?? 0);
  }, 0);
}

export function validateUpload(
  kind: UploadKind,
  file: { name: string; size: number; type: string },
): string | null {
  if (!file.name.trim() || file.name.trim().length > 255 || /[\r\n\0]/u.test(file.name)) return "Filnavnet er ugyldigt.";
  if (!Number.isSafeInteger(file.size)) return "Filens størrelse er ugyldig.";
  if (file.size > MAX_UPLOAD_BYTES) return "Filen må højst fylde 25 MB.";
  if (file.size <= 0) return "Filen er tom.";

  const extension = (file.name.trim().toLowerCase().split(".").pop() ?? "") as UploadExtension;
  const policy = getUploadPolicy(kind);
  if (!policy.extensions.includes(extension)) return policy.invalidTypeMessage;
  if (file.type.trim() && !UPLOAD_MIME_TYPES[extension]?.includes(file.type.trim().toLowerCase())) {
    return "Filens indholdstype passer ikke til filnavnet.";
  }
  return null;
}

export function createAttachmentDraft(
  kind: UploadKind,
  file: { name: string; size: number; type: string },
  id = `${kind}-${file.name}-${file.size}`,
): AttachmentDraft {
  const error = validateUpload(kind, file);
  return {
    id,
    kind,
    name: file.name,
    size: file.size,
    type: file.type,
    status: error ? "failed" : "selected",
    ...(error ? { error } : {}),
  };
}

export function pruneHiddenAnswers(state: ApplicationFormState) {
  const snapshot: Record<string, unknown> = { ...state };
  const hiddenFields = [
    "replacementSystem",
    "replacementCatalogRelation",
    "marketResearchSystems",
    "relatedSystem",
    "relatedCatalogRelation",
    "existingProcessSystems",
    "crossFunctionality",
    "crossDepartments",
    "budgetAmount",
    "dataClassification",
    "riskHelp",
  ];
  for (const field of hiddenFields) {
    if (!isFieldVisible(field, state)) delete snapshot[field];
  }

  const attachments = Object.fromEntries(
    Object.entries(state.attachments).map(([kind, files]) => [
      kind,
      isFieldVisible(kind, state) ? files.filter((file) => file.status === "uploaded") : [],
    ]),
  );
  snapshot.attachments = attachments;
  if (!isFieldVisible("manualSystem", state)) {
    for (const field of [
      "manualSystemName",
      "businessType",
      "systemDescription",
      "descriptionUrl",
      "supplier",
      "supplierCvr",
      "rightsHolder",
      "rightsHolderCvr",
    ]) {
      delete snapshot[field];
    }
  }
  if (state.personalData === "nej") delete snapshot.hasDpa;
  if (!isFieldVisible("riskHelp", state)) delete snapshot.needsRiskHelp;
  return snapshot;
}

export function getDisplaySystemName(state: ApplicationFormState) {
  return state.selectedSystem?.name || state.manualSystemName || state.catalogQuery || "Ikke valgt";
}
