import type { ApplicationFormState } from "./engine";

export type AiUsage = "" | "ja" | "nej" | "ved-ikke";

export const AI_USAGE_OPTIONS = [
  { value: "ja", label: "Ja" },
  { value: "nej", label: "Nej" },
  { value: "ved-ikke", label: "Ved ikke" },
] as const;

export const AI_SCREENING_FIELDS = ["aiUsage", "aiPurpose", "aiAssessmentUrl"] as const;
export const MAX_AI_PURPOSE_LENGTH = 4000;
export const MAX_AI_ASSESSMENT_URL_LENGTH = 2048;

export function isAiUsage(value: unknown): value is AiUsage {
  return value === "" || AI_USAGE_OPTIONS.some((option) => option.value === value);
}

export function aiUsageLabel(value: unknown): string {
  return AI_USAGE_OPTIONS.find((option) => option.value === value)?.label ?? "Ikke besvaret";
}

export function hasAiScreeningDetails(value: unknown): boolean {
  return value === "ja" || value === "ved-ikke";
}

/** A reference is displayed only as an ordinary web link; it is never fetched. */
export function isSafeAiAssessmentUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_AI_ASSESSMENT_URL_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Changing the answer to No must not retain now irrelevant free text. */
export function normalizeAiScreeningChanges(previous: ApplicationFormState, next: ApplicationFormState): ApplicationFormState {
  return previous.aiUsage !== next.aiUsage && next.aiUsage === "nej"
    ? { ...next, aiPurpose: "", aiAssessmentUrl: "" }
    : next;
}
