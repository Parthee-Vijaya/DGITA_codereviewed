"use client";

import { Info, Paperclip, Upload, X } from "lucide-react";
import { useContext, useId, type ChangeEvent, type ReactNode } from "react";
import { getUploadPolicy, type AttachmentDraft, type UploadKind } from "./engine";
import { describedBy, labelQuestionControls, QuestionLabelContext, QuestionErrorContext, QuestionHintContext } from "./QuestionContent";

export function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const titleId = useId();
  const errorId = `${titleId}-error`;
  const hintId = hint ? `${titleId}-hint` : undefined;
  return (
    <QuestionLabelContext.Provider value={title}>
      <QuestionErrorContext.Provider value={errorId}>
        <QuestionHintContext.Provider value={hintId}>
          <div className="question" role="group" aria-labelledby={titleId}>
            <div className="question-copy"><div className="question-title" id={titleId}>{title}</div>{hint ? <p id={hintId}>{hint}</p> : null}</div>
            <div>{labelQuestionControls(children, title, errorId, hintId)}</div>
          </div>
        </QuestionHintContext.Provider>
      </QuestionErrorContext.Provider>
    </QuestionLabelContext.Provider>
  );
}

export function Money({ id, value, error, onChange }: { id?: string; value: string; error?: string; onChange: (value: string) => void }) {
  const title = useContext(QuestionLabelContext);
  const hintId = useContext(QuestionHintContext);
  const questionErrorId = useContext(QuestionErrorContext);
  const localId = useId();
  const errorId = questionErrorId ?? `${localId}-error`;
  return <><div className="money-field"><span>DKK</span><input id={id} aria-label={id ? undefined : title} aria-invalid={error ? true : undefined} aria-describedby={describedBy(hintId, error ? errorId : undefined)} className={error ? "invalid" : undefined} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /></div><FieldErrorText id={errorId} message={error} /></>;
}

export function UploadField({ kind, title, detail, files, error, onAdd, onRemove, icon = "upload" }: { kind: UploadKind; title: string; detail?: string; files: AttachmentDraft[]; error?: string; onAdd: (kind: UploadKind, event: ChangeEvent<HTMLInputElement>) => void | Promise<void>; onRemove: (kind: UploadKind, id: string) => void | Promise<void>; icon?: "upload" | "paperclip" }) {
  const id = useId();
  const Icon = icon === "paperclip" ? Paperclip : Upload;
  const policy = getUploadPolicy(kind);
  return (
    <div className={`upload-group${error ? " has-error" : ""}`}>
      <div className="upload-field"><Icon size={22} aria-hidden="true" /><div><strong>{title}</strong><small id={`${id}-hint`}>{detail ? `${detail} · ` : ""}{policy.guidance}</small></div>
        <label className="upload-button">Vælg fil<input type="file" multiple accept={policy.accept} aria-label={`Vælg fil til ${title}`} aria-describedby={describedBy(`${id}-hint`, error ? `${id}-error` : undefined)} aria-invalid={error ? true : undefined} onChange={(event) => onAdd(kind, event)} /></label>
      </div>
      <div className={files.length ? "upload-list" : undefined} aria-live="polite" aria-relevant="additions text">
        {files.map((file) => <div className={`upload-file${file.status === "failed" ? " failed" : ""}`} key={file.id}><FileStatus file={file} /><button type="button" onClick={() => onRemove(kind, file.id)} aria-label={`Fjern ${file.name}`}><X size={15} aria-hidden="true" /></button></div>)}
      </div>
      <FieldErrorText id={`${id}-error`} message={error} />
    </div>
  );
}

function FileStatus({ file }: { file: AttachmentDraft }) {
  const status = file.status === "uploading" ? "uploades…" : file.status === "uploaded" ? "uploadet" : file.status === "failed" ? "upload mislykkedes" : "klar til upload";
  return <div><strong>{file.name}</strong><small>{file.error || `${formatBytes(file.size)} · ${status}`}</small></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("da-DK", { maximumFractionDigits: 1 })} MB`;
}

export function FormMessage({ tone, title, messages }: { tone: "error" | "warning"; title: string; messages: string[] }) {
  return <div className={`form-message ${tone}`} tabIndex={tone === "error" ? -1 : undefined} role={tone === "error" ? "alert" : undefined}><Info size={20} aria-hidden="true" /><div><strong>{title}</strong>{messages.map((message) => <p key={message}>{message}</p>)}</div></div>;
}

export function FieldErrorText({ id, message }: { id?: string; message?: string }) {
  const errorId = useContext(QuestionErrorContext);
  return message ? <p id={id ?? errorId} className="field-error">{message}</p> : null;
}
