"use client";

import { ChevronDown, Info } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { DgitaApproval } from "./model";
import {
  CASE_ASSESSMENT_LIMITS,
  EMPTY_PRIVACY_ASSESSMENT,
  EMPTY_PROCUREMENT_ASSESSMENT,
  type AssessmentStatus,
  type PrivacyAssessment,
  type ProcurementAssessment,
} from "./case-assessments";

export type CaseAssessmentErrors = { privacy?: string; procurement?: string };

type Props = {
  value: DgitaApproval;
  onChange: (changes: Partial<Pick<DgitaApproval, "privacyAssessment" | "procurementAssessment">>) => void;
  errors?: CaseAssessmentErrors;
};

const STATUS_LABELS: Record<AssessmentStatus, string> = {
  "not-started": "Ikke påbegyndt",
  "in-progress": "Under afklaring",
  documented: "Dokumenteret",
};

/** Render inside the existing disabled fieldset so case locks apply to every control. */
export function CaseAssessmentFields({ value, onChange, errors }: Props) {
  const prefix = useId();
  const privacyDetails = useRef<HTMLDetailsElement>(null);
  const procurementDetails = useRef<HTMLDetailsElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  // Keep untrimmed draft text while typing; server normalization happens on save.
  const privacy = { ...EMPTY_PRIVACY_ASSESSMENT, ...value.privacyAssessment };
  const procurement = { ...EMPTY_PROCUREMENT_ASSESSMENT, ...value.procurementAssessment };
  const privacyErrorId = `${prefix}-privacy-error`;
  const procurementErrorId = `${prefix}-procurement-error`;

  useEffect(() => {
    if (errors?.privacy && privacyDetails.current) privacyDetails.current.open = true;
    if (errors?.procurement && procurementDetails.current) procurementDetails.current.open = true;
    if (errors?.privacy || errors?.procurement) errorSummary.current?.focus();
  }, [errors]);

  function updatePrivacy<K extends keyof PrivacyAssessment>(field: K, next: PrivacyAssessment[K]) {
    onChange({ privacyAssessment: { ...privacy, [field]: next } });
  }

  function updateProcurement<K extends keyof ProcurementAssessment>(field: K, next: ProcurementAssessment[K]) {
    onChange({ procurementAssessment: { ...procurement, [field]: next } });
  }

  return (
    <div className="approval-basis">
      {errors?.privacy || errors?.procurement ? (
        <div className="form-message error" role="alert" tabIndex={-1} ref={errorSummary}>
          <Info size={20} aria-hidden="true" />
          <div>
            <strong>Kontrollér de interne vurderinger</strong>
            {errors.privacy ? <p><a href={`#${prefix}-privacy-status`}>Databeskyttelse: {errors.privacy}</a></p> : null}
            {errors.procurement ? <p><a href={`#${prefix}-procurement-status`}>Indkøb og udbud: {errors.procurement}</a></p> : null}
          </div>
        </div>
      ) : null}

      <details ref={privacyDetails}>
        <summary>Databeskyttelsesvurdering <span>{STATUS_LABELS[privacy.status]}</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <AssessmentSavedNote value={privacy} />
        <p className="section-lead">Registrér den konkrete vurdering med kommunens ansvarlige. Dokumenteret betyder, at vurderingen er beskrevet og har en reference. Det er ikke en juridisk godkendelse eller dokumentation for, at alle tiltag er gennemført.</p>
        <AssessmentField id={`${prefix}-privacy-status`} title="Dokumentationsstatus for databeskyttelse" hint="Brug Under afklaring, mens der mangler oplysninger. Dokumenteret kræver afklarede valg, begrundelser og reference.">
          <StatusSelect id={`${prefix}-privacy-status`} value={privacy.status} errorId={errors?.privacy ? privacyErrorId : undefined} onChange={(next) => updatePrivacy("status", next)} />
          {errors?.privacy ? <p className="field-error" id={privacyErrorId}>{errors.privacy}</p> : null}
        </AssessmentField>
        <AssessmentText id={`${prefix}-processing-basis`} title="Konkret behandlingsgrundlag eller begrundet ikke-relevans" hint="Angiv den relevante hjemmel, fx artikel 6, eventuelle supplerende krav i artikel 9 eller 10 og relevant dansk lovgivning. Hvis der ikke behandles personoplysninger, begrund det." value={privacy.processingBasis} maxLength={CASE_ASSESSMENT_LIMITS.processingBasis} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("processingBasis", next)} />
        <AssessmentField id={`${prefix}-controller-relation`} title="Relation til leverandør eller samarbejdspartner" hint="Vurdér rollen ud fra, hvem der bestemmer formål og hjælpemidler, og om oplysninger behandles på kommunens vegne. Valget foretages manuelt.">
          <div className="clean-select review-select"><select id={`${prefix}-controller-relation`} aria-describedby={`${prefix}-controller-relation-hint`} aria-required={privacy.status === "documented"} value={privacy.controllerRelation} onChange={(event) => updatePrivacy("controllerRelation", event.target.value as PrivacyAssessment["controllerRelation"])}>
            <option value="">Vælg relation</option>
            <option value="processor">Databehandler</option>
            <option value="independent-controller">Selvstændigt dataansvarlig</option>
            <option value="joint-controller">Fælles dataansvar</option>
            <option value="not-applicable">Ingen persondatabehandling i den vurderede relation</option>
            <option value="needs-clarification">Kræver afklaring</option>
          </select><ChevronDown size={16} aria-hidden="true" /></div>
        </AssessmentField>
        <AssessmentText id={`${prefix}-relation-reason`} title="Begrundelse for dataansvar" hint="Beskriv de relevante parter, behandlingen og hvorfor den valgte relation passer. Angiv eventuelle forskellige roller for forskellige behandlinger." value={privacy.relationReason} maxLength={CASE_ASSESSMENT_LIMITS.relationReason} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("relationReason", next)} />
        <AssessmentField id={`${prefix}-dpa-need`} title="Behov for databehandleraftale" hint="Vurdér aftalebehovet for den beskrevne behandling. En aftale i sig selv afgør ikke parternes roller.">
          <NeedSelect id={`${prefix}-dpa-need`} value={privacy.dpaNeed} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("dpaNeed", next)} />
        </AssessmentField>
        <AssessmentText id={`${prefix}-dpa-reason`} title="Begrundelse for databehandleraftale" hint="Begrund behovet eller fravalget. Hvis en aftale er nødvendig, angiv dens status og hvor den findes, eller hvad der mangler." value={privacy.dpaReason} maxLength={CASE_ASSESSMENT_LIMITS.dpaReason} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("dpaReason", next)} />
        <AssessmentField id={`${prefix}-dpia-screening`} title="Behov for konsekvensanalyse (DPIA)" hint="Den dataansvarlige vurderer behovet. Sandsynlig høj risiko for de registreredes rettigheder og frihedsrettigheder kræver en konsekvensanalyse.">
          <NeedSelect id={`${prefix}-dpia-screening`} value={privacy.dpiaScreening} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("dpiaScreening", next)} />
        </AssessmentField>
        <AssessmentText id={`${prefix}-dpia-reason`} title="Begrundelse for DPIA-screening" hint="Beskriv screeningens grundlag og konklusion. Hvis en konsekvensanalyse er nødvendig, angiv dens status og reference eller næste skridt." value={privacy.dpiaReason} maxLength={CASE_ASSESSMENT_LIMITS.dpiaReason} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("dpiaReason", next)} />
        <AssessmentText id={`${prefix}-privacy-reference`} title="Reference til databeskyttelsesvurdering" hint="Angiv dokument, journalnummer eller intern henvisning, hvor vurderingen og dens grundlag kan findes." value={privacy.reference} maxLength={CASE_ASSESSMENT_LIMITS.reference} required={privacy.status === "documented"} onChange={(next) => updatePrivacy("reference", next)} />
        <p className="section-lead">Vejledning: <a href="https://www.datatilsynet.dk/regler-og-vejledning/grundlaeggende-begreber/rollefordeling-dataansvarlig-og-databehandler" target="_blank" rel="noreferrer">Dataansvar og databehandlere (åbner ny fane)</a> · <a href="https://www.datatilsynet.dk/regler-og-vejledning/behandlingssikkerhed/konsekvensanalyse" target="_blank" rel="noreferrer">Konsekvensanalyse (åbner ny fane)</a></p>
      </details>

      <details ref={procurementDetails}>
        <summary>Indkøbs- og udbudsvurdering <span>{STATUS_LABELS[procurement.status]}</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <AssessmentSavedNote value={procurement} />
        <p className="section-lead">Registrér den valgte fremgangsmåde med kommunens indkøbsansvarlige. Dokumenteret betyder, at vurderingen er beskrevet og har en reference. Systemet afgør ikke udbudspligt eller godkender proceduren.</p>
        <AssessmentField id={`${prefix}-procurement-status`} title="Dokumentationsstatus for indkøb og udbud" hint="Dokumenteret kræver en procedure, konkret begrundelse, reference og dato for kontrol af reglerne.">
          <StatusSelect id={`${prefix}-procurement-status`} value={procurement.status} errorId={errors?.procurement ? procurementErrorId : undefined} onChange={(next) => updateProcurement("status", next)} />
          {errors?.procurement ? <p className="field-error" id={procurementErrorId}>{errors.procurement}</p> : null}
        </AssessmentField>
        <AssessmentText id={`${prefix}-procurement-procedure`} title="Valgt anskaffelsesprocedure" hint="Beskriv den konkrete fremgangsmåde, fx anvendelse af en rammeaftale, miniudbud eller en udbudsprocedure. Valget skal begrundes for denne anskaffelse." value={procurement.procedure} maxLength={CASE_ASSESSMENT_LIMITS.procedure} required={procurement.status === "documented"} onChange={(next) => updateProcurement("procedure", next)} />
        <AssessmentText id={`${prefix}-procurement-rationale`} title="Begrundelse for anskaffelsesprocedure" hint="Beskriv relevant kontraktværdi og omfang, aftaledækning, gældende regler og kommunens indkøbspolitik. Medtag den konkrete vurdering af eventuelle undtagelser." value={procurement.rationale} maxLength={CASE_ASSESSMENT_LIMITS.rationale} required={procurement.status === "documented"} onChange={(next) => updateProcurement("rationale", next)} />
        <AssessmentText id={`${prefix}-procurement-reference`} title="Reference til indkøbs- og udbudsvurdering" hint="Angiv dokument eller journalreference samt den regelkilde, aftale eller indkøbspolitik, som vurderingen bygger på." value={procurement.reference} maxLength={CASE_ASSESSMENT_LIMITS.reference} required={procurement.status === "documented"} onChange={(next) => updateProcurement("reference", next)} />
        <AssessmentField id={`${prefix}-rule-checked-on`} title="Dato for regelkontrol" hint="Datoen, hvor de relevante regler og eventuelle aftalevilkår blev kontrolleret. Kontrollér aktuelle regler hos de ansvarlige og i den angivne kilde.">
          <input className="clean-input" id={`${prefix}-rule-checked-on`} type="date" aria-describedby={`${prefix}-rule-checked-on-hint`} aria-required={procurement.status === "documented"} value={procurement.ruleCheckedOn} onChange={(event) => updateProcurement("ruleCheckedOn", event.target.value)} />
        </AssessmentField>
        <p className="section-lead">Vejledning: <a href="https://kfst.dk/udbud/regler-og-lovgivning" target="_blank" rel="noreferrer">Konkurrence- og Forbrugerstyrelsens regler og lovgivning (åbner ny fane)</a></p>
      </details>
    </div>
  );
}

