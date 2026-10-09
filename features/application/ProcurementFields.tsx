"use client";

import { Question, FieldErrorText } from "./ApplicationFields";
import { SegmentedChoice } from "../ui/SegmentedChoice";
import { CONTRACT_VALUE_STATUS_OPTIONS, CONTRACT_COVERAGE_OPTIONS, PROCUREMENT_TEXT_LIMITS, type PROCUREMENT_FIELDS } from "./procurement";
import type { ApplicationFormState } from "./engine";

type ProcurementField = typeof PROCUREMENT_FIELDS[number];
export function ProcurementFields({ form, errorFor, onChange }: {
  form: ApplicationFormState;
  errorFor: (field: string) => string | undefined;
  onChange: <K extends ProcurementField>(field: K, value: ApplicationFormState[K]) => void;
}) {
  const inputClass = (field: string) => `clean-input${errorFor(field) ? " invalid" : ""}`;
  return <>
    <Question title="Er den samlede kontraktværdi anslået?" hint="Oplysningerne bruges til den efterfølgende indkøbsvurdering. Formularen afgør ikke udbudspligt eller godkender anskaffelsen.">
      <SegmentedChoice value={form.contractValueStatus ?? ""} options={CONTRACT_VALUE_STATUS_OPTIONS} onChange={(value) => onChange("contractValueStatus", value)} error={errorFor("contractValueStatus")} />
      <FieldErrorText message={errorFor("contractValueStatus")} />
    </Question>
    {form.contractValueStatus === "estimated" ? <>
      <Question title="Anslået samlet kontraktværdi ekskl. moms" hint="Angiv manuelt et samlet beløb for hele kontraktperioden, inklusive alle optioner og mulige forlængelser. Første års omkostninger ovenfor er kun en del af grundlaget. Brug fx 125.000,00.">
        <input className={inputClass("estimatedContractValueExVat")} inputMode="decimal" maxLength={PROCUREMENT_TEXT_LIMITS.estimatedContractValueExVat} value={form.estimatedContractValueExVat ?? ""} onChange={(event) => onChange("estimatedContractValueExVat", event.target.value)} />
        <FieldErrorText message={errorFor("estimatedContractValueExVat")} />
      </Question>
      <Question title="Kontraktperiode i måneder" hint="Valgfrit. Angiv grundperioden uden mulige forlængelser som et helt antal måneder fra 1 til 1200.">
        <input className={inputClass("contractDurationMonths")} inputMode="numeric" maxLength={PROCUREMENT_TEXT_LIMITS.contractDurationMonths} value={form.contractDurationMonths ?? ""} onChange={(event) => onChange("contractDurationMonths", event.target.value)} />
        <FieldErrorText message={errorFor("contractDurationMonths")} />
      </Question>
      <Question title="Optioner og mulige forlængelser" hint="Beskriv omfanget, og hvordan det indgår i kontraktværdien. Skriv Ingen, hvis der ikke er optioner eller forlængelser.">
        <textarea className={inputClass("contractOptionsDescription")} rows={3} maxLength={PROCUREMENT_TEXT_LIMITS.contractOptionsDescription} value={form.contractOptionsDescription ?? ""} onChange={(event) => onChange("contractOptionsDescription", event.target.value)} />
        <FieldErrorText message={errorFor("contractOptionsDescription")} />
      </Question>
      <Question title="Grundlag for den anslåede kontraktværdi" hint="Beskriv beregningen og forudsætningerne for beløbet over hele perioden, inklusive optioner og forlængelser og eksklusive moms.">
        <textarea className={inputClass("contractValueNote")} rows={3} maxLength={PROCUREMENT_TEXT_LIMITS.contractValueNote} value={form.contractValueNote ?? ""} onChange={(event) => onChange("contractValueNote", event.target.value)} />
        <FieldErrorText message={errorFor("contractValueNote")} />
      </Question>
    </> : null}
    <Question title="Hvordan dækkes anskaffelsen af en aftale?" hint="Vælg Skal afklares, hvis aftaledækningen endnu er usikker.">
      <SegmentedChoice value={form.contractCoverage ?? ""} options={CONTRACT_COVERAGE_OPTIONS} onChange={(value) => onChange("contractCoverage", value)} error={errorFor("contractCoverage")} />
      <FieldErrorText message={errorFor("contractCoverage")} />
    </Question>
    {form.contractCoverage === "existing-agreement" ? <Question title="Dokument- eller journalreference til eksisterende aftale" hint="Angiv fx aftalens dokumentnummer eller journalreference, så den indkøbsansvarlige kan finde aftalen.">
      <input className={inputClass("agreementReference")} maxLength={PROCUREMENT_TEXT_LIMITS.agreementReference} value={form.agreementReference ?? ""} onChange={(event) => onChange("agreementReference", event.target.value)} />
      <FieldErrorText message={errorFor("agreementReference")} />
    </Question> : null}
  </>;
}
