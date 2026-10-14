"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Question } from "../application/ApplicationFields";
import { confirmNavigation, useUnsavedChanges } from "../application/use-unsaved-changes";
import { KleAssessmentFields } from "../kle/KleAssessmentFields";
import { createEmptyKleReview, isKleReview, type KleReview } from "../kle/domain";
import type { SystemUsage } from "./repository";
import styles from "./KleUsagePreview.module.css";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

async function readUsageResponse(response: Response): Promise<SystemUsage> {
  const data = await response.json() as { error?: unknown; usage?: SystemUsage };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Registreringen kunne ikke gemmes. Dine indtastninger er bevaret.");
  if (!data.usage || typeof data.usage.id !== "string" || !Number.isSafeInteger(data.usage.rowVersion) || !isKleReview(data.usage.review)) {
    throw new Error("Serverens svar kunne ikke læses. Dine indtastninger er bevaret.");
  }
  return data.usage;
}

export function KleUsagePreview({ initialUsages }: { initialUsages: SystemUsage[] }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [usages, setUsages] = useState(initialUsages);
  const [saved, setSaved] = useState<SystemUsage | null>(null);
  const [name, setName] = useState("");
  const [review, setReview] = useState<KleReview>(() => createEmptyKleReview());
  const [legacyText, setLegacyText] = useState("");
  const creationId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const disabled = busy || !hydrated;
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const legacyError = review.legacyTopics.length > 50 ? "Angiv højst 50 forskellige opgaver." : review.legacyTopics.some((topic) => topic.length > 256) ? "Hver opgave må højst fylde 256 tegn. Del længere beskrivelser op på flere linjer." : "";
  const dirty = name !== (saved?.name ?? "") || JSON.stringify(review) !== JSON.stringify(saved?.review ?? createEmptyKleReview());
  useUnsavedChanges(dirty, busy);

  function load(usage: SystemUsage | null) {
    setSaved(usage);
    setName(usage?.name ?? "");
    setReview(usage?.review ?? createEmptyKleReview());
    setLegacyText(usage?.review.legacyTopics.join("\n") ?? "");
    creationId.current = usage?.id ?? null;
    setError(""); setConflict(false); setStatus("");
  }
  function edit(value: KleReview) { setReview(value); setStatus(""); }

  async function save(confirm = false) {
    if (pending.current || !hydrated) return;
    if (!name.trim() || legacyError) {
      setError(legacyError || "Angiv et navn på systemanvendelsen, før du gemmer.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    pending.current = true; setBusy(true); setError(""); setStatus(""); setConflict(false);
    try {
      creationId.current ??= crypto.randomUUID();
      const response = await fetch("/api/system-usages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: saved ? (confirm ? "confirm" : "save") : "create", name, review,
          id: saved?.id ?? creationId.current, ...(saved ? { expectedRowVersion: saved.rowVersion } : {}) }),
      });
      setConflict(response.status === 409);
      const usage = await readUsageResponse(response);
      load(usage);
      setUsages((current) => [usage, ...current.filter((item) => item.id !== usage.id)]);
      setStatus(confirm ? "Registreringen er gemt og bekræftet af dig." : "Registreringen er gemt.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Forbindelsen blev afbrudt. Dine indtastninger er bevaret.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { pending.current = false; setBusy(false); }
  }

  async function reloadLatest() {
    const id = saved?.id ?? creationId.current;
    if (!id || pending.current || !confirmNavigation()) return;
    pending.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/system-usages?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const usage = await readUsageResponse(response);
      load(usage);
      setUsages((current) => [usage, ...current.filter((item) => item.id !== usage.id)]);
      setStatus("Den seneste gemte version er hentet.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Den seneste version kunne ikke hentes.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <Link href="/" className={styles.back} onClick={(event) => { if (!confirmNavigation()) event.preventDefault(); }}><ArrowLeft size={17} aria-hidden="true" /> Tilbage til D-GITA</Link>
    <header className={styles.header}><p className={styles.eyebrow}>D-GITA · Lokal afprøvning</p><h1>Arbejdsopgaver og kritikalitet</h1><p>Afprøv KLE-valg og den lokale vurdering for en systemanvendelse. Brug kun opdigtede oplysninger.</p></header>
    <div className={styles.note}><strong>Afprøvning med eksempeldata</strong><p>Koder og opgavematch er syntetiske. Bekræftelsen gælder din registrering og er ikke en formel ejeraccept. Der overføres ingen oplysninger til KITOS eller SHIELD.</p></div>
    <section className={styles.form} aria-label="Systemanvendelse">
      <Question title="Dine eksempelregistreringer"><select className="clean-input" value={saved?.id ?? ""} disabled={disabled} onChange={(event) => {
        if (!confirmNavigation()) return;
        load(usages.find((usage) => usage.id === event.target.value) ?? null);
      }}><option value="">Opret en ny systemanvendelse</option>{usages.map((usage) => <option key={usage.id} value={usage.id}>{usage.name}</option>)}</select></Question>
      <Question title="Navn på systemanvendelsen" hint="Beskriv den lokale anvendelse, fx Fælles login til kommunens fagsystemer."><input className="clean-input" value={name} maxLength={200} disabled={disabled} onChange={(event) => {
        setName(event.target.value); const next = { ...review }; delete next.confirmation; edit(next);
      }} /></Question>
      <Question title="Tidligere fritekst om arbejdsopgaver" hint="Valgfrit. Én linje pr. opgave, højst 256 tegn pr. linje. Tomme og gentagne linjer udelades ved gemning."><textarea className="clean-input" rows={2} value={legacyText} maxLength={12850} disabled={disabled} aria-invalid={legacyError ? true : undefined} aria-describedby={legacyError ? "legacy-topics-error" : undefined} onChange={(event) => {
        setLegacyText(event.target.value);
        const next = { ...review, legacyTopics: [...new Set(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))] }; delete next.confirmation; edit(next);
      }} /></Question>
      {legacyError ? <p id="legacy-topics-error" className="field-error">{legacyError}</p> : null}
      <KleAssessmentFields value={review} onChange={edit} disabled={disabled} initiallyOpen onConfirm={saved ? () => void save(true) : undefined} />
      {!saved ? <p className={styles.helper}>Gem systemanvendelsen først. Derefter kan du bekræfte den udfyldte registrering.</p> : null}
      {error ? <div className="form-message error" role="alert" tabIndex={-1} ref={errorRef}><div><strong>Registreringen kunne ikke gemmes</strong><p>{error}</p>{conflict ? <><p>Dine indtastninger er bevaret. Du kan hente den senest gemte version, når du er klar til at erstatte dem.</p><button type="button" className="line-button" disabled={busy} onClick={() => void reloadLatest()}>Hent seneste version</button></> : null}</div></div> : null}
      <footer className={styles.actions}><button type="button" className="solid-button" disabled={disabled} onClick={() => void save()}><Save size={17} aria-hidden="true" /> {busy ? "Gemmer…" : "Gem registrering"}</button><span role="status">{!hydrated ? "Gør formularen klar…" : status || (dirty ? "Du har ugemte ændringer." : saved ? `Gemt som version ${saved.rowVersion}.` : "")}</span></footer>
    </section>
  </main>;
}
