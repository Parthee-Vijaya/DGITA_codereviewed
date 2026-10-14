"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";
import { MAX_APPLICATION_KLE_ENTRIES, type ApplicationKleSelection } from "../application/kle-selection";
import { SYNTHETIC_KLE_CATALOG } from "./synthetic";
import { useKleSearch } from "./use-kle-search";
import styles from "./KleAssessmentFields.module.css";
import fieldStyles from "./KleApplicationField.module.css";

type Props = {
  value?: ApplicationKleSelection | null;
  onChange: (value: ApplicationKleSelection | null) => void;
  legacyTopics: string[];
  onLegacyTopicsChange: (value: string[]) => void;
};

/** Mounted only for the server-enabled local preview. Search failure never changes the saved selection. */
export function KleApplicationField({ value, onChange, legacyTopics, onLegacyTopicsChange }: Props) {
  const id = useId();
  const catalog = SYNTHETIC_KLE_CATALOG;
  const search = useKleSearch(catalog);
  const selected = value?.entries ?? [];
  const selectedIds = new Set(selected.map((entry) => entry.uuid));
  const differentSource = Boolean(selected.length && value && (
    value.source.id !== catalog.source.id || value.source.version !== catalog.source.version ||
    value.source.kind !== catalog.source.kind || value.source.label !== catalog.source.label
  ));

  function remove(uuid: string) {
    if (!value) return;
    const entries = value.entries.filter((entry) => entry.uuid !== uuid);
    onChange(entries.length ? { ...value, entries } : null);
  }

  function toggle(uuid: string) {
    if (selectedIds.has(uuid)) {
      remove(uuid);
      return;
    }
    if (differentSource || selected.length >= MAX_APPLICATION_KLE_ENTRIES) return;
    const entry = catalog.entries.find((candidate) => candidate.uuid === uuid && !candidate.retired);
    if (!entry) return;
    const { id: sourceId, version, label, kind } = catalog.source;
    onChange({
      schemaVersion: 1,
      source: { id: sourceId, version, label, kind },
      entries: [...selected, { uuid: entry.uuid, code: entry.code, title: entry.title }],
    });
  }

  return <div className={fieldStyles.field}>
    <p className={styles.meta} id={`${id}-preview`}><strong>Afprøvning med eksempeldata.</strong> Søgningen bruger fiktive emner, indtil aftalen med KL er afklaret.</p>
    <div>
      <label className={fieldStyles.label} htmlFor={`${id}-search`}>Søg efter KLE-emner</label>
      <p className={styles.meta} id={`${id}-search-hint`}>Søg på kode, titel eller stikord, og vælg de emner, du kender. Valg af en gruppe tilføjer ikke automatisk dens underemner.</p>
      <div className={`lookup-field ${fieldStyles.search}`}>
        <Search size={18} aria-hidden="true" />
        <input id={`${id}-search`} className="clean-input" type="search" autoComplete="off"
          value={search.query} maxLength={256} placeholder="Søg i eksempeldata"
          aria-describedby={`${id}-preview ${id}-search-hint`}
          onChange={(event) => search.setQuery(event.target.value)} />
      </div>
      <p className={styles.meta} role="status" aria-atomic="true">
        {search.loading ? "Søger i KLE-grundlaget…" : search.error ? "Søgningen er midlertidigt utilgængelig" : `${search.total} ${search.total === 1 ? "søgeresultat" : "søgeresultater"}`}
        {` · ${selected.length} valgt`}
      </p>
      {search.error ? <div className={styles.searchError}>
        <p role="alert">{search.error} Du kan stadig gemme kladden og fortsætte ansøgningen.</p>
        <button type="button" className="inline-action" onClick={search.retry}>Prøv søgningen igen</button>
      </div> : null}
      {differentSource && value ? <div className={styles.searchError}>
        <p role="status">Dine gemte KLE-emner bruger et andet kildegrundlag og er bevaret. Fjern dem, før du vælger emner fra den aktuelle søgning.</p>
        <p className={styles.meta}>Kilde for de gemte emner: {value.source.label} · Version {value.source.version}</p>
      </div> : null}
      <div className={styles.options} role="group" aria-label="KLE-søgeresultater" aria-busy={search.loading}>
        {search.results.map((entry) => <label className={styles.option} key={entry.uuid}>
          <input type="checkbox" checked={selectedIds.has(entry.uuid)}
            disabled={Boolean(search.error) || (!selectedIds.has(entry.uuid) && (differentSource || selected.length >= MAX_APPLICATION_KLE_ENTRIES))}
            onChange={() => toggle(entry.uuid)} />
          <span><strong>{entry.code}</strong> {entry.title}
            <small>{entry.level === "main-group" ? "Hovedgruppe" : entry.level === "group" ? "Gruppe" : "Emne"} · Eksempeldata</small>
            {entry.keywords?.length ? <small>Stikord: {entry.keywords.slice(0, 3).join(", ")}</small> : null}
          </span>
        </label>)}
        {!search.loading && !search.error && !search.results.length ? <p className={styles.meta}>Ingen eksempler passer til søgningen. Prøv et andet stikord, eller beskriv arbejdsprocesserne med egne ord nedenfor.</p> : null}
      </div>
      {search.hasMore ? <button type="button" className={`inline-action ${styles.moreResults}`} onClick={search.loadMore}>Vis flere emner ({search.results.length} af {search.total})</button> : null}
      {selected.length ? <div className={styles.selected} role="group" aria-label="Valgte KLE-emner">
        {selected.map((entry) => <button className={`${styles.selection} ${fieldStyles.selection}`} type="button" key={entry.uuid}
          aria-label={`Fjern ${entry.code}: ${entry.title}`} onClick={() => remove(entry.uuid)}>
          <span><strong>{entry.code}</strong> {entry.title}</span><X size={15} aria-hidden="true" />
        </button>)}
      </div> : null}
      {selected.length >= MAX_APPLICATION_KLE_ENTRIES ? <p className={styles.meta}>Du kan vælge højst {MAX_APPLICATION_KLE_ENTRIES} emner. Fjern et emne for at vælge et andet.</p> : null}
      <p className={`${styles.meta} ${styles.searchSource}`}>{catalog.source.label} · Version {catalog.source.version}<br />
        <a href="https://www.kle-online.dk/soegning" target="_blank" rel="noopener noreferrer">Åbn KLE Online (ny fane)</a>
      </p>
    </div>
    <div>
      <label className={fieldStyles.label} htmlFor={`${id}-legacy`}>KLE-oplysninger med egne ord</label>
      <p className={styles.meta} id={`${id}-legacy-hint`}>Du kan også beskrive arbejdsprocesser eller angive KLE-emner med egne ord, adskilt med komma. Dine eksisterende oplysninger er bevaret her.</p>
      <input id={`${id}-legacy`} className={`clean-input ${fieldStyles.search}`} value={legacyTopics.join(", ")}
        aria-describedby={`${id}-legacy-hint`}
        onChange={(event) => onLegacyTopicsChange(event.target.value.split(",").map((topic) => topic.trim()).filter(Boolean))} />
    </div>
  </div>;
}
