"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Info,
  Mail,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { CatalogResult, CatalogSelection } from "../catalog/CatalogCards";
import { CatalogRelationField } from "../catalog/CatalogRelationField";
import { catalogFreshnessLabel } from "../catalog/metadata";
import { normalizeRelationChanges } from "../catalog/relations";
import type { CatalogSystem } from "../catalog/search";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { Question, Money, UploadField, FormMessage, FieldErrorText } from "./ApplicationFields";
import { SegmentedChoice } from "../ui/SegmentedChoice";
import { AiScreeningFields } from "./AiScreeningFields";
import { aiUsageLabel, hasAiScreeningDetails, normalizeAiScreeningChanges } from "./ai-screening";
import {
  isAllowedPrivateBlobUrl,
  isAllowedVercelBlobUploadUrl,
  sha256File,
} from "./direct-upload-client";
import {
  ACQUISITION_METHODS,
  DATA_CLASSIFICATIONS,
  USER_COUNT_OPTIONS,
  canOpenStep,
  createAttachmentDraft,
  firstInvalidStep,
  formatDanishAmount,
  getAllErrors,
  getDisplaySystemName,
  getFinanceTotal,
  getStepErrors,
  getStepWarnings,
  initialApplicationState,
  isFieldVisible,
  normalizeApprovingLeader,
  pruneHiddenAnswers,
  type ApplicationFormState,
  type AttachmentDraft,
  type FieldError,
  type SelectedCatalogSystem,
  type UploadKind,
  type YesNo,
} from "./engine";

const steps = [
  "Generelle oplysninger",
  "Systemoplysninger",
  "Anskaffelsesform",
  "Værdi for kommunen",
  "Investering",
  "Risiko & data",
  "Implementering",
  "IT-krav",
  "Øvrige",
  "Gennemse",
];

const descriptions = [
  "Vi starter med at afklare systemet, kontaktpersonen og organisationen.",
  "Angiv ansvar for data, system, kontrakt og den tilhørende ESDH-sag.",
  "Beskriv hvordan systemet anskaffes, og hvordan markedet er undersøgt.",
  "Gør det tydeligt, hvilken forandring og værdi systemet skal skabe.",
  "Saml omkostninger, budget og forventede gevinster.",
  "Vurdér risiko, persondata og behovet for aftaler og dokumentation.",
  "Planlæg milepæle, ressourcer, datoer og antal brugere.",
  "Dokumentér arkitektur, leverandørkrav og systemets sammenhænge.",
  "Vælg den godkendende chef, og tilføj eventuelle bemærkninger.",
  "Kontrollér oplysningerne, før ansøgningen låses og sendes.",
];

const DIRECT_BLOB_UPLOADS = process.env.NEXT_PUBLIC_DGITA_UPLOAD_MODE === "vercel-blob";

export type ApplicationSubmissionResult = {
  id: string;
  caseNumber: string;
  status: "submitted";
  versionNumber: number;
  submittedAt: string;
  mode: "draft" | "correction";
  rowVersion: number;
};

type CorrectionContext = {
  caseNumber: string;
  currentVersionNumber: number;
  nextVersionNumber: number;
  informationRequest?: {
    reason: string;
    dueDate: string | null;
  } | null;
  rejection: {
    approverName: string;
    comment: string;
    decidedAt: string | null;
  } | null;
};

type Props = {
  onBack: () => void;
  onSubmit: (
    snapshot: Record<string, unknown>,
    result: ApplicationSubmissionResult,
  ) => void;
  onToast: (message: string) => void;
  correctionCaseNumber?: string | null;
  draftCaseNumber?: string | null;
  guidance?: {
    intro?: string;
    catalog?: string;
    marketResearch?: string;
  };
};

