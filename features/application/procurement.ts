import type { ApplicationFormState, FieldError } from "./engine";

export type PersonalDataCategory = "ordinary" | "special" | "criminal" | "national-id";
export type ContractValueStatus = "" | "estimated" | "needs-clarification";
export type ContractCoverage = "" | "existing-agreement" | "new-contract" | "needs-clarification";

export const DATA_CATEGORY_OPTIONS = [
  { value: "ordinary", label: "Almindelige personoplysninger" },
  { value: "special", label: "Særlige kategorier (følsomme oplysninger)" },
  { value: "criminal", label: "Oplysninger om strafbare forhold" },
  { value: "national-id", label: "CPR-numre" },
] as const;
export const CONTRACT_VALUE_STATUS_OPTIONS = [
  { value: "estimated", label: "Værdien er anslået" },
  { value: "needs-clarification", label: "Skal afklares" },
] as const;
export const CONTRACT_COVERAGE_OPTIONS = [
  { value: "existing-agreement", label: "Eksisterende aftale" },
  { value: "new-contract", label: "Ny kontrakt" },
  { value: "needs-clarification", label: "Skal afklares" },
] as const;
export const PROCUREMENT_FIELDS = ["contractValueStatus", "estimatedContractValueExVat", "contractDurationMonths", "contractOptionsDescription", "contractValueNote", "contractCoverage", "agreementReference"] as const;
export const PROCUREMENT_ESTIMATE_FIELDS = ["estimatedContractValueExVat", "contractDurationMonths", "contractOptionsDescription", "contractValueNote"] as const;
export const PROCUREMENT_TEXT_LIMITS = {
  estimatedContractValueExVat: 32,
  contractDurationMonths: 4,
  contractOptionsDescription: 4000,
  contractValueNote: 4000,
  agreementReference: 2048,
} as const;
export const MAX_CONTRACT_VALUE = 1_000_000_000_000;
export const MAX_CONTRACT_DURATION_MONTHS = 1200;

export function isPersonalDataCategories(value: unknown): value is PersonalDataCategory[] {
  return Array.isArray(value) && value.length <= DATA_CATEGORY_OPTIONS.length && new Set(value).size === value.length && value.every((item) => DATA_CATEGORY_OPTIONS.some((option) => option.value === item));
}
export function personalDataCategoryLabels(value: unknown): string[] {
  return isPersonalDataCategories(value) ? DATA_CATEGORY_OPTIONS.filter((option) => value.includes(option.value)).map((option) => option.label) : [];
}
export function isContractValueStatus(value: unknown): value is ContractValueStatus {
  return value === "" || CONTRACT_VALUE_STATUS_OPTIONS.some((option) => option.value === value);
}
export function isContractCoverage(value: unknown): value is ContractCoverage {
  return value === "" || CONTRACT_COVERAGE_OPTIONS.some((option) => option.value === value);
}
export function contractValueStatusLabel(value: unknown): string {
  return CONTRACT_VALUE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? "Ikke besvaret";
}
export function contractCoverageLabel(value: unknown): string {
  return CONTRACT_COVERAGE_OPTIONS.find((option) => option.value === value)?.label ?? "Ikke besvaret";
}

/** A manual estimate for the entire term. No threshold or approval is inferred. */
export function parseContractValue(value: unknown): number | null {
  if (typeof value !== "string" || value.length > PROCUREMENT_TEXT_LIMITS.estimatedContractValueExVat) return null;
  const raw = value.trim();
  if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/u.test(raw)) return null;
  const amount = Number(raw.replace(/\./gu, "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_CONTRACT_VALUE ? amount : null;
}

export function getProcurementErrors(state: ApplicationFormState): FieldError[] {
  const errors: FieldError[] = [];
  const add = (field: string, message: string) => errors.push({ field, message, severity: "error" });
  if (!state.contractValueStatus || !isContractValueStatus(state.contractValueStatus)) add("contractValueStatus", "Angiv, om kontraktværdien er anslået eller skal afklares.");
  if (state.contractValueStatus === "estimated") {
    if (parseContractValue(state.estimatedContractValueExVat) === null) add("estimatedContractValueExVat", "Angiv den samlede kontraktværdi ekskl. moms som et beløb mellem 0 og 1.000.000.000.000 kr. Brug dansk beløbsformat, fx 125.000,00.");
    if (!state.contractOptionsDescription?.trim()) add("contractOptionsDescription", "Beskriv optioner og forlængelser, eller skriv Ingen.");
    if (!state.contractValueNote?.trim()) add("contractValueNote", "Beskriv, hvordan den samlede kontraktværdi er anslået.");
    const duration = state.contractDurationMonths?.trim() ?? "";
    if (duration && (!/^[1-9]\d{0,3}$/u.test(duration) || Number(duration) > MAX_CONTRACT_DURATION_MONTHS)) add("contractDurationMonths", "Angiv kontraktperioden som et helt antal måneder mellem 1 og 1200, eller lad feltet stå tomt.");
    for (const field of PROCUREMENT_ESTIMATE_FIELDS) {
      if ((state[field]?.length ?? 0) > PROCUREMENT_TEXT_LIMITS[field]) add(field, `Brug højst ${PROCUREMENT_TEXT_LIMITS[field]} tegn.`);
    }
  }
  if (!state.contractCoverage || !isContractCoverage(state.contractCoverage)) add("contractCoverage", "Angiv, om anskaffelsen dækkes af en eksisterende aftale, kræver en ny kontrakt eller skal afklares.");
  if (state.contractCoverage === "existing-agreement") {
    if (!state.agreementReference?.trim()) add("agreementReference", "Angiv en dokument- eller journalreference til den eksisterende aftale.");
    if ((state.agreementReference?.length ?? 0) > PROCUREMENT_TEXT_LIMITS.agreementReference || /[\u0000-\u001f\u007f]/u.test(state.agreementReference ?? "")) add("agreementReference", "Angiv en dokument- eller journalreference på højst 2048 tegn uden kontroltegn.");
  }
  return errors;
}

/** Clear answers as soon as their controlling choice makes them irrelevant. */
export function normalizeProcurementChanges(next: ApplicationFormState): ApplicationFormState {
  const normalized = { ...next };
  if (next.personalData !== "ja") normalized.personalDataCategories = [];
  if (next.contractValueStatus !== "estimated") for (const field of PROCUREMENT_ESTIMATE_FIELDS) normalized[field] = "";
  if (next.contractCoverage !== "existing-agreement") normalized.agreementReference = "";
  return normalized;
}
