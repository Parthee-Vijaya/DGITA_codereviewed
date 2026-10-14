"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MessageSquare, XCircle } from "lucide-react";
import { useUnsavedChanges } from "../application/use-unsaved-changes";
import type { CaseRecord } from "../workspace/model";

type Action = { kind: "information" | "reject"; revision: number; versionId: string; updatedAt: string | null };
type Props = { item: CaseRecord; approvalUpdatedAt: string | null; ready: boolean; onChanged: () => Promise<void>; onToast: (message: string) => void };

export function CaseDecisionActions({ item, approvalUpdatedAt, ready, onChanged, onToast }: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const clearGuard = useUnsavedChanges(Boolean(action && (reason || dueDate)), busy);
  useEffect(() => { if (action) reasonRef.current?.focus(); }, [action]);

  if (!item.currentVersionId || item.status === "closed") return null;
  const locked = Boolean(item.leaderReviewLocked);
  const stale = action && (action.versionId !== item.currentVersionId || action.revision !== item.revision);
  const unavailable = !ready || item.revision === undefined || locked || busy;

  function open(kind: Action["kind"]) {
    if (unavailable || !item.currentVersionId || item.revision === undefined) return;
    setAction({ kind, revision: item.revision, versionId: item.currentVersionId, updatedAt: approvalUpdatedAt });
    setReason(""); setDueDate(""); setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || unavailable || stale) return;
    if (!reason.trim()) { setError("Beskriv konkret, hvad anmoderen skal vide."); reasonRef.current?.focus(); return; }
    if (action.kind === "information" && !dueDate) { setError("Angiv en frist for oplysningerne."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action.kind === "information" ? "application.request-information" : "approval.reject",
          caseId: item.id, reason: reason.trim(), expectedRowVersion: action.revision, expectedVersionId: action.versionId,
          ...(action.kind === "information" ? { dueDate } : { expectedUpdatedAt: action.updatedAt }),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Handlingen kunne ikke gemmes. Dine oplysninger er bevaret her.");
      clearGuard(); setAction(null); setReason(""); setDueDate("");
      onToast(action.kind === "information" ? "Anmodningen om oplysninger er gemt på sagen." : "Sagen er afsluttet med et endeligt afslag.");
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }

  return <section className="plain-section case-decision-actions" aria-label="Retur eller endeligt afslag">
    <div className="plain-heading"><div><span className="section-label dark">Behandling</span><h2>Oplysninger eller endelig beslutning</h2></div></div>
    <p>Bed om oplysninger, når ansøgningen skal suppleres. Et endeligt afslag afslutter sagen og åbner ikke for genindsendelse.</p>
    {locked ? <p role="status">Tilbagekald først den åbne anmodning under Ledergodkendelse, før sagen sendes retur eller afslås.</p> : null}
    {!ready ? <p role="status">Henter sagens seneste vurdering…</p> : null}
    {!action ? <div className="case-decision-buttons">
      <button className="line-button" type="button" disabled={unavailable || item.status === "changes_requested"} onClick={() => open("information")}><MessageSquare size={17} aria-hidden="true" /> Bed om oplysninger</button>
      <button className="line-button" type="button" disabled={unavailable} onClick={() => open("reject")}><XCircle size={17} aria-hidden="true" /> Afvis endeligt</button>
    </div> : <form onSubmit={(event) => void submit(event)} aria-label={action.kind === "information" ? "Bed om oplysninger" : "Endeligt afslag"}>
      <h3>{action.kind === "information" ? "Hvilke oplysninger mangler?" : "Begrund det endelige afslag"}</h3>
      <p id={`${id}-guidance`}>{action.kind === "information" ? "Anmoderen ser begrundelsen og fristen på sagen og kan genindsende en ny version. Den nye version skal ledergodkendes igen." : "Begrundelsen vises for anmoderen og i slutkvitteringen. Sagen låses, når du bekræfter afslaget."}</p>
      <label className="subfield-label" htmlFor={`${id}-reason`}>Begrundelse til anmoderen</label>
      <textarea ref={reasonRef} id={`${id}-reason`} className="clean-input" rows={4} maxLength={8000} value={reason} required disabled={busy} aria-describedby={`${id}-guidance${error ? ` ${id}-error` : ""}`} onChange={(event) => setReason(event.target.value)} />
      {action.kind === "information" ? <><label className="subfield-label" htmlFor={`${id}-due`}>Frist for oplysninger</label><input id={`${id}-due`} className="clean-input" type="date" required disabled={busy} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /><p>Fristen hjælper med opfølgning. Sagen afslås ikke automatisk, hvis fristen overskrides.</p></> : null}
      {stale ? <p role="alert">Sagen er ændret, siden du åbnede handlingen. Luk formularen, og åbn den igen fra sagens aktuelle version.</p> : null}
      {error ? <p id={`${id}-error`} ref={errorRef} tabIndex={-1} className="field-error" role="alert">{error}</p> : null}
      <div className="case-decision-buttons"><button className="solid-button" disabled={unavailable || Boolean(stale)} type="submit">{busy ? "Gemmer…" : action.kind === "information" ? "Send anmodning om oplysninger" : "Bekræft endeligt afslag"}</button><button className="line-button" type="button" disabled={busy} onClick={() => { clearGuard(); setAction(null); setReason(""); setDueDate(""); setError(""); }}>Annuller</button></div>
    </form>}
  </section>;
}

export function InformationRequestNotice({ item, canCorrect }: { item: CaseRecord; canCorrect: boolean }) {
  const request = item.informationRequest;
  if (item.status !== "changes_requested" || !request) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(request.dueDate) ? request.dueDate.split("-").reverse().join(".") : request.dueDate;
  return <section className="plain-section information-request-notice" aria-label="Oplysninger efterspurgt">
    <div className="plain-heading"><span className="section-label dark">Mangler oplysninger</span><h2>Ansøgningen skal suppleres</h2></div>
    <p className="information-request-reason">{request.reason}</p><p><strong>Frist for oplysninger: <time dateTime={request.dueDate}>{date}</time></strong></p>
    <p>{canCorrect ? "Vælg Ret og genindsend for at arbejde videre." : "Anmoderen kan nu rette og genindsende ansøgningen."} Den tidligere version og dens kommentarer bevares.</p>
  </section>;
}

export function FinalDecisionNotice({ item }: { item: CaseRecord }) {
  const decision = item.finalDecision;
  if (item.status !== "closed" || !decision) return null;
  return <section className="plain-section" aria-label="Endelig D-GITA-beslutning">
    <div className="plain-heading"><span className="section-label dark">Sagen er afsluttet</span>
    <h2>{decision.outcome === "approved" ? "Godkendt af D-GITA" : "Endeligt afslag fra D-GITA"}</h2></div>
    <p className="information-request-reason">{decision.reason || "Der er ikke angivet en offentlig begrundelse."}</p>
    <p>Den endelige beslutning fremgår også af slutkvitteringen.</p>
  </section>;
}