export function ApplicationFormView({
  onBack,
  onSubmit,
  onToast,
  guidance,
  correctionCaseNumber = null,
  draftCaseNumber = null,
}: Props) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: "heading" | "errors" } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.target === "errors"
      ? sheetRef.current?.querySelector<HTMLElement>(".form-message.error") ?? headingRef.current
      : headingRef.current;
    // Step height changes can move the browser's scroll anchor after React's
    // commit. Position focus on the next frame, once the new layout is ready.
    const frame = requestAnimationFrame(() => {
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);
  const [form, setForm] = useState<ApplicationFormState>(() =>
    structuredClone(initialApplicationState),
  );
  const [attemptedSteps, setAttemptedSteps] = useState<number[]>([]);
  const [results, setResults] = useState<CatalogSystem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [approvers, setApprovers] = useState<Array<{ id: string; name: string }>>([]);
  const [approversError, setApproversError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correction, setCorrection] = useState<CorrectionContext | null>(null);
  const [activeUploads, setActiveUploads] = useState(0);
  const activeUploadsRef = useRef(0);
  const [pendingSaves, setPendingSaves] = useState(0);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const submittingRef = useRef(false);
  const [savedFingerprint, setSavedFingerprint] = useState(() => JSON.stringify(initialApplicationState));
  const clearUnsavedGuard = useUnsavedChanges(JSON.stringify(form) !== savedFingerprint, pendingSaves > 0 || activeUploads > 0);
  const draftIdRef = useRef<string | null>(null);
  const rowVersionRef = useRef<number | null>(null);
  const formRef = useRef(form);
  const currentErrors = getStepErrors(form, step);
  const currentWarnings = getStepWarnings(form, step);
  const showErrors = attemptedSteps.includes(step);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/approvers", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { approvers?: Array<{ id: string; name: string }>; error?: string };
        if (!response.ok || !Array.isArray(payload.approvers)) throw new Error(payload.error || "Godkenderne kunne ikke hentes.");
        if (!controller.signal.aborted) {
          setApprovers(payload.approvers);
          setApproversError(payload.approvers.length === 0 ? "Der er endnu ikke tildelt en godkender til din kommune. Kontakt administratoren." : null);
        }
      } catch (error) {
        if (!controller.signal.aborted) setApproversError(error instanceof Error ? error.message : "Godkenderne kunne ikke hentes.");
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const emptyState = structuredClone(initialApplicationState);
    draftIdRef.current = null;
    rowVersionRef.current = null;
    formRef.current = emptyState;
    setForm(emptyState);
    setStep(0);
    setAttemptedSteps([]);
    setResults([]);
    setCorrection(null);
    setActiveUploads(0);
    setLoadError(null);
    setSaveStatus("loading");
    if (!correctionCaseNumber && !draftCaseNumber) {
      draftIdRef.current = crypto.randomUUID();
      setSavedFingerprint(JSON.stringify(emptyState));
      setSaveStatus("idle");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const response = correctionCaseNumber
          ? await fetch("/api/drafts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "begin-correction",
                caseNumber: correctionCaseNumber,
              }),
              cache: "no-store",
              signal: controller.signal,
            })
          : await fetch(`/api/drafts?caseNumber=${encodeURIComponent(draftCaseNumber!)}`, {
              cache: "no-store",
              signal: controller.signal,
            });
        const payload = (await response.json()) as {
          draft: {
            id: string;
            caseNumber: string;
            state: ApplicationFormState;
            mode?: "correction";
            currentVersionNumber?: number;
            nextVersionNumber?: number;
            rowVersion: number;
            rejection?: CorrectionContext["rejection"];
            informationRequest?: CorrectionContext["informationRequest"];
          } | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Kladden kunne ikke hentes.");
        }
        if (controller.signal.aborted) return;
        if (payload.draft?.state.schemaVersion === "dgita-v1") {
          const restoredState = normalizeApprovingLeader(payload.draft.state);
          draftIdRef.current = payload.draft.id;
          rowVersionRef.current = payload.draft.rowVersion;
          formRef.current = restoredState;
          setForm(restoredState);
          setSavedFingerprint(JSON.stringify(restoredState));
          if (
            payload.draft.mode === "correction" &&
            typeof payload.draft.currentVersionNumber === "number" &&
            typeof payload.draft.nextVersionNumber === "number"
          ) {
            setCorrection({
              caseNumber: payload.draft.caseNumber,
              currentVersionNumber: payload.draft.currentVersionNumber,
              nextVersionNumber: payload.draft.nextVersionNumber,
              rejection: payload.draft.rejection ?? null,
              informationRequest: payload.draft.informationRequest ?? null,
            });
          }
          setSaveStatus("saved");
        } else if (correctionCaseNumber || draftCaseNumber) {
          throw new Error("Sagen kunne ikke åbnes til rettelser.");
        } else {
          draftIdRef.current = crypto.randomUUID();
          rowVersionRef.current = null;
          setSaveStatus("idle");
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        draftIdRef.current = null;
        rowVersionRef.current = null;
        setLoadError((error as Error).message);
        setSaveStatus("error");
      }
    })();
    return () => controller.abort();
  }, [correctionCaseNumber, draftCaseNumber]);

  useEffect(() => {
    const query = form.catalogQuery.trim();
    if (
      query.length < 2 ||
      form.knownSystem !== "ja" ||
      form.manualCatalogEntry ||
      form.selectedSystem
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Katalogsøgningen svarede ikke.");
        const payload = (await response.json()) as { results: CatalogSystem[] };
        setResults(payload.results);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResults([]);
          setCatalogError(
            "Systemkataloget kan ikke kontaktes lige nu. Prøv igen, før du registrerer systemet manuelt.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    form.catalogQuery,
    form.knownSystem,
    form.manualCatalogEntry,
    form.selectedSystem,
  ]);

  function update<K extends keyof ApplicationFormState>(
    field: K,
    value: ApplicationFormState[K],
  ) {
    setSaveStatus("idle");
    changeForm((current) => ({ ...current, [field]: value }));
  }

  function changeForm(
    updater: (current: ApplicationFormState) => ApplicationFormState,
  ) {
    if (submittingRef.current) return formRef.current;
    const changed = updater(formRef.current);
    const next = normalizeAiScreeningChanges(formRef.current, normalizeRelationChanges(formRef.current, changed));
    if ((changed.replacementSystem && !next.replacementSystem && next.replacesExisting === "ja") ||
        (changed.relatedSystem && !next.relatedSystem && next.acquisitionType === "tilkøb")) {
      onToast("Systemvalget er ændret. Vælg de tilknyttede systemer igen, så ansøgningen bruger de rigtige relationer.");
    }
    formRef.current = next;
    setForm(next);
    return next;
  }

  async function persistDraft(
    status: "draft" | "submitted" = "draft",
    state: ApplicationFormState = formRef.current,
  ) {
    const previous = saveQueueRef.current;
    let release!: () => void;
    saveQueueRef.current = new Promise<void>((resolve) => { release = resolve; });
    setPendingSaves((count) => count + 1);
    await previous;
    const id = draftIdRef.current ?? crypto.randomUUID();
    draftIdRef.current = id;
    setSaveStatus("saving");

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          draft: state,
          status,
          expectedRowVersion: rowVersionRef.current,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        id?: string;
        caseNumber?: string;
        status?: "draft" | "changes_requested" | "submitted";
        versionNumber?: number;
        submittedAt?: string;
        mode?: "draft" | "correction";
        rowVersion?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Kladden kunne ikke gemmes.");
      }
      if (!Number.isInteger(payload.rowVersion) || (payload.rowVersion ?? 0) < 1) {
        throw new Error("Serveren returnerede ikke en gyldig versionsmarkør.");
      }

      rowVersionRef.current = payload.rowVersion!;
      setSavedFingerprint(JSON.stringify(state));
      setSaveStatus(JSON.stringify(formRef.current) === JSON.stringify(state) ? "saved" : "idle");
      return { ...payload, id: payload.id ?? id };
    } catch (error) {
      setSaveStatus("error");
      throw error;
    } finally {
      setPendingSaves((count) => count - 1);
      release();
    }
  }

  function setYesNo(field: keyof ApplicationFormState, value: string) {
    update(field, value as ApplicationFormState[typeof field]);
  }

  function markAttempted(targetStep: number) {
    setAttemptedSteps((current) =>
      current.includes(targetStep) ? current : [...current, targetStep],
    );
  }

  function errorFor(field: string) {
    if (!showErrors) return undefined;
    return currentErrors.find((error) => error.field === field)?.message;
  }

  function goToStep(target: number) {
    if (!canOpenStep(form, target)) {
      const blockedAt = firstInvalidStep(form) ?? step;
      markAttempted(blockedAt);
      setStep(blockedAt);
      setFocusRequest({ target: "errors" });
      onToast("Udfyld de markerede felter, før du går videre.");
      return;
    }
    setStep(target);
    setFocusRequest({ target: "heading" });
  }

  function continueForm() {
    markAttempted(step);
    if (currentErrors.length > 0) {
      onToast("Udfyld de markerede felter, før du går videre.");
      setFocusRequest({ target: "errors" });
      return;
    }
    goToStep(Math.min(step + 1, steps.length - 1));
  }

  function chooseSystem(system: CatalogSystem) {
    const selection: SelectedCatalogSystem = {
      id: system.id,
      name: system.name,
      supplier: system.supplier,
      rightsHolder: system.rightsHolder,
      source: system.source,
      usedInKalundborg: system.usedInKalundborg,
      ...(system.localSystemId ? { localSystemId: system.localSystemId } : {}),
      ...(system.localStatus ? { localStatus: system.localStatus } : {}),
      ...(system.kitosStatus ? { kitosStatus: system.kitosStatus } : {}),
    };
    setSaveStatus("idle");
    changeForm((current) => ({
      ...current,
      selectedSystem: selection,
      catalogQuery: system.name,
      supplier: system.supplier,
      rightsHolder: system.rightsHolder,
      manualCatalogEntry: false,
      existsInKitos: "ja",
      municipalityAlreadyUsesSystem:
        system.usedInKalundborg && system.localStatus !== "Ikke aktivt" ? "ja" : "nej",
    }));
    setResults([]);
    setCatalogLoading(false);
    setCatalogError(null);
  }

  async function addFiles(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []).map((file) => {
      const attachment = createAttachmentDraft(kind, file, crypto.randomUUID());
      return {
        file,
        attachment:
          attachment.status === "failed"
            ? attachment
            : { ...attachment, status: "uploading" as const },
      };
    });
    event.target.value = "";
    if (incoming.length === 0) return;
    const stateWithIncoming = changeForm((current) => ({
      ...current,
      attachments: {
        ...current.attachments,
        [kind]: [
          ...current.attachments[kind],
          ...incoming.map(({ attachment }) => attachment),
        ],
      },
    }));

    const validFiles = incoming.filter(
      ({ attachment }) => attachment.status === "uploading",
    );
    if (validFiles.length === 0) return;

    activeUploadsRef.current += validFiles.length;
    setActiveUploads(activeUploadsRef.current);

    let activeDraftId: string;
    try {
      activeDraftId = (await persistDraft("draft", stateWithIncoming)).id;
    } catch (error) {
      activeUploadsRef.current -= validFiles.length;
      setActiveUploads(activeUploadsRef.current);
      const message = (error as Error).message;
      changeForm((current) => ({
        ...current,
        attachments: {
          ...current.attachments,
          [kind]: current.attachments[kind].map((attachment) =>
            validFiles.some(({ attachment: valid }) => valid.id === attachment.id)
              ? { ...attachment, status: "failed", error: message }
              : attachment,
          ),
        },
      }));
      return;
    }

    for (const { file, attachment: pending } of validFiles) {
      let uploadedAttachment: AttachmentDraft | null = null;
      let directAttachmentId: string | null = null;
      let directBlobUrl: string | null = null;
      try {
        if (DIRECT_BLOB_UPLOADS) {
          const checksum = await sha256File(file);
          const presignResponse = await fetch("/api/uploads/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId: activeDraftId,
              kind,
              name: file.name,
              size: file.size,
              contentType: file.type,
              checksum,
            }),
          });
          const presignPayload = (await presignResponse.json()) as {
            directUpload?: {
              attachmentId: string;
              uploadUrl: string;
              contentType: string;
              expiresAt: string;
            };
            error?: string;
          };
          if (!presignResponse.ok || !presignPayload.directUpload) {
            throw new Error(presignPayload.error || "Filen kunne ikke klargøres til upload.");
          }
          const directUpload = presignPayload.directUpload;
          directAttachmentId = directUpload.attachmentId;
          if (!isAllowedVercelBlobUploadUrl(directUpload.uploadUrl)) {
            throw new Error("Uploadadressen blev afvist af portalens sikkerhedskontrol.");
          }
          const blobResponse = await fetch(directUpload.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": directUpload.contentType },
            body: file,
          });
          if (!blobResponse.ok) {
            throw new Error("Filen kunne ikke overføres til dokumentlageret.");
          }
          const blobPayload = (await blobResponse.json()) as {
            pathname?: unknown;
            url?: unknown;
          };
          if (
            typeof blobPayload.url !== "string" ||
            typeof blobPayload.pathname !== "string" ||
            !isAllowedPrivateBlobUrl(blobPayload.url)
          ) {
            throw new Error("Dokumentlageret returnerede en ugyldig filreference.");
          }
          directBlobUrl = blobPayload.url;
          const completeResponse = await fetch("/api/uploads/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              draftId: activeDraftId,
              attachmentId: directAttachmentId,
              blobUrl: directBlobUrl,
            }),
          });
          const completePayload = (await completeResponse.json()) as {
            attachment?: AttachmentDraft;
            error?: string;
          };
          if (!completeResponse.ok || !completePayload.attachment) {
            throw new Error(completePayload.error || "Filen kunne ikke færdiggøres.");
          }
          uploadedAttachment = completePayload.attachment;
          directAttachmentId = null;
          directBlobUrl = null;
        } else {
          const upload = new FormData();
          upload.set("draftId", activeDraftId);
          upload.set("kind", kind);
          upload.set("file", file);
          const response = await fetch("/api/uploads", {
            method: "POST",
            body: upload,
          });
          const payload = (await response.json()) as {
            attachment?: AttachmentDraft;
            error?: string;
          };
          if (!response.ok || !payload.attachment) {
            throw new Error(payload.error || "Filen kunne ikke uploades.");
          }
          uploadedAttachment = payload.attachment;
        }

        if (!uploadedAttachment) {
          throw new Error("Filen kunne ikke gemmes.");
        }

        const nextState = replaceAttachment(
          formRef.current,
          kind,
          pending.id,
          uploadedAttachment,
        );
        formRef.current = nextState;
        setForm(nextState);
      } catch (error) {
        if (directAttachmentId) {
          await fetch("/api/uploads/complete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attachmentId: directAttachmentId,
              blobUrl: directBlobUrl,
              draftId: activeDraftId,
            }),
          }).catch(() => undefined);
        }
        setSaveStatus("error");
        changeForm((current) =>
          replaceAttachment(current, kind, pending.id, {
            ...pending,
            status: "failed",
            error: (error as Error).message,
          }),
        );
      } finally {
        activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
        setActiveUploads(activeUploadsRef.current);
      }
    }
  }

  async function removeFile(kind: UploadKind, id: string) {
    const attachment = formRef.current.attachments[kind].find((file) => file.id === id);
    const draftId = draftIdRef.current;
    if (attachment?.status === "uploaded" && draftId) {
      try {
        const response = await fetch("/api/uploads", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, draftId }),
        });
        if (!response.ok) {
          throw new Error("Bilaget kunne ikke fjernes. Prøv igen.");
        }
      } catch (error) {
        onToast((error as Error).message);
        return;
      }
    }

    changeForm((current) => ({
      ...current,
      attachments: {
        ...current.attachments,
        [kind]: current.attachments[kind].filter((file) => file.id !== id),
      },
    }));
  }

  async function submit() {
    if (submittingRef.current) return;
    if (activeUploadsRef.current > 0) {
      onToast("Vent på, at alle bilag er uploadet, før du indsender.");
      return;
    }
    const currentForm = formRef.current;
    const errors = getAllErrors(currentForm);
    if (errors.length > 0) {
      const invalidStep = firstInvalidStep(currentForm) ?? step;
      markAttempted(invalidStep);
      setStep(invalidStep);
      setFocusRequest({ target: "errors" });
      onToast("Ansøgningen mangler oplysninger, før den kan indsendes.");
      return;
    }
    submittingRef.current = true;
    try {
      const result = await persistDraft("submitted", currentForm);
      if (
        result.status !== "submitted" ||
        !result.caseNumber ||
        typeof result.versionNumber !== "number" ||
        !result.submittedAt ||
        !result.mode ||
        typeof result.rowVersion !== "number"
      ) {
        throw new Error("Serveren returnerede ikke den indsendte version.");
      }
      clearUnsavedGuard();
      onSubmit(pruneHiddenAnswers(currentForm), {
        id: result.id,
        caseNumber: result.caseNumber,
        status: result.status,
        versionNumber: result.versionNumber,
        submittedAt: result.submittedAt,
        mode: result.mode,
        rowVersion: result.rowVersion,
      });
    } catch (error) {
      onToast((error as Error).message);
    } finally {
      submittingRef.current = false;
    }
  }

  async function saveDraft() {
    try {
      await persistDraft("draft", formRef.current);
      onToast(
        correction
          ? `Rettelserne til ${correction.caseNumber} er gemt sikkert.`
          : "Kladden er gemt sikkert på din brugerkonto.",
      );
    } catch (error) {
      onToast((error as Error).message);
    }
  }

  if (saveStatus === "loading") {
    return (
      <div className="application-page page-width">
        <div className="application-top">
          <button className="back-text" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {correctionCaseNumber ? "Tilbage til sagen" : "Mine ansøgninger"}
          </button>
          <span><Check size={16} /> {correctionCaseNumber ? "Henter sag til rettelser…" : "Henter kladde…"}</span>
        </div>
        <div className="form-message warning" role="status">
          <Info size={20} />
          <div><strong>{correctionCaseNumber ? "Klargør næste version" : "Klargør formularen"}</strong><p>{correctionCaseNumber ? "Formular og bilag hentes sikkert fra den tidligere indsendte version." : "Vi henter den valgte kladde fra din konto."}</p></div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="application-page page-width">
        <div className="application-top">
          <button className="back-text" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {correctionCaseNumber ? "Tilbage til sagen" : "Mine ansøgninger"}
          </button>
        </div>
        <div className="form-message error" role="alert">
          <Info size={20} />
          <div><strong>{correctionCaseNumber ? "Sagen kunne ikke åbnes til rettelser" : "Kladden kunne ikke hentes"}</strong><p>{loadError}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="application-page page-width">
      <div className="application-top">
        <button className="back-text" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> {correction ? "Tilbage til sagen" : "Mine ansøgninger"}
        </button>
        <span><Check size={16} /> {saveStatusText(pendingSaves > 0 ? "saving" : JSON.stringify(form) !== savedFingerprint && saveStatus === "saved" ? "idle" : saveStatus, Boolean(correctionCaseNumber))}</span>
      </div>
      <div className="application-title">
        <div>
          <span className="section-label dark">{correction ? `${correction.caseNumber} · Version ${correction.nextVersionNumber}` : "Ny IT-anskaffelse"}</span>
          <h1>{correction ? "Ret og genindsend ansøgning" : draftCaseNumber ? "Fortsæt kladde" : "Opret ansøgning"}</h1>
          <p>{correction ? `Version ${correction.currentVersionNumber} forbliver låst. Dine rettelser gemmes som en ny version, når du genindsender.${correction.rejection?.comment ? ` Afvisningsgrund fra ${correction.rejection.approverName}: ${correction.rejection.comment}` : ""}` : guidance?.intro ?? "Spørgsmålene følger D-GITA-processen og tilpasses dine svar undervejs."}</p>
          {correction?.informationRequest ? <p><strong>Der er bedt om supplerende oplysninger:</strong> {correction.informationRequest.reason}{correction.informationRequest.dueDate ? <> <strong>Svarfrist:</strong> {formatDate(correction.informationRequest.dueDate)}.</> : null}</p> : null}
        </div>
        <div className="application-progress"><strong>{step + 1}</strong><span>af {steps.length}</span></div>
      </div>

      <div className="application-layout">
        <aside className="application-rail">
          <div className="rail-line" aria-hidden="true" />
          {steps.map((label, index) => {
            const unlocked = canOpenStep(form, index);
            const complete = index < step && getStepErrors(form, index).length === 0;
            return (
              <button
                className={cx(index === step && "active", complete && "complete")}
                type="button"
                key={label}
                disabled={!unlocked}
                aria-current={index === step ? "step" : undefined}
                aria-label={`${label}${unlocked ? "" : " – låst"}`}
                onClick={() => goToStep(index)}
              >
                <span>{complete ? <Check size={15} /> : index + 1}</span><strong>{label}</strong>
              </button>
            );
          })}
          <div className="rail-help"><CircleHelp size={20} /><div><strong>Brug for hjælp?</strong><p>Book et formøde med din lokale konsulent.</p><a href="mailto:ckra@kalundborg.dk?subject=Ønske%20om%20D-GITA-formøde">Book formøde</a></div></div>
        </aside>

        <section className="application-sheet" ref={sheetRef}>
          <div className="sheet-heading">
            <span>Trin {step + 1}</span><h2 ref={headingRef} tabIndex={-1}>{steps[step]}</h2><p>{descriptions[step]}</p>
          </div>
          <div className="sheet-fields">
            {showErrors && currentErrors.length > 0 ? (
              <FormMessage tone="error" title={`${currentErrors.length} felt${currentErrors.length === 1 ? "" : "er"} skal rettes`} messages={currentErrors.map((error) => error.message)} />
            ) : null}
            {currentWarnings.length > 0 ? (
              <FormMessage tone="warning" title="Opmærksomhedspunkt" messages={currentWarnings.map((warning) => warning.message)} />
            ) : null}

            {step === 0 ? (
              <>
                <Question title="1. Ved du allerede nu hvilket IT-system du vil indkøbe?" hint="Hvis systemet findes i KITOS, kan flere felter udfyldes automatisk.">
                  <Choice value={form.knownSystem} onChange={(value) => {
                    setSaveStatus("idle");
                    setResults([]);
                    setCatalogLoading(false);
                    setCatalogError(null);
                    changeForm((current) => ({
                      ...current,
                      knownSystem: value as YesNo,
                      selectedSystem: value === "ja" ? current.selectedSystem : null,
                      manualCatalogEntry: false,
                      existsInKitos: value === "ja" ? current.existsInKitos : "nej",
                      municipalityAlreadyUsesSystem:
                        value === "ja" ? current.municipalityAlreadyUsesSystem : "nej",
                      supplier:
                        value === "nej" && current.supplier === current.selectedSystem?.supplier
                          ? ""
                          : current.supplier,
                      rightsHolder:
                        value === "nej" &&
                        current.rightsHolder === current.selectedSystem?.rightsHolder
                          ? ""
                          : current.rightsHolder,
                    }));
                  }} options={[{ value: "ja", label: "Ja" }, { value: "nej", label: "Nej" }]} />
                </Question>
                <Question title="2. Erstatter det et allerede eksisterende IT-system?">
                  <Choice value={form.replacesExisting} onChange={(value) => setYesNo("replacesExisting", value)} options={yesNoOptions} />
                  {isFieldVisible("replacementSystem", form) ? (
                    <div className="conditional-field">
                      <CatalogRelationField label="2.1 Hvilket system erstattes?" value={form.replacementSystem} relation={form.replacementCatalogRelation ?? null} error={errorFor("replacementSystem")} onChange={(value, relation) => {
                        setSaveStatus("idle");
                        changeForm((current) => ({ ...current, replacementSystem: value, replacementCatalogRelation: relation }));
                      }} />
                    </div>
                  ) : null}
                </Question>

                {isFieldVisible("catalogQuery", form) ? (
                  <Question title="3. Søg IT-systemnavnet i KITOS" hint={guidance?.catalog ?? "Resultatet viser samtidig, om systemet bruges i Kalundborg."}>
                    <div className="lookup-field">
                      <Search size={18} />
                      <input
                        className={cx("clean-input", errorFor("selectedSystem") && "invalid")}
                        value={form.catalogQuery}
                        placeholder="Søg på system, leverandør eller rettighedshaver"
                        onChange={(event) => {
                          setSaveStatus("idle");
                          setResults([]);
                          setCatalogLoading(false);
                          setCatalogError(null);
                          changeForm((current) => ({ ...current, catalogQuery: event.target.value, selectedSystem: null }));
                        }}
                      />
                    </div>
                    <p className="catalog-empty">{catalogFreshnessLabel()}</p>
                    <FieldErrorText message={errorFor("selectedSystem")} />
                    {form.selectedSystem ? (
                      <CatalogSelection system={form.selectedSystem} />
                    ) : (
                      <div className="catalog-results" aria-live="polite">
                        {catalogLoading ? <p className="catalog-empty">Søger i KITOS og Kalundborgs systemer…</p> : null}
                        {results.map((system) => <CatalogResult key={system.id} system={system} onChoose={() => chooseSystem(system)} />)}
                        {catalogError ? <p className="catalog-empty catalog-error" role="alert">{catalogError}</p> : null}
                        {!catalogLoading && !catalogError && form.catalogQuery.trim().length >= 2 && results.length === 0 ? <p className="catalog-empty">Ingen sikre resultater. Kontrollér stavningen eller registrér systemet manuelt.</p> : null}
                      </div>
                    )}
                    <button className="inline-action" type="button" onClick={() => {
                      setSaveStatus("idle");
                      setResults([]);
                      setCatalogLoading(false);
                      setCatalogError(null);
                      changeForm((current) => ({
                        ...current,
                        manualCatalogEntry: true,
                        selectedSystem: null,
                        existsInKitos: "nej",
                        municipalityAlreadyUsesSystem: "nej",
                      }));
                    }}>Systemet findes ikke i kataloget</button>
                  </Question>
                ) : null}

                <Question title="4. Findes IT-systemet i KITOS under IT Systemkatalog?">
                  <Choice value={form.existsInKitos} onChange={(value) => {
                    setSaveStatus("idle");
                    if (value === "nej") {
                      changeForm((current) => ({
                        ...current,
                        existsInKitos: "nej",
                        manualCatalogEntry: true,
                        selectedSystem: null,
                        municipalityAlreadyUsesSystem: "nej",
                        supplier:
                          current.supplier === current.selectedSystem?.supplier
                            ? ""
                            : current.supplier,
                        rightsHolder:
                          current.rightsHolder === current.selectedSystem?.rightsHolder
                            ? ""
                            : current.rightsHolder,
                      }));
                    } else {
                      changeForm((current) => ({
                        ...current,
                        knownSystem: "ja",
                        existsInKitos: "ja",
                        manualCatalogEntry: false,
                      }));
                    }
                  }} options={yesNoOptions} />
                </Question>
                <Question title="5. Benytter kommunen allerede dette IT-system?" hint="Katalogvalget foreslår svaret ud fra Kalundborg-listen; kontrollér det før du fortsætter.">
                  <Choice value={form.municipalityAlreadyUsesSystem} onChange={(value) => setYesNo("municipalityAlreadyUsesSystem", value)} options={yesNoOptions} />
                </Question>

                {isFieldVisible("manualSystem", form) ? (
                  <>
                    <div className="source-note"><Info size={19} /><div><strong>Nyt eller ukendt system</strong><p>Oplysningerne registreres manuelt og kan senere matches til KITOS.</p></div></div>
                    <Question title="9. IT-systemnavn"><input className={cx("clean-input", errorFor("manualSystem") && "invalid")} value={form.manualSystemName} onChange={(event) => update("manualSystemName", event.target.value)} /><FieldErrorText message={errorFor("manualSystem")} /></Question>
                    <div className="two-column-fields">
                      <Question title="10. Forretningsmæssig type"><input className="clean-input" value={form.businessType} onChange={(event) => update("businessType", event.target.value)} /></Question>
                      <Question title="12. Link til systembeskrivelse"><input className={cx("clean-input", errorFor("descriptionUrl") && "invalid")} type="url" value={form.descriptionUrl} onChange={(event) => update("descriptionUrl", event.target.value)} /><FieldErrorText message={errorFor("descriptionUrl")} /></Question>
                    </div>
                    <Question title="11. Kort systembeskrivelse"><textarea className="clean-input" rows={4} value={form.systemDescription} onChange={(event) => update("systemDescription", event.target.value)} /></Question>
                    <div className="two-column-fields">
                      <Question title="13. Leverandør"><input className="clean-input" value={form.supplier} onChange={(event) => update("supplier", event.target.value)} /></Question>
                      <Question title="14. Leverandørens CVR"><input inputMode="numeric" className={cx("clean-input", errorFor("supplierCvr") && "invalid")} value={form.supplierCvr} onChange={(event) => update("supplierCvr", event.target.value)} /><FieldErrorText message={errorFor("supplierCvr")} /></Question>
                      <Question title="15. Rettighedshaver"><input className="clean-input" value={form.rightsHolder} onChange={(event) => update("rightsHolder", event.target.value)} /></Question>
                      <Question title="16. Rettighedshaverens CVR"><input inputMode="numeric" className={cx("clean-input", errorFor("rightsHolderCvr") && "invalid")} value={form.rightsHolderCvr} onChange={(event) => update("rightsHolderCvr", event.target.value)} /><FieldErrorText message={errorFor("rightsHolderCvr")} /></Question>
                    </div>
                    {form.knownSystem === "ja" ? <button className="inline-action" type="button" onClick={() => update("manualCatalogEntry", false)}>Tilbage til katalogsøgning</button> : null}
                  </>
                ) : null}

                <div className="two-column-fields">
                  <Question title="6. Kontaktperson – navn"><input className={cx("clean-input", errorFor("contactPerson") && "invalid")} value={form.contactPerson} onChange={(event) => update("contactPerson", event.target.value)} /><FieldErrorText message={errorFor("contactPerson")} /></Question>
                  <Question title="7. Center / afdeling"><input className={cx("clean-input", errorFor("department") && "invalid")} value={form.department} onChange={(event) => update("department", event.target.value)} /><FieldErrorText message={errorFor("department")} /></Question>
                </div>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <div className="source-note"><Sparkles size={19} /><div><strong>{form.selectedSystem ? "Systemoplysninger fra kataloget" : "Manuelt registreret system"}</strong><p>Kontrollér ansvar og journalreferencer før du går videre.</p></div></div>
                <div className="two-column-fields">
                  <Question title="17. Dataejer" hint="Chef eller leder med ansvar for afdelingens data."><input className={cx("clean-input", errorFor("dataOwner") && "invalid")} value={form.dataOwner} onChange={(event) => update("dataOwner", event.target.value)} /><FieldErrorText message={errorFor("dataOwner")} /></Question>
                  <Question title="18. Systemejer"><input className={cx("clean-input", errorFor("systemOwner") && "invalid")} value={form.systemOwner} onChange={(event) => update("systemOwner", event.target.value)} /><FieldErrorText message={errorFor("systemOwner")} /></Question>
                  <Question title="19. Kontraktejer"><input className={cx("clean-input", errorFor("contractOwner") && "invalid")} value={form.contractOwner} onChange={(event) => update("contractOwner", event.target.value)} /><FieldErrorText message={errorFor("contractOwner")} /></Question>
                  <Question title="24. Ansvarlig afdeling / enhed"><input className={cx("clean-input", errorFor("responsibleOrganization") && "invalid")} value={form.responsibleOrganization} onChange={(event) => update("responsibleOrganization", event.target.value)} /><FieldErrorText message={errorFor("responsibleOrganization")} /></Question>
                  <Question title="20. Systemadministratorer"><input className="clean-input" value={form.systemAdministrators} onChange={(event) => update("systemAdministrators", event.target.value)} /></Question>
                  <Question title="21. Superbrugere"><input className="clean-input" value={form.superUsers} onChange={(event) => update("superUsers", event.target.value)} /></Question>
                </div>
                <Question title="22. Link til kontraktsag i ESDH" hint="Gem kontrakt, korrespondance og øvrige bilag på sagen."><input className={cx("clean-input", errorFor("esdhContractUrl") && "invalid")} type="url" placeholder="https://esdh.kommune.dk/sag/..." value={form.esdhContractUrl} onChange={(event) => update("esdhContractUrl", event.target.value)} /><FieldErrorText message={errorFor("esdhContractUrl")} /></Question>
                <Question title="23. Link til databehandleraftale i ESDH"><input className={cx("clean-input", errorFor("esdhDpaUrl") && "invalid")} type="url" placeholder="https://esdh.kommune.dk/sag/..." value={form.esdhDpaUrl} onChange={(event) => update("esdhDpaUrl", event.target.value)} /><FieldErrorText message={errorFor("esdhDpaUrl")} /></Question>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Question title="25. Anskaffelsesform" hint="Anskaffelsesformen har betydning for kravspecifikationens detaljeringsgrad."><select className={cx("clean-input", errorFor("acquisitionMethod") && "invalid")} value={form.acquisitionMethod} onChange={(event) => update("acquisitionMethod", event.target.value)}><option value="">Vælg anskaffelsesform</option>{ACQUISITION_METHODS.map((option) => <option key={option}>{option}</option>)}</select><FieldErrorText message={errorFor("acquisitionMethod")} /></Question>
                <Question title="26. Er der gennemført markedsafdækning?" hint={guidance?.marketResearch ?? "Har du undersøgt, hvilke løsninger der bedst matcher behov, pris og kvalitet?"}><Choice value={form.marketResearch} onChange={(value) => setYesNo("marketResearch", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("marketResearchSystems", form) ? <Question title="26.1 Hvilke IT-systemer er afdækket?"><textarea className={cx("clean-input", errorFor("marketResearchSystems") && "invalid")} rows={4} value={form.marketResearchSystems} onChange={(event) => update("marketResearchSystems", event.target.value)} /><FieldErrorText message={errorFor("marketResearchSystems")} /></Question> : null}
                <Question title="27. Nyanskaffelse / tilkøb"><Choice value={form.acquisitionType} onChange={(value) => update("acquisitionType", value as ApplicationFormState["acquisitionType"])} options={[{ value: "nyanskaffelse", label: "Nyanskaffelse" }, { value: "tilkøb", label: "Tilkøb" }]} /></Question>
                {isFieldVisible("relatedSystem", form) ? <Question title="27.1 Hvilket eksisterende system vedrører tilkøbet?"><CatalogRelationField label="Systemet, tilkøbet vedrører" value={form.relatedSystem} relation={form.relatedCatalogRelation ?? null} error={errorFor("relatedSystem")} onChange={(value, relation) => {
                  setSaveStatus("idle");
                  changeForm((current) => ({ ...current, relatedSystem: value, relatedCatalogRelation: relation }));
                }} /></Question> : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Question title="28. Formålsbeskrivelse" hint="Hvorfor er anskaffelsen nødvendig? Beskriv effekt og resultater."><textarea className={cx("clean-input", errorFor("purpose") && "invalid")} rows={5} value={form.purpose} onChange={(event) => update("purpose", event.target.value)} /><FieldErrorText message={errorFor("purpose")} /></Question>
                <Question title="29. Funktionsbeskrivelse" hint="Overvej først, om et eksisterende system allerede kan løse opgaven."><textarea className={cx("clean-input", errorFor("functionDescription") && "invalid")} rows={5} value={form.functionDescription} onChange={(event) => update("functionDescription", event.target.value)} /><FieldErrorText message={errorFor("functionDescription")} /></Question>
                <Question title="30. Hvilke arbejdsprocesser understøttes?" hint="Angiv relevante KLE-emner, adskilt med komma."><input className="clean-input" value={form.kleTopics.join(", ")} onChange={(event) => update("kleTopics", splitList(event.target.value))} /></Question>
                <Question title="31. Understøttes processen allerede af et eksisterende system?"><Choice value={form.existingProcessSystem} onChange={(value) => setYesNo("existingProcessSystem", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("existingProcessSystems", form) ? <Question title="31.1 Hvilke systemer understøtter processen i dag?"><textarea className={cx("clean-input", errorFor("existingProcessSystems") && "invalid")} rows={3} value={form.existingProcessSystems} onChange={(event) => update("existingProcessSystems", event.target.value)} /><FieldErrorText message={errorFor("existingProcessSystems")} /></Question> : null}
                <Question title="32. Kan andre centre eller teams have gavn af funktionaliteten?"><Choice value={form.crossCutting} onChange={(value) => setYesNo("crossCutting", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("crossFunctionality", form) ? <Question title="32.1 Beskriv den tværgående funktionalitet"><textarea className={cx("clean-input", errorFor("crossFunctionality") && "invalid")} rows={3} value={form.crossFunctionality} onChange={(event) => update("crossFunctionality", event.target.value)} /><FieldErrorText message={errorFor("crossFunctionality")} /></Question> : null}
                {isFieldVisible("crossDepartments", form) ? <Question title="32.2 Hvilke centre eller teams?" hint="Adskil flere enheder med komma."><input className={cx("clean-input", errorFor("crossDepartments") && "invalid")} value={form.crossDepartments.join(", ")} onChange={(event) => update("crossDepartments", splitList(event.target.value))} /><FieldErrorText message={errorFor("crossDepartments")} /></Question> : null}
              </>
            ) : null}

            {step === 4 ? (
              <>
                <Question title="33. Er der et eksisterende budget at købe for?"><Choice value={form.hasBudget} onChange={(value) => setYesNo("hasBudget", value)} options={yesNoOptions} />{isFieldVisible("budgetAmount", form) ? <div className="conditional-field"><label className="subfield-label" htmlFor="budget-amount">33.1 Eksisterende budgetbeløb</label><Money id="budget-amount" value={form.budgetAmount} error={errorFor("budgetAmount")} onChange={(value) => update("budgetAmount", value)} /></div> : null}</Question>
                <div className="finance-overview"><span>Samlet finansiering</span><strong>{formatDanishAmount(getFinanceTotal(form))} kr.</strong><small>Beregnet ud fra felterne nedenfor</small></div>
                <div className="three-column-fields">
                  <Question title="34. Engangsomkostninger"><Money value={form.oneTimeCost} error={errorFor("oneTimeCost")} onChange={(value) => update("oneTimeCost", value)} /></Question>
                  <Question title="35. Årlige driftsudgifter"><Money value={form.yearlyCost} error={errorFor("yearlyCost")} onChange={(value) => update("yearlyCost", value)} /></Question>
                  <Question title="36. Andre omkostninger"><Money value={form.otherCost} error={errorFor("otherCost")} onChange={(value) => update("otherCost", value)} /></Question>
                </div>
                <Question title="38. Beskrivelse af gevinsten"><textarea className={cx("clean-input", errorFor("benefits") && "invalid")} rows={4} value={form.benefits} onChange={(event) => update("benefits", event.target.value)} /><FieldErrorText message={errorFor("benefits")} /></Question>
              </>
            ) : null}

            {step === 5 ? (
              <>
                <AiScreeningFields form={form} errorFor={errorFor} onChange={update} />
                <Question title="Har du allerede lavet en risikovurdering?" hint="Risikovurderingen skal bruges, før ansøgningen kan vurderes."><Choice value={form.hasRiskAssessment} onChange={(value) => setYesNo("hasRiskAssessment", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("riskHelp", form) ? <Question title="Har du brug for hjælp til risikovurdering?"><Choice value={form.needsRiskHelp} onChange={(value) => setYesNo("needsRiskHelp", value)} options={yesNoOptions} /></Question> : null}
                {isFieldVisible("risk-assessment", form) ? <UploadField kind="risk-assessment" title="Upload risikovurdering" files={form.attachments["risk-assessment"]} onAdd={addFiles} onRemove={removeFile} /> : null}
                <Question title="43. Behandler IT-systemet persondata?"><Choice value={form.personalData} onChange={(value) => setYesNo("personalData", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("dpaQuestion", form) ? <Question title="44. Har du allerede en databehandleraftale?"><Choice value={form.hasDpa} onChange={(value) => setYesNo("hasDpa", value)} options={yesNoOptions} /></Question> : null}
                {isFieldVisible("dataClassification", form) ? <Question title="41. Klassifikation af data"><select className={cx("clean-input", errorFor("dataClassification") && "invalid")} value={form.dataClassification} onChange={(event) => update("dataClassification", event.target.value)}><option value="">Vælg dataklassifikation</option>{DATA_CLASSIFICATIONS.map((option) => <option key={option}>{option}</option>)}</select><FieldErrorText message={errorFor("dataClassification")} /></Question> : null}
                {isFieldVisible("data-processing-agreement", form) ? <UploadField kind="data-processing-agreement" title="Upload databehandleraftale" detail="Dokumentet er obligatorisk, når aftalen findes" files={form.attachments["data-processing-agreement"]} error={errorFor("data-processing-agreement")} onAdd={addFiles} onRemove={removeFile} /> : null}
                <Question title="Har du allerede en kontrakt?"><Choice value={form.hasContract} onChange={(value) => setYesNo("hasContract", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("contract", form) ? <UploadField kind="contract" title="Upload kontrakt" files={form.attachments.contract} error={errorFor("contract")} onAdd={addFiles} onRemove={removeFile} /> : null}
                <Question title="Hvor mange medarbejdere får adgang til data?"><select className={cx("clean-input", errorFor("employeeAccess") && "invalid")} value={form.employeeAccess} onChange={(event) => update("employeeAccess", event.target.value)}><option value="">Vælg antal</option>{USER_COUNT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select><FieldErrorText message={errorFor("employeeAccess")} /></Question>
              </>
            ) : null}

            {step === 6 ? (
              <>
                <Question title="45. Milepæle" hint="Angiv de vigtigste kontrolpunkter, adskilt med komma."><input className="clean-input" value={form.milestones.join(", ")} onChange={(event) => update("milestones", splitList(event.target.value))} /></Question>
                <Question title="48. Ressourcetræk i forbindelse med implementering"><textarea className={cx("clean-input", errorFor("implementationResources") && "invalid")} rows={4} value={form.implementationResources} onChange={(event) => update("implementationResources", event.target.value)} /><FieldErrorText message={errorFor("implementationResources")} /></Question>
                <div className="two-column-fields">
                  <Question title="46. Forventet startdato"><input type="date" className={cx("clean-input", errorFor("startDate") && "invalid")} value={form.startDate} onChange={(event) => update("startDate", event.target.value)} /><FieldErrorText message={errorFor("startDate")} /></Question>
                  <Question title="47. Forventet slutdato"><input type="date" className={cx("clean-input", errorFor("endDate") && "invalid")} value={form.endDate} onChange={(event) => update("endDate", event.target.value)} /><FieldErrorText message={errorFor("endDate")} /></Question>
                </div>
                <Question title="49. Antal brugere"><select className={cx("clean-input", errorFor("implementationUsers") && "invalid")} value={form.implementationUsers} onChange={(event) => update("implementationUsers", event.target.value)}><option value="">Vælg antal</option>{USER_COUNT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select><FieldErrorText message={errorFor("implementationUsers")} /></Question>
              </>
            ) : null}

            {step === 7 ? (
              <>
                <Question title="50. Er der indhentet arkitekturtegning og beskrivelse af IT-systemets sammenhænge?" hint="Materialet kan fås hos leverandøren."><Choice value={form.hasArchitecture} onChange={(value) => setYesNo("hasArchitecture", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("architecture", form) ? <UploadField kind="architecture" title="Vedhæft arkitekturtegning" detail="Dokumentet knyttes til sagen og kvitteringen" files={form.attachments.architecture} error={errorFor("architecture")} onAdd={addFiles} onRemove={removeFile} icon="paperclip" /> : null}
                <Question title="Er ‘Tjekliste til leverandør’ udfyldt?"><Choice value={form.hasSupplierChecklist} onChange={(value) => setYesNo("hasSupplierChecklist", value)} options={yesNoOptions} /></Question>
                {isFieldVisible("supplier-checklist", form) ? <UploadField kind="supplier-checklist" title="Vedhæft tjekliste til leverandør" files={form.attachments["supplier-checklist"]} onAdd={addFiles} onRemove={removeFile} /> : null}
                <Question title="51. Er tjeklisten journaliseret i ESDH?"><Choice value={form.checklistJournalized} onChange={(value) => setYesNo("checklistJournalized", value)} options={yesNoOptions} /></Question>
              </>
            ) : null}

            {step === 8 ? (
              <>
                <Question title="52. Angiv chef" hint="Lederen modtager en godkendelsesmail i Outlook."><select className={cx("clean-input", errorFor("approvingLeader") && "invalid")} value={form.approvingLeaderId} onChange={(event) => { const leader = approvers.find((candidate) => candidate.id === event.target.value); if (!leader) return; changeForm((current) => ({ ...current, approvingLeaderId: leader.id, approvingLeader: leader.name })); setSaveStatus("idle"); }}><option value="">Vælg en godkender</option>{approvers.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}</select><FieldErrorText message={approversError || errorFor("approvingLeader")} /></Question>
                <Question title="53. Har du andre relevante bemærkninger?"><textarea className="clean-input" rows={5} placeholder="Tilføj eventuelle bemærkninger..." value={form.remarks} onChange={(event) => update("remarks", event.target.value)} /></Question>
                <div className="outlook-note"><Mail size={20} /><div><strong>Godkendelsen klargøres til Outlook</strong><p>Lederen får et versionslåst beslutningsgrundlag og et direkte link til sagen, når mailintegrationen forbindes.</p></div></div>
              </>
            ) : null}

            {step === 9 ? <ReviewApplication form={form} error={errorFor("consent")} onEdit={goToStep} onConsent={(checked) => update("consent", checked)} /> : null}
          </div>

          <div className="sheet-footer">
            <button className="line-button" type="button" disabled={pendingSaves > 0 || activeUploads > 0} onClick={() => void saveDraft()}>{activeUploads > 0 ? "Uploader bilag…" : saveStatus === "saving" ? "Gemmer…" : correction ? "Gem rettelser" : "Gem kladde"}</button>
            <div>
              {step > 0 ? <button className="text-nav-button" type="button" onClick={() => goToStep(step - 1)}><ArrowLeft size={17} /> Forrige</button> : null}
              {step < steps.length - 1 ? <button className="solid-button" type="button" onClick={continueForm}>Fortsæt <ArrowRight size={17} /></button> : <button className="solid-button" type="button" disabled={pendingSaves > 0 || activeUploads > 0} onClick={() => void submit()}><Send size={17} /> {activeUploads > 0 ? "Uploader bilag…" : correction ? `Genindsend version ${correction.nextVersionNumber}` : "Gem og indsend"}</button>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const yesNoOptions = [{ value: "ja", label: "Ja" }, { value: "nej", label: "Nej" }];

function saveStatusText(
  status: "loading" | "idle" | "saving" | "saved" | "error",
  correction: boolean,
) {
  const noun = correction ? "rettelser" : "kladde";
  if (status === "loading") return correction ? "Henter sag til rettelser…" : "Henter kladde…";
  if (status === "saving") return `Gemmer ${noun}…`;
  if (status === "saved") return `${correction ? "Rettelserne" : "Kladden"} er gemt sikkert`;
  if (status === "error") return `${correction ? "Rettelser" : "Kladde"} kunne ikke hentes eller gemmes`;
  return "Ændringer gemmes først, når du vælger Gem kladde";
}

function replaceAttachment(
  state: ApplicationFormState,
  kind: UploadKind,
  attachmentId: string,
  replacement: AttachmentDraft,
): ApplicationFormState {
  return {
    ...state,
    attachments: {
      ...state.attachments,
      [kind]: state.attachments[kind].map((attachment) =>
        attachment.id === attachmentId ? replacement : attachment,
      ),
    },
  };
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function Choice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <SegmentedChoice value={value} options={options} onChange={onChange} />;
}

function ReviewApplication({ form, error, onEdit, onConsent }: { form: ApplicationFormState; error?: string; onEdit: (step: number) => void; onConsent: (checked: boolean) => void }) {
  const errorId = "application-review-consent-error";
  const rows: Array<[string, string, number]> = [
    ["System", `${getDisplaySystemName(form)}${form.selectedSystem ? form.selectedSystem.usedInKalundborg ? " · bruges i Kalundborg" : " · fundet i KITOS" : " · manuelt registreret"}`, 0],
    ...(form.replacesExisting === "ja" ? [["Erstatter system", form.replacementSystem, 0] as [string, string, number]] : []),
    ["Organisation", form.responsibleOrganization, 1],
    ["Anskaffelsesform", form.acquisitionMethod, 2],
    ...(form.acquisitionType === "tilkøb" ? [["Tilkøb til system", form.relatedSystem, 2] as [string, string, number]] : []),
    ["Persondata", form.personalData === "ja" ? `Ja · ${form.dataClassification}` : "Nej", 5],
    ["AI i anskaffelsen", aiUsageLabel(form.aiUsage), 5],
    ...(hasAiScreeningDetails(form.aiUsage) ? [["AI-formål", form.aiPurpose ?? "", 5] as [string, string, number], ["Link til AI-vurdering", form.aiAssessmentUrl || "Ikke angivet", 5] as [string, string, number]] : []),
    ["Samlet finansiering", `${formatDanishAmount(getFinanceTotal(form))} kr.`, 4],
    ["Implementering", `${formatDate(form.startDate)} – ${formatDate(form.endDate)}`, 6],
    ["Godkendende chef", form.approvingLeader, 8],
  ];
  const warnings: FieldError[] = [getStepWarnings(form, 5), getStepWarnings(form, 7)].flat();
  return <div className="review-block"><div className="review-status"><CheckCircle2 size={25} /><div><strong>Klar til kontrol</strong><p>Den indsendte version låses i databasen. PDF-kvitteringen kan hentes på sagen, og en kvitteringsmail lægges i den sikre Outlook-kø.</p></div></div>{warnings.length > 0 ? <FormMessage tone="warning" title="Ansøgningen kan indsendes med opmærksomhedspunkter" messages={warnings.map((warning) => warning.message)} /> : null}{rows.map(([label, value, targetStep]) => <div className="review-line" key={label}><span>{label}</span><strong>{value || "Ikke angivet"}</strong><button type="button" aria-label={`Redigér ${label}`} onClick={() => onEdit(targetStep)}>Redigér</button></div>)}<label className="consent-check"><input type="checkbox" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} checked={form.consent} onChange={(event) => onConsent(event.target.checked)} /><span>{form.consent ? <Check size={14} /> : null}</span>Jeg har kontrolleret oplysningerne og de vedlagte bilag.</label><FieldErrorText id={errorId} message={error} /></div>;
}

function formatDate(value: string) {
  if (!value) return "Ikke angivet";
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
