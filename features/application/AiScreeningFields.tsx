"use client";

import { SegmentedChoice } from "../ui/SegmentedChoice";
import { Question, FieldErrorText } from "./ApplicationFields";
import { AI_USAGE_OPTIONS, hasAiScreeningDetails, MAX_AI_PURPOSE_LENGTH, MAX_AI_ASSESSMENT_URL_LENGTH } from "./ai-screening";
import type { ApplicationFormState } from "./engine";

export function AiScreeningFields({ form, errorFor, onChange }: {
  form: ApplicationFormState;
  errorFor: (field: string) => string | undefined;
  onChange: <K extends "aiUsage" | "aiPurpose" | "aiAssessmentUrl">(field: K, value: ApplicationFormState[K]) => void;
}) {
  return <>
    <Question title="Indeholder anskaffelsen AI?" hint="Medtag også AI-funktioner i et eksisterende system. Er du i tvivl, vælg Ved ikke.">
      <SegmentedChoice value={form.aiUsage ?? ""} options={AI_USAGE_OPTIONS} onChange={(value) => onChange("aiUsage", value)} error={errorFor("aiUsage")} />
      <FieldErrorText message={errorFor("aiUsage")} />
    </Question>
    {hasAiScreeningDetails(form.aiUsage) ? <>
      <Question title="Hvad skal AI bruges til?" hint="Beskriv opgaven, hvem der bruger funktionen, og hvordan resultatet skal bruges. Ved tvivl beskrives den funktion, der skal afklares. Undlad personoplysninger.">
        <textarea className={`clean-input${errorFor("aiPurpose") ? " invalid" : ""}`} rows={4} maxLength={MAX_AI_PURPOSE_LENGTH} value={form.aiPurpose ?? ""} onChange={(event) => onChange("aiPurpose", event.target.value)} />
        <FieldErrorText message={errorFor("aiPurpose")} />
      </Question>
      <Question title="Link til kommunens aktuelle AI-vurdering" hint="Valgfrit. Indsæt et link til vurderingen for denne anskaffelse, hvis den findes. De faglige ansvarlige afgør, hvilke yderligere oplysninger og godkendelser der er nødvendige.">
        <input type="url" className={`clean-input${errorFor("aiAssessmentUrl") ? " invalid" : ""}`} maxLength={MAX_AI_ASSESSMENT_URL_LENGTH} value={form.aiAssessmentUrl ?? ""} onChange={(event) => onChange("aiAssessmentUrl", event.target.value)} />
        <FieldErrorText message={errorFor("aiAssessmentUrl")} />
      </Question>
    </> : null}
  </>;
}
