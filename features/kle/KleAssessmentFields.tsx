"use client";

import { ChevronDown, Info, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  evaluateKleReview,
  getKleInputBinding,
  KLE_LIMITS,
  type KleReview,
} from "./domain";
import { SYNTHETIC_KLE_CATALOG, SYNTHETIC_KL_TASK_CATALOG } from "./synthetic";
import styles from "./KleAssessmentFields.module.css";

type Props = {
  value: KleReview;
  onChange: (value: KleReview) => void;
  /** The caller saves and confirms on the server using the authenticated identity. */
  onConfirm?: () => void;
  disabled?: boolean;
  error?: string;
  initiallyOpen?: boolean;
};

const MATCH_LABELS = {
  direct: "Direkte eksempelmatch",
  possible: "Muligt eksempelmatch",
  "no-match": "Ingen match i eksemplerne",
  incomplete: "Afklaring mangler",
} as const;

const LEVEL_LABELS = {
  "needs-clarification": "Skal afklares",
  low: "Lav",
  medium: "Middel",
  high: "Høj",
  critical: "Kritisk",
} as const;

/** Synthetic preview only. The containing page and persistence API must be gated. */
export function KleAssessmentFields({ value, onChange, onConfirm, disabled = false, error, initiallyOpen = false }: Props) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const [query, setQuery] = useState("");
  const catalog = SYNTHETIC_KLE_CATALOG;
  const tasks = SYNTHETIC_KL_TASK_CATALOG;
  const evaluation = evaluateKleReview(value, catalog, tasks);
  const inputBinding = getKleInputBinding(value, catalog, tasks);
  const normalizedQuery = query.trim().toLocaleLowerCase("da-DK");
  const results = catalog.entries.filter((entry) => !entry.retired &&
    `${entry.code} ${entry.title}`.toLocaleLowerCase("da-DK").includes(normalizedQuery));
  const selectedIds = new Set(value.selectedCodes.map((selection) => selection.uuid));
  const canConfirm = evaluation.state !== "incomplete" && evaluation.assessmentCurrent;
  const staleAssessment = Boolean(value.localAssessment && value.localAssessment.inputBinding !== inputBinding);
  const confirmedAt = evaluation.confirmationCurrent && value.confirmation
    ? new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(new Date(value.confirmation.confirmedAt))
    : null;

  useEffect(() => {
    if (!error) return;
    if (details.current) details.current.open = true;
    errorSummary.current?.focus();
  }, [error]);

  function update(changes: Partial<KleReview>) {
    onChange({ ...value, ...changes, confirmation: undefined });
  }

  function toggleCode(uuid: string) {
    const entry = catalog.entries.find((item) => item.uuid === uuid && !item.retired);
    if (!entry) return;
    const selectedCodes = selectedIds.has(uuid)
      ? value.selectedCodes.filter((selection) => selection.uuid !== uuid)
      : value.selectedCodes.length < KLE_LIMITS.selectedCodes
        ? [...value.selectedCodes, { uuid: entry.uuid, code: entry.code }]
        : value.selectedCodes;
    update({ selectedCodes });
  }

  function updateAssessment(level: NonNullable<KleReview["localAssessment"]>["level"], rationale: string) {
    update({ localAssessment: { level, rationale, inputBinding } });
  }

  return <details className={styles.panel} ref={details} open={initiallyOpen}>
    <summary>
      <span>Arbejdsopgaver og lokal kritikalitet</span>
      <span className={styles.summaryStatus}>Afprøvning med eksempeldata</span>
      <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
    </summary>
    <div className={styles.content}>
      <div className={styles.notice}>
        <Info size={18} aria-hidden="true" />
        <p>Koder og opgaver her er opdigtede eksempler. Afprøv valgene og sammenhængen; de kan ikke bruges til en NIS2-konklusion eller en godkendelse.</p>
      </div>
      {error ? <p className="field-error" ref={errorSummary} tabIndex={-1} role="alert">{error}</p> : null}

      <fieldset className={styles.fields} disabled={disabled}>
        <legend className={styles.srOnly}>Registrering af arbejdsopgaver i afprøvningen</legend>
        <div className="question">
          <div className="question-copy">
            <label htmlFor={`${id}-search`}>Vælg KLE-emner fra eksemplerne</label>
            <p id={`${id}-search-hint`}>Søg på kode eller titel, og vælg de relevante emner. Valg af en gruppe tilføjer ikke automatisk dens underemner.</p>
          </div>
          <div><div className="lookup-field">
            <Search size={18} aria-hidden="true" />
            <input id={`${id}-search`} className="clean-input" type="search" autoComplete="off" value={query}
              aria-describedby={`${id}-search-hint`} placeholder="Søg i eksempeldata" maxLength={256}
              onChange={(event) => setQuery(event.target.value)} />
          </div>
          <p className={styles.meta} role="status">{results.length} {results.length === 1 ? "søgeresultat" : "søgeresultater"} · {value.selectedCodes.length} valgt</p>
          <div className={styles.options} role="group" aria-label="KLE-søgeresultater">
            {results.map((entry) => <label className={styles.option} key={entry.uuid}>
              <input type="checkbox" checked={selectedIds.has(entry.uuid)}
                disabled={!selectedIds.has(entry.uuid) && value.selectedCodes.length >= KLE_LIMITS.selectedCodes}
                onChange={() => toggleCode(entry.uuid)} />
              <span><strong>{entry.code}</strong> {entry.title}<small>{entry.level === "group" ? "Gruppe" : "Emne"} · Eksempeldata</small></span>
            </label>)}
            {!results.length ? <p className={styles.meta}>Ingen eksempler passer til søgningen. Du kan stadig beskrive den lokale arbejdsopgave nedenfor.</p> : null}
          </div>
          {value.selectedCodes.length ? <div className={styles.selected} aria-label="Valgte KLE-emner">
            {value.selectedCodes.map((selection) => <button className={styles.selection} type="button" key={selection.uuid}
              aria-label={`Fjern ${selection.code}`}
              onClick={() => update({ selectedCodes: value.selectedCodes.filter((item) => item.uuid !== selection.uuid) })}>
              {selection.code}<X size={15} aria-hidden="true" />
            </button>)}
          </div> : null}</div>
        </div>

        {value.legacyTopics.length ? <p className={styles.legacy}>Tidligere fritekst er bevaret som ubekræftet grundlag: {value.legacyTopics.join(", ")}. Den bliver ikke automatisk til valgte KLE-koder.</p> : null}

        <div className="question">
          <div className="question-copy">
            <label htmlFor={`${id}-task`}>Hvilken lokal arbejdsopgave understøttes?</label>
            <p id={`${id}-task-hint`}>Beskriv også afhængigheder til andre systemer, fx login eller integrationer. Brug fiktive oplysninger i afprøvningen.</p>
          </div>
          <textarea id={`${id}-task`} className="clean-input" rows={3} maxLength={KLE_LIMITS.text}
            value={value.localTaskDescription} aria-describedby={`${id}-task-hint`}
            onChange={(event) => update({ localTaskDescription: event.target.value })} />
        </div>

        <section className={styles.match} aria-labelledby={`${id}-match-title`}>
          <h2 id={`${id}-match-title`}>Match til kritiske opgaver i eksempeldata</h2>
          <p className={styles.matchStatus} role="status">{MATCH_LABELS[evaluation.state]}</p>
          {evaluation.matches.length ? <ul className={styles.matches}>
            {evaluation.matches.map((match) => <li key={`${match.taskId}-${match.kleUuid}-${match.match}`}>
              <strong>{match.taskTitle}</strong>
              <span>{match.code} · {match.match === "direct" ? "Direkte eksempelmatch" : "Muligt eksempelmatch"}</span>
              <a href={`#${id}-sources`} aria-label={`Se kildegrundlag for ${match.taskTitle}`}>Se kildegrundlag</a>
            </li>)}
          </ul> : null}
          {evaluation.issues.length ? <ul className={styles.issues}>{evaluation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
          <p className={styles.meta}>Et match er et input til den lokale vurdering. Manglende match fritager ikke et system fra sikkerhedskrav.</p>
        </section>

        <div className="question">
          <div className="question-copy">
            <label htmlFor={`${id}-level`}>Lokal kritikalitet i afprøvningen</label>
            <p id={`${id}-level-hint`}>Vælg manuelt ud fra arbejdsopgaven og afhængighederne. Niveauerne er eksempler; kommunens skala og ansvar skal aftales før anvendelse.</p>
          </div>
          <select id={`${id}-level`} className="clean-input" value={value.localAssessment?.level ?? ""}
            aria-describedby={`${id}-level-hint`} onChange={(event) => {
              const level = event.target.value as NonNullable<KleReview["localAssessment"]>["level"] | "";
              if (!level) update({ localAssessment: undefined });
              else updateAssessment(level, value.localAssessment?.rationale ?? "");
            }}>
            <option value="">Vælg niveau eller Skal afklares</option>
            {Object.entries(LEVEL_LABELS).map(([level, label]) => <option key={level} value={level}>{label}</option>)}
          </select>
        </div>
        {value.localAssessment ? <div className="question">
          <div className="question-copy">
            <label htmlFor={`${id}-rationale`}>Begrund vurderingen</label>
            <p id={`${id}-rationale-hint`}>Beskriv konsekvensen, hvis opgaven ikke kan udføres, og hvad der eventuelt mangler at blive afklaret.</p>
          </div>
          <div><textarea id={`${id}-rationale`} className="clean-input" rows={3} maxLength={KLE_LIMITS.text}
            value={value.localAssessment.rationale} aria-describedby={`${id}-rationale-hint`}
            onChange={(event) => {
              if (value.localAssessment) updateAssessment(value.localAssessment.level, event.target.value);
            }} />
          {staleAssessment ? <div className={styles.reassessment}>
            <p>Arbejdsopgaven eller valgene er ændret. Genlæs vurderingen, og ret den om nødvendigt.</p>
            <button type="button" className="inline-action" disabled={!value.localAssessment.rationale.trim()}
              onClick={() => {
                if (value.localAssessment) updateAssessment(value.localAssessment.level, value.localAssessment.rationale);
              }}>Vurderingen er genlæst og passer stadig</button>
          </div> : null}</div>
        </div> : null}

        <div className={styles.confirmation}>
          <p className={styles.confirmationStatus} role="status">{evaluation.confirmationCurrent ? "Registreringen er bekræftet af dig for disse oplysninger" : "Registreringen er endnu ikke bekræftet for disse oplysninger"}</p>
          {confirmedAt && value.confirmation ? <p><time dateTime={value.confirmation.confirmedAt}>{confirmedAt}</time></p> : null}
          <p id={`${id}-confirmation-hint`}>Bekræft, at du har gennemgået de valgte emner, arbejdsopgaven og vurderingen. Det registrerer din gennemgang; systemejerens mandat er endnu ikke verificeret.</p>
          {!canConfirm ? <p id={`${id}-confirmation-missing`}>Vælg mindst ét gyldigt emne, beskriv arbejdsopgaven, og angiv en begrundet lokal vurdering, før du bekræfter.</p> : null}
          {onConfirm ? <button type="button" className="line-button" disabled={!canConfirm || evaluation.confirmationCurrent}
            aria-describedby={`${id}-confirmation-hint${!canConfirm ? ` ${id}-confirmation-missing` : ""}`}
            onClick={onConfirm}>{evaluation.confirmationCurrent ? "Registreringen er bekræftet" : "Bekræft min gennemgang"}</button> : <p>Gem kladden, før du bekræfter din gennemgang.</p>}
        </div>
      </fieldset>

      <section id={`${id}-sources`} className={styles.sources} aria-labelledby={`${id}-sources-title`} tabIndex={-1}>
        <h2 id={`${id}-sources-title`}>Kildegrundlag for afprøvningen</h2>
        <p>{catalog.source.label} · Version {catalog.source.version}<br />{tasks.source.label} · Version {tasks.source.version}</p>
        <p>Begge kilder indeholder kun syntetiske testdata. Den licenserede KLE-fortegnelse og kommunens accepterede KL-grundlag er ikke tilsluttet.</p>
      </section>
    </div>
  </details>;
}
