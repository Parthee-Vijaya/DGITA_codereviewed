"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { ResponsiblePersonOption } from "./responsible-directory";

export function useResponsiblePeople() {
  const [people, setPeople] = useState<ResponsiblePersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/workspace/responsible-people", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { people?: ResponsiblePersonOption[] } | null;
        if (!response.ok || !Array.isArray(data?.people) || !data.people.every((person) => person && typeof person.id === "string" && typeof person.name === "string" && typeof person.identifier === "string")) throw new Error("Personlisten kunne ikke hentes. Prøv igen.");
        if (!controller.signal.aborted) { setPeople(data.people); setError(null); }
      } catch {
        if (!controller.signal.aborted) setError("Personlisten kunne ikke hentes. Prøv igen.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return { people, loading, error, retry };
}

export function ResponsiblePersonSelect({ label, id, name, people, disabled, onChange }: {
  label: string; id: string; name: string; people: ResponsiblePersonOption[]; disabled: boolean;
  onChange: (id: string, name: string) => void;
}) {
  const historicValue = id || (name ? "__historic__" : "");
  const historic = Boolean(name || id) && !people.some((person) => person.id === id);
  return <label className="clean-select review-select"><select aria-label={label} value={historicValue} disabled={disabled} onChange={(event) => {
    const person = people.find((item) => item.id === event.target.value);
    onChange(person?.id ?? "", person?.name ?? "");
  }}>
    <option value="">Ikke valgt</option>
    {historic ? <option value={historicValue} disabled>{name || "Tidligere valgt person"} · tidligere angivelse</option> : null}
    {people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.identifier}</option>)}
  </select><ChevronDown size={16} /></label>;
}

export function AdditionalResponsiblePeople({ ids, snapshotNames, primaryId, people, disabled, onChange }: {
  ids: string[]; snapshotNames: string; primaryId: string; people: ResponsiblePersonOption[]; disabled: boolean;
  onChange: (ids: string[], names: string) => void;
}) {
  const available = people.filter((person) => person.id !== primaryId && !ids.includes(person.id));
  function update(nextIds: string[]) {
    onChange(nextIds, nextIds.map((id) => people.find((person) => person.id === id)?.name ?? "Tidligere valgt person").join(", "));
  }
  return <div>
    {ids.length ? <ul className="responsible-people-list">{ids.map((id, index) => {
      const person = people.find((entry) => entry.id === id);
      return <li key={id}>
        <span>{person ? `${person.name} · ${person.identifier}` : "Tidligere valgt person · tidligere angivelse"}</span>
        <button className="table-action" type="button" disabled={disabled} aria-label={`Fjern yderligere ansvarlig ${index + 1}`} onClick={() => update(ids.filter((value) => value !== id))}><X size={16} /></button>
      </li>;
    })}</ul> : snapshotNames ? <p>Tidligere angivelse: {snapshotNames}. Vælg personerne i listen, når du vil ændre angivelsen.</p> : null}
    <label className="clean-select review-select"><select aria-label="Tilføj yderligere D-GITA-ansvarlig" value="" disabled={disabled || ids.length >= 20 || available.length === 0} onChange={(event) => { if (event.target.value) update([...ids, event.target.value]); }}>
      <option value="">{ids.length >= 20 ? "Højst 20 ansvarlige" : available.length === 0 ? "Ingen flere aktive personer" : "Vælg en person at tilføje"}</option>
      {available.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.identifier}</option>)}
    </select><ChevronDown size={16} /></label>
  </div>;
}
