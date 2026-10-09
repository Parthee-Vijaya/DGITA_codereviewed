"use client";
import { confirmNavigation, useUnsavedChanges } from "../application/use-unsaved-changes";

import {
  ImagePlus,
  PanelRightClose,
  PencilLine,
  RotateCcw,
  Save,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import {
  contentBody,
  isContentVisible,
  isSafeContentUrl,
  type ContentEntry,
  type ImageEntry,
} from "../workspace/model";
import { safeImagePreviewSource } from "./image-preview";

export type EditorSelection =
  | { kind: "content"; entry: ContentEntry }
  | { kind: "image"; entry: ImageEntry };

type EditableTextTag = "span" | "small" | "strong" | "p" | "h1" | "h2" | "h3";

export function EditableText({
  as: Tag = "span",
  content,
  contentId,
  fallback,
  editorMode,
  onEdit,
  className,
  insideInteractive = false,
}: {
  as?: EditableTextTag;
  content: ContentEntry[];
  contentId: string;
  fallback: string;
  editorMode: boolean;
  onEdit: (entry: ContentEntry) => void;
  className?: string;
  insideInteractive?: boolean;
}) {
  const entry = content.find((candidate) => candidate.id === contentId);
  const value = contentBody(content, contentId, fallback);

  if (!editorMode && !isContentVisible(content, contentId)) return null;

  function activate(event?: MouseEvent<HTMLElement>) {
    if (editorMode && entry) {
      event?.preventDefault();
      event?.stopPropagation();
      onEdit(entry);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  }

  return (
    <Tag
      className={[className, editorMode && entry ? "cms-editable-text" : ""]
        .filter(Boolean)
        .join(" ")}
      data-content-id={entry?.id}
      onClick={activate}
      onKeyDown={editorMode && entry && !insideInteractive ? onKeyDown : undefined}
      role={editorMode && entry && !insideInteractive ? "button" : undefined}
      tabIndex={editorMode && entry && !insideInteractive ? 0 : undefined}
      title={editorMode && entry ? `Redigér: ${entry.title}` : undefined}
    >
      {value || (editorMode && entry ? "Ikke publiceret" : "")}
      {editorMode && entry ? <span className="cms-edit-marker" aria-hidden="true"><PencilLine size={12} /></span> : null}
    </Tag>
  );
}

export function ManagedImage({
  images,
  imageId,
  fallbackSrc,
  fallbackAlt,
  editorMode,
  onEdit,
  priority,
}: {
  images: ImageEntry[];
  imageId: string;
  fallbackSrc: string;
  fallbackAlt: string;
  editorMode: boolean;
  onEdit: (entry: ImageEntry) => void;
  priority?: boolean;
}) {
  const entry = images.find((candidate) => candidate.id === imageId);
  const src = entry?.src || fallbackSrc;
  const alt = entry?.alt || fallbackAlt;

  return (
    <>
      {/* Runtime-redigerbare CMS-billeder kan komme fra sikre eksterne URL'er eller upload. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} />
      {editorMode && entry ? (
        <button
          className="cms-image-edit"
          type="button"
          onClick={() => onEdit(entry)}
          aria-label={`Erstat billede: ${entry.location}`}
        >
          <ImagePlus size={16} /> Erstat billede
        </button>
      ) : null}
    </>
  );
}

export function CollectionEditButton({
  entry,
  editorMode,
  onEdit,
}: {
  entry: ContentEntry;
  editorMode: boolean;
  onEdit: (entry: ContentEntry) => void;
}) {
  if (!editorMode) return null;
  return (
    <button
      className="cms-collection-edit"
      type="button"
      onClick={() => onEdit(entry)}
      aria-label={`Redigér ${entry.title}`}
    >
      <PencilLine size={13} /> Redigér
    </button>
  );
}

export function EditorToolbar({
  active,
  onToggle,
  onOpenLibrary,
}: {
  active: boolean;
  onToggle: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div className={active ? "cms-toolbar active" : "cms-toolbar"} role="region" aria-label="Admin editor mode">
      <div>
        <span><PencilLine size={15} /></span>
        <div><strong>Editor mode {active ? "aktiv" : "slået fra"}</strong><small>{active ? "Klik på markeret tekst eller billeder" : "Redigér siden visuelt"}</small></div>
      </div>
      {active ? <button type="button" onClick={onOpenLibrary}><PanelRightClose size={15} /> Alt indhold</button> : null}
      <button className="cms-toolbar-toggle" type="button" aria-pressed={active} onClick={onToggle}>{active ? "Afslut" : "Start editor"}</button>
    </div>
  );
}

export function EditorDrawer({
  selection,
  onClose,
  onSaveContent,
  onSaveImage,
  onResetImages,
  onOpenLibrary,
}: {
  selection: EditorSelection | null;
  onClose: () => void;
  onSaveContent: (entry: ContentEntry) => Promise<boolean>;
  onSaveImage: (entry: ImageEntry) => Promise<boolean>;
  onResetImages: () => Promise<boolean>;
  onOpenLibrary: () => void;
}) {
  const [draft, setDraft] = useState<EditorSelection | null>(selection);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(selection), saving || uploading);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) return;
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && confirmNavigation()) onClose();
      if (event.key === "Tab") {
        const drawer = closeRef.current?.closest("[role='dialog']");
        const controls = Array.from(drawer?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]") ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, [onClose, selection]);

  if (!selection || !draft) return null;
  const imagePreviewSource = draft.kind === "image" ? safeImagePreviewSource(draft.entry.src) : null;

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || draft?.kind !== "image") return;
    if (!file.type.startsWith("image/")) {
      setError("Vælg en billedfil.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const src = await compressImage(file);
      setDraft((current) => current?.kind === "image" && current.entry.id === draft.entry.id ? { ...current, entry: { ...current.entry, src } } : current);
    } catch {
      setError("Billedet kunne ikke læses. Prøv PNG, JPG eller WebP.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const currentDraft = draft;
    if (!currentDraft) return;
    if (currentDraft.kind === "content") {
      if (!currentDraft.entry.body.trim()) {
        setError("Tekstfeltet må ikke være tomt. Brug publiceringsknappen, hvis indholdet skal skjules.");
        return;
      }
      if (currentDraft.entry.url && !isSafeContentUrl(currentDraft.entry.url)) {
        setError("Brug https://, mailto: eller en intern sti, der starter med /.");
        return;
      }
      setSaving(true);
      try {
        if (await onSaveContent(currentDraft.entry)) onClose();
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!safeImagePreviewSource(currentDraft.entry.src)) {
      setError("Brug en sikker https-adresse, en intern /sti eller upload en billedfil.");
      return;
    }
    if (!currentDraft.entry.alt.trim()) {
      setError("Skriv en beskrivende alttekst af hensyn til tilgængelighed.");
      return;
    }
    setSaving(true);
    try {
      if (await onSaveImage(currentDraft.entry)) onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetImages() {
    if (!window.confirm("Gendan standardbillederne? Dine egne billedvalg vil blive erstattet.")) return;
    setSaving(true);
    setError("");
    try {
      if (await onResetImages()) onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="cms-drawer-backdrop" type="button" onClick={() => { if (confirmNavigation()) onClose(); }} aria-label="Luk editor" />
      <aside className="cms-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><span className="section-label dark">Admin · Editor mode</span><h2 id={titleId}>{draft.kind === "content" ? "Redigér tekst" : "Erstat billede"}</h2></div>
          <button ref={closeRef} type="button" onClick={() => { if (confirmNavigation()) onClose(); }} aria-label="Luk editor"><X size={20} /></button>
        </header>

        <div className="cms-drawer-body">
          <p className="cms-location">{draft.entry.location}</p>
          {draft.kind === "content" ? (
            <>
              <label>Administrativ titel<input value={draft.entry.title} onChange={(event) => setDraft({ kind: "content", entry: { ...draft.entry, title: event.target.value } })} /></label>
              <label>Tekst<textarea rows={8} value={draft.entry.body} onChange={(event) => setDraft({ kind: "content", entry: { ...draft.entry, body: event.target.value } })} /></label>
              {draft.entry.id === "link.contact" ? <p>Kontaktlinket bruger den fælles e-mailadresse. Ret den under Portaltekster → Kontakt · e-mail.</p> : draft.entry.category === "link" ? <label>Linkadresse<input value={draft.entry.url ?? ""} onChange={(event) => setDraft({ kind: "content", entry: { ...draft.entry, url: event.target.value } })} /></label> : null}
              <label className="cms-publish"><input type="checkbox" checked={draft.entry.published} onChange={(event) => setDraft({ kind: "content", entry: { ...draft.entry, published: event.target.checked } })} /><span /> Publiceret</label>
            </>
          ) : (
            <>
              <div className="cms-image-preview">
                {imagePreviewSource ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagePreviewSource} alt="Forhåndsvisning af valgt portalbillede" />
                ) : <p role="status">Skriv en gyldig billedadresse, eller upload et billede.</p>}
              </div>
              <label>Billedadresse<input value={draft.entry.src} onChange={(event) => setDraft({ kind: "image", entry: { ...draft.entry, src: event.target.value } })} /></label>
              <label>Alttekst<input value={draft.entry.alt} onChange={(event) => setDraft({ kind: "image", entry: { ...draft.entry, alt: event.target.value } })} /></label>
              <label className="cms-upload-button"><Upload size={16} /> {uploading ? "Behandler billede…" : "Upload fra computer"}<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" disabled={uploading} onChange={uploadImage} /></label>
              <button className="cms-reset-images" type="button" disabled={saving} onClick={() => void resetImages()}><RotateCcw size={15} /> Gendan standardbilleder</button>
            </>
          )}
          {error ? <p className="cms-error" role="alert">{error}</p> : null}
        </div>

        <footer>
          <button type="button" onClick={onOpenLibrary}><PencilLine size={15} /> Åbn indholdsbibliotek</button>
          <button className="cms-save" type="button" disabled={saving || uploading} onClick={() => void save()}><Save size={16} /> {saving ? "Gemmer…" : "Gem ændring"}</button>
        </footer>
      </aside>
    </>
  );
}

async function compressImage(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas mangler");
  context.drawImage(image, 0, 0, width, height);
  const encoded = canvas.toDataURL("image/webp", 0.82);
  if (encoded.length > 3_500_000) throw new Error("Billedet er for stort");
  return encoded;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Ugyldig fil"));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Ugyldigt billede"));
    image.src = src;
  });
}
