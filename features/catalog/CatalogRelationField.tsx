"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { FieldErrorText } from "../application/ApplicationFields";
import { CatalogResult } from "./CatalogCards";
import { catalogFreshnessLabel } from "./metadata";
import { relationFromSystem, type CatalogRelation } from "./relations";
import type { CatalogSystem } from "./search";

type Props = {
  label: string;
  value: string;
  relation: CatalogRelation | null;
  error?: string;
  onChange: (value: string, relation: CatalogRelation | null) => void;
};

export function CatalogRelationField({ label, value, relation, error, onChange }: Props) {
  const id = useId();
  const [search, setSearch] = useState<{ query: string; results: CatalogSystem[]; error?: string }>({ query: "", results: [] });
  const query = value.trim();
  const manual = relation?.kind === "manual";
  const selected = relation?.kind === "catalog";
  const ready = search.query === query;
  const description = [error ? `${id}-error` : "", `${id}-guidance`].filter(Boolean).join(" ");

  useEffect(() => {
    if (query.length < 2 || manual || selected) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Catalog unavailable");
        const payload = await response.json() as { results: CatalogSystem[] };
        if (!controller.signal.aborted) setSearch({ query, results: payload.results });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSearch({ query, results: [], error: "Systemkataloget kunne ikke hentes. Prøv en ny søgning, eller registrér systemet manuelt med en begrundelse." });
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [query, manual, selected]);

  return <div>
    <label className="subfield-label" htmlFor={id}>{label}</label>
    <div className={manual ? undefined : "lookup-field"}>
      {manual ? null : <Search size={18} aria-hidden="true" />}
      <input id={id} className={`clean-input${error ? " invalid" : ""}`} value={value}
        placeholder={manual ? "Angiv systemets navn" : "Søg på system, leverandør eller rettighedshaver"}
        aria-invalid={error ? true : undefined} aria-describedby={description}
        onChange={(event) => onChange(event.target.value, manual ? relation : null)} />
    </div>
    <p className="catalog-empty" id={`${id}-guidance`}>{catalogFreshnessLabel()} {!relation && value ? "Tekst alene er ikke et katalogvalg. Vælg et søgeresultat eller manuel registrering." : ""}</p>
    {selected ? <div className="lookup-card catalog-selection"><span><Check size={18} aria-hidden="true" /></span><div><strong>{relation.name}</strong><small>Valgt fra systemkataloget</small></div></div> : null}
    {!manual && !selected && query.length >= 2 ? <div className="catalog-results" aria-live="polite">
      {!ready ? <p className="catalog-empty">Søger i KITOS og Kalundborgs systemer…</p> : null}
      {ready ? search.results.map((system) => <CatalogResult key={system.id} system={system} onChoose={() => onChange(system.name, relationFromSystem(system))} />) : null}
      {ready && search.error ? <p className="catalog-empty catalog-error" role="alert">{search.error}</p> : null}
      {ready && !search.error && search.results.length === 0 ? <p className="catalog-empty">Ingen sikre resultater. Kontrollér stavningen, eller registrér systemet manuelt.</p> : null}
    </div> : null}
    {manual ? <>
      <label className="subfield-label" htmlFor={`${id}-reason`}>Hvorfor registreres systemet manuelt?</label>
      <textarea id={`${id}-reason`} className={`clean-input${error && !relation.reason.trim() ? " invalid" : ""}`} rows={2} maxLength={2000} value={relation.reason}
        placeholder="Fx et lokalt system, som ikke fremgår af kataloget" aria-required="true" aria-invalid={error && !relation.reason.trim() ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(value, { kind: "manual", reason: event.target.value })} />
      <button className="inline-action" type="button" onClick={() => onChange(value, null)}>Tilbage til katalogsøgning</button>
    </> : <button className="inline-action" type="button" onClick={() => onChange(value, { kind: "manual", reason: "" })}>Systemet kan ikke findes – registrér manuelt</button>}
    <FieldErrorText id={`${id}-error`} message={error} />
  </div>;
}