function AssessmentSavedNote({ value }: { value: Pick<PrivacyAssessment, "recordedAt" | "recordedByName"> }) {
  if (!value.recordedAt) return null;
  const recordedAt = new Date(value.recordedAt);
  if (!Number.isFinite(recordedAt.getTime())) return null;
  const dateLabel = new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(recordedAt);
  return <p className="section-lead">Senest gemte ændring: {value.recordedByName?.trim() || "Registreret behandler"} · <time dateTime={value.recordedAt}>{dateLabel}</time></p>;
}

function AssessmentField({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return <div className="question"><div className="question-copy"><label htmlFor={id}>{title}</label><p id={`${id}-hint`}>{hint}</p></div><div>{children}</div></div>;
}

function AssessmentText({ id, title, hint, value, maxLength, required, onChange }: { id: string; title: string; hint: string; value: string; maxLength: number; required: boolean; onChange: (value: string) => void }) {
  return <AssessmentField id={id} title={title} hint={hint}><textarea className="clean-input" id={id} rows={3} maxLength={maxLength} aria-describedby={`${id}-hint`} aria-required={required} value={value} onChange={(event) => onChange(event.target.value)} /></AssessmentField>;
}

function StatusSelect({ id, value, errorId, onChange }: { id: string; value: AssessmentStatus; errorId?: string; onChange: (value: AssessmentStatus) => void }) {
  return <div className="clean-select review-select"><select id={id} aria-describedby={`${id}-hint${errorId ? ` ${errorId}` : ""}`} aria-invalid={errorId ? true : undefined} value={value} onChange={(event) => onChange(event.target.value as AssessmentStatus)}>{Object.entries(STATUS_LABELS).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div>;
}

function NeedSelect({ id, value, required, onChange }: { id: string; value: PrivacyAssessment["dpaNeed"]; required: boolean; onChange: (value: PrivacyAssessment["dpaNeed"]) => void }) {
  return <div className="clean-select review-select"><select id={id} aria-describedby={`${id}-hint`} aria-required={required} value={value} onChange={(event) => onChange(event.target.value as PrivacyAssessment["dpaNeed"])}><option value="">Vælg vurdering</option><option value="required">Nødvendig</option><option value="not-required">Ikke nødvendig</option><option value="needs-clarification">Kræver afklaring</option></select><ChevronDown size={16} aria-hidden="true" /></div>;
}
