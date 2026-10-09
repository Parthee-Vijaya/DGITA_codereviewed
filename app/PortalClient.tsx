"use client";

import { ReceiptLinks } from "../features/receipt/ReceiptLinks";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  History,
  Inbox,
  Info,
  LayoutGrid,
  Link2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Paperclip,
  PencilLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserRound,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Actor } from "../features/auth/types";
import { BrandLockup } from "../features/brand/BrandLockup";
import { PartnerFooter } from "../features/brand/PartnerFooter";
import { ApplicationFormView } from "../features/application/ApplicationFormView";
import { confirmNavigation, useUnsavedChanges } from "../features/application/use-unsaved-changes";
import { labelQuestionControls, QuestionLabelContext } from "../features/application/QuestionContent";
import { SegmentedChoice } from "../features/ui/SegmentedChoice";
import {
  formatDanishAmount,
  getDisplaySystemName,
  getFinanceTotal,
  type ApplicationFormState,
} from "../features/application/engine";
import {
  CollectionEditButton,
  EditableText,
  EditorDrawer,
  EditorToolbar,
  ManagedImage,
  type EditorSelection,
} from "../features/editor/EditorMode";
import {
  SpotlightTour,
  type SpotlightTourStep,
} from "../features/onboarding/SpotlightTour";
import {
  useCaseCommentsAndActivity,
  useCaseDetail,
  type CaseDetail,
  type CaseActivityEvent,
  type CaseComment,
  type CaseCommentVisibility,
  type SubmitCaseCommentInput,
} from "../features/case";
import {
  caseNumberFromNotification,
  caseNumberFromPortalLink,
  usePortalNotifications,
  type PortalNotification,
} from "../features/notifications/use-notifications";
import { MailAdminPanel } from "../features/mail/MailAdminPanel";
import {
  COMMENTABLE_APPLICATION_FIELDS,
  CONTENT_CATEGORY_LABELS,
  D_GITA_FRAMEWORKS,
  D_GITA_PHASES,
  EMPTY_D_GITA_APPROVAL,
  WORKSPACE_ROLES,
  canAccessArea,
  capabilitiesFor,
  contentBody,
  defaultAreaForRole,
  filterCasesForViewer,
  isSafeContentUrl,
  isContentVisible,
  resolveAccessibleCase,
  type Approval,
  type CaseRecord,
  type ContentCategory,
  type ContentEntry,
  type DgitaApproval,
  type FieldComment,
  type ImageEntry,
  type Phase,
  type WorkspaceArea,
  type WorkspaceRole,
  type WorkspaceViewer,
} from "../features/workspace/model";
import { searchKnowledge } from "../features/workspace/knowledge-search";
import { csvCell } from "../features/workspace/csv";
import { useDemoWorkspace } from "../features/workspace/use-demo-workspace";

type View = WorkspaceArea;

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  user: "Bruger",
  consultant: "D-GITA konsulent",
  admin: "Admin",
};

const applicationSteps = [
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

const ONBOARDING_STORAGE_KEY = "dgita-onboarding-v1-complete";

const onboardingSteps: readonly SpotlightTourStep[] = [
  {
    selector: "[data-tour='home']",
    title: "Velkommen til D-GITA",
    body: "Herfra kan du altid vende tilbage til forsiden og få overblik over anskaffelsesforløbet.",
  },
  {
    selector: "[data-tour='primary-navigation']",
    title: "Dine områder",
    body: "Navigationen tilpasses din rolle. Som bruger ser du dine egne ansøgninger; konsulenter og administratorer får deres arbejdsområder.",
  },
  {
    selector: "[data-tour='role-switcher']",
    title: "Afprøv de tre roller",
    body: "I testmiljøet kan du skifte mellem Bruger, D-GITA-konsulent og Admin. Senere kommer rollen fra kommunal SSO.",
  },
  {
    selector: "[data-tour='primary-action']",
    title: "Start eller fortsæt arbejdet",
    body: "Den primære handling fører dig til en ny ansøgning eller den arbejdskø, som hører til din rolle.",
  },
  {
    selector: "[data-tour='knowledge-link']",
    title: "Vejledning og svar",
    body: "Her finder du vejledninger, FAQ, databehandlerkrav og nyttige links. Søgningen tåler også almindelige stavefejl.",
  },
  {
    selector: "[data-tour='notifications']",
    title: "Følg sagen",
    body: "Notifikationer samler statusændringer, godkendelser og kvitteringer ét sted.",
  },
  {
    selector: "[data-tour='profile']",
    title: "Du kan altid starte turen igen",
    body: "Åbn din brugerprofil og vælg Tutorial, når du vil se introduktionen igen.",
  },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PortalClient({ initialViewer }: { initialViewer: Actor }) {
  const router = useRouter();
  const [viewer, setViewer] = useState<Actor>(initialViewer);
  const role = viewer.role;
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);
  const casesRequestRef = useRef(0);
  const roleChangingRef = useRef(false);
  const [roleChanging, setRoleChanging] = useState(false);
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [correctionCaseNumber, setCorrectionCaseNumber] = useState<string | null>(null);
  const [draftCaseNumber, setDraftCaseNumber] = useState<string | null>(null);
  const [newFormKey, setNewFormKey] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(false);
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const initialDeepLinkHandledRef = useRef(false);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const workspace = useDemoWorkspace(viewer);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setProfileOpen(false); setNotificationsOpen(false); setMobileMenu(false); }
    };
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(".header-popover-anchor")) { setProfileOpen(false); setNotificationsOpen(false); }
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("click", outside); };
  }, []);
  const notificationFeed = usePortalNotifications(
    `${viewer.tenantId}:${viewer.subject}:${viewer.role}`,
  );

  const visibleCases = useMemo(
    () => filterCasesForViewer(viewer, cases),
    [viewer, cases],
  );
  const selectedCase = selectedId
    ? resolveAccessibleCase(viewer, selectedId, cases)
    : null;

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  const reloadCases = useCallback(async () => {
    const requestId = ++casesRequestRef.current;
    try {
      const response = await fetch("/api/cases", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return null;
      }
      const payload = (await response.json()) as { cases?: CaseRecord[]; error?: string };
      if (!response.ok || !payload.cases) {
        throw new Error(payload.error || "Sagerne kunne ikke hentes.");
      }
      if (requestId !== casesRequestRef.current) return null;
      setCases(payload.cases);
      setCasesLoaded(true);
      setCasesError(null);
      return payload.cases;
    } catch (reason) {
      if (requestId !== casesRequestRef.current) return null;
      setCasesError((reason as Error).message);
      showToast((reason as Error).message);
      return null;
    }
  }, [router, showToast]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void reloadCases(), 0);
    return () => { window.clearTimeout(timeout); casesRequestRef.current += 1; };
  }, [reloadCases, viewer.role, viewer.subject, viewer.tenantId]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ONBOARDING_STORAGE_KEY) || window.location.search) return;
      const timeout = window.setTimeout(() => {
        setView("home");
        setTourStep(0);
        setTourOpen(true);
      }, 650);
      return () => window.clearTimeout(timeout);
    } catch {
      // Tutorialen kan stadig startes manuelt, hvis lokal lagring er blokeret.
    }
  }, []);

  const navigate = useCallback((next: View) => {
    if (!confirmNavigation()) return false;
    if (!canAccessArea(role, next)) {
      showToast("Din aktuelle rolle har ikke adgang til dette område.");
      return;
    }
    if (next === "application") { setCorrectionCaseNumber(null); setDraftCaseNumber(null); setNewFormKey((value) => value + 1); }
    setView(next);
    setMobileMenu(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }, [role, showToast]);

  const openCase = useCallback((id: string, sourceCases: CaseRecord[] = cases) => {
    if (!resolveAccessibleCase(viewer, id, sourceCases)) {
      showToast("Sagen findes ikke, eller du har ikke adgang til den.");
      return;
    }
    if (navigate("detail")) setSelectedId(id);
  }, [cases, navigate, showToast, viewer]);

  useEffect(() => {
    if (!casesLoaded || initialDeepLinkHandledRef.current) return;
    const timeout = window.setTimeout(() => {
      if (initialDeepLinkHandledRef.current) return;
      initialDeepLinkHandledRef.current = true;
      const caseNumber = caseNumberFromPortalLink(
        `${window.location.pathname}${window.location.search}`,
      );
      if (caseNumber) openCase(caseNumber);
      else {
        const params = new URLSearchParams(window.location.search);
        const requestedView = params.get("view") as View | null;
        if (requestedView && canAccessArea(role, requestedView)) {
          setView(requestedView);
          if (requestedView === "application") {
            setDraftCaseNumber(params.get("draft"));
            setCorrectionCaseNumber(params.get("correction"));
          }
        }
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [casesLoaded, openCase, role]);

  useEffect(() => {
    if (!initialDeepLinkHandledRef.current) return;
    const params = new URLSearchParams();
    if (view === "detail" && selectedId) params.set("case", selectedId);
    else if (view !== "home") params.set("view", view);
    if (view === "application" && draftCaseNumber) params.set("draft", draftCaseNumber);
    if (view === "application" && correctionCaseNumber) params.set("correction", correctionCaseNumber);
    const target = params.size ? `/?${params}` : "/";
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState(null, "", target);
    const pop = () => {
      if (!confirmNavigation()) { window.history.pushState(null, "", target); return; }
      const next = new URLSearchParams(window.location.search);
      const nextCase = next.get("case");
      const nextView = nextCase ? "detail" : (next.get("view") ?? "home") as View;
      if (!canAccessArea(role, nextView)) return;
      setSelectedId(nextCase);
      setDraftCaseNumber(next.get("draft"));
      setCorrectionCaseNumber(next.get("correction"));
      setView(nextView);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [view, selectedId, draftCaseNumber, correctionCaseNumber, role]);

  async function openNotification(notification: PortalNotification) {
    const caseNumber = caseNumberFromNotification(notification);
    if (!caseNumber) return;
    if (notification.status === "unread") {
      void notificationFeed.markRead(notification.id);
    }
    const refreshedCases = await reloadCases();
    openCase(caseNumber, refreshedCases ?? cases);
  }

  async function changeRole(nextRole: WorkspaceRole) {
    if (roleChangingRef.current || nextRole === role || !confirmNavigation()) return;
    roleChangingRef.current = true;
    setRoleChanging(true);
    casesRequestRef.current += 1;
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = (await response.json()) as { viewer?: Actor; error?: string };
      if (!response.ok || !payload.viewer) {
        throw new Error(payload.error || "Testrollen kunne ikke skiftes.");
      }
      setViewer(payload.viewer);
      setCases([]);
      setCasesLoaded(false);
      if (nextRole !== "admin") {
        setEditorMode(false);
        setEditorSelection(null);
      }
      setProfileOpen(false);
      setNotificationsOpen(false);
      setMobileMenu(false);
      setSelectedId(null);
      setCorrectionCaseNumber(null);
      setDraftCaseNumber(null);
      setView(defaultAreaForRole(nextRole));
      showToast(`Testrolle skiftet til ${ROLE_LABELS[nextRole]}.`);
    } catch (reason) {
      showToast((reason as Error).message);
    } finally {
      roleChangingRef.current = false;
      setRoleChanging(false);
    }
  }

  async function logout() {
    if (!confirmNavigation()) return;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Du kunne ikke logges ud. Prøv igen.");
      router.replace("/login");
      router.refresh();
    } catch (reason) {
      showToast((reason as Error).message);
    }
  }

  function startTutorial() {
    if (!confirmNavigation()) return;
    setView("home");
    setMobileMenu(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setEditorSelection(null);
    setTourStep(0);
    setTourOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function completeTutorial() {
    setTourOpen(false);
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {
      // Tutorialstatus er en bekvemmelighed og må ikke blokere portalen.
    }
    showToast("Tutorialen er gennemført. Du kan starte den igen fra din profil.");
  }

  return (
    <div className="site-shell">
      <Header
        view={view}
        mobileMenu={mobileMenu}
        profileOpen={profileOpen}
        notificationsOpen={notificationsOpen}
        notifications={notificationFeed.notifications}
        notificationCount={notificationFeed.unreadCount}
        notificationsLoading={notificationFeed.loading}
        notificationsError={notificationFeed.error}
        role={role}
        viewer={viewer}
        canSwitchRole={viewer.provider === "dev"}
        roleChanging={roleChanging}
        onNavigate={navigate}
        onRoleChange={(nextRole) => void changeRole(nextRole)}
        onMobileMenu={() => setMobileMenu(!mobileMenu)}
        onProfile={() => {
          setProfileOpen(!profileOpen);
          setNotificationsOpen(false);
        }}
        onNotifications={() => {
          setNotificationsOpen(!notificationsOpen);
          setProfileOpen(false);
        }}
        onMarkNotificationsRead={() => void notificationFeed.markAllRead()}
        onOpenNotification={(notification) => void openNotification(notification)}
        editorMode={editorMode}
        onToggleEditor={() => {
          if (!workspace.ready) { showToast("Vent, til portalindholdet er hentet, før du aktiverer editoren."); return; }
          setEditorSelection(null);
          setEditorMode((current) => !current);
          setProfileOpen(false);
        }}
        onTutorial={startTutorial}
        onLogout={() => void logout()}
      />

      <main id="main-content">
        {(view === "cases" || view === "consultant") && (!casesLoaded || casesError) ? <div className="page-width data-state" role={casesError ? "alert" : "status"}><Info size={22} /><div><strong>{casesError ? "Sagsoversigten kunne ikke opdateres" : "Henter dine sager…"}</strong><p>{casesError ?? "Vi kontrollerer din adgang og henter de seneste oplysninger."}</p></div>{casesError ? <button className="line-button" onClick={() => void reloadCases()}>Prøv igen</button> : null}</div> : null}
        {["home", "knowledge", "admin"].includes(view) && !workspace.ready ? <div className="page-width data-state" role={workspace.error ? "alert" : "status"}><Info size={22} /><div><strong>{workspace.error ? "Portalindholdet kunne ikke hentes" : "Henter portalindhold…"}</strong><p>{workspace.error ?? "Vi henter de publicerede tekster og vejledninger."}</p></div>{workspace.error ? <button className="line-button" onClick={() => void workspace.refresh()}>Prøv igen</button> : null}</div> : null}
        {view === "home" && workspace.ready ? (
          <HomeView
            role={role}
            content={workspace.content}
            images={workspace.images}
            editorMode={editorMode}
            onEdit={(entry) => setEditorSelection({ kind: "content", entry })}
            onEditImage={(entry) => setEditorSelection({ kind: "image", entry })}
            onNavigate={navigate}
          />
        ) : null}
        {view === "cases" && casesLoaded && !casesError ? (
          <CasesView personal={role === "user"} rows={visibleCases} onNew={() => navigate("application")} onOpen={openCase} />
        ) : null}
        {view === "consultant" && casesLoaded && !casesError ? (
          <ConsultantView rows={visibleCases} onOpen={openCase} />
        ) : null}
        {view === "application" ? (
          <ApplicationFormView
            key={`${viewer.subject}:${correctionCaseNumber ?? draftCaseNumber ?? `new-${newFormKey}`}`}
            correctionCaseNumber={correctionCaseNumber}
            draftCaseNumber={draftCaseNumber}
            onBack={() => {
              const caseNumber = correctionCaseNumber ?? draftCaseNumber;
              if (caseNumber) {
                if (navigate("detail")) { setSelectedId(caseNumber); setCorrectionCaseNumber(null); setDraftCaseNumber(null); }
              } else {
                navigate("cases");
              }
            }}
            guidance={{
              intro: workspace.ready ? contentBody(workspace.content, "form.intro", "Spørgsmålene følger D-GITA-processen og tilpasses dine svar undervejs.") : "",
              catalog: workspace.ready ? contentBody(workspace.content, "form.catalog", "Resultatet viser samtidig, om systemet bruges i Kalundborg.") : "",
              marketResearch: workspace.ready ? contentBody(workspace.content, "form.market-research", "Har du undersøgt, hvilke løsninger der bedst matcher behov, pris og kvalitet?") : "",
            }}
            onSubmit={(_snapshot, result) => {
              showToast(result.mode === "correction" ? `Version ${result.versionNumber} er versionslåst og genindsendt sikkert.` : "Ansøgningen er versionslåst og indsendt sikkert.");
              void reloadCases().then((refreshedCases) => {
                if (result.mode === "correction") {
                  setSelectedId(result.caseNumber);
                  if (refreshedCases && resolveAccessibleCase(viewer, result.caseNumber, refreshedCases)) navigate("detail");
                  else navigate("cases");
                } else {
                  navigate("cases");
                }
              });
            }}
            onToast={showToast}
          />
        ) : null}
        {view === "detail" && selectedCase ? (
          <CaseDetail
            key={`${viewer.subject}:${selectedCase.id}`}
            item={selectedCase}
            viewer={viewer}
            approval={workspace.approvals[selectedCase.id] ?? EMPTY_D_GITA_APPROVAL}
            workspaceReady={workspace.ready}
            onRetryWorkspace={() => void workspace.refresh()}
            fieldComments={workspace.fieldComments.filter((comment) => comment.caseId === selectedCase.id)}
            onBack={() => navigate(role === "user" ? "cases" : "consultant")}
            onStartCorrection={viewer.role === "user" && selectedCase.status === "changes_requested" ? () => {
              if (navigate("application")) setCorrectionCaseNumber(selectedCase.id);
            } : undefined}
            onEditDraft={capabilitiesFor(viewer.role).createApplications && selectedCase.ownerSubject === viewer.subject && selectedCase.status === "draft" ? () => {
              if (navigate("application")) setDraftCaseNumber(selectedCase.id);
            } : undefined}
            onCaseChanged={async () => {
              await reloadCases();
            }}
            onSaveApproval={async (approval) => {
              try {
                const saved = await workspace.updateApproval(selectedCase.id, approval, viewer);
                if (saved) { showToast("D-GITA-godkendelsen er gemt med auditspor."); await reloadCases(); }
                return saved;
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onAddFieldComment={async (fieldId, fieldLabel, body) => {
              const comment: FieldComment = {
                id: crypto.randomUUID(),
                caseId: selectedCase.id,
                fieldId,
                fieldLabel,
                body,
                authorSubject: viewer.subject,
                authorName: viewer.displayName,
                createdAt: new Date().toISOString(),
                visibility: "applicant",
              };
              try {
                const saved = await workspace.addFieldComment(comment, viewer);
                if (saved) showToast("Feltkommentaren er gemt og synlig for anmoderen.");
                return saved;
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onToast={showToast}
          />
        ) : null}
        {view === "detail" && !selectedCase ? (
          <AccessDenied onBack={() => navigate(defaultAreaForRole(role))} />
        ) : null}
        {view === "knowledge" && workspace.ready ? (
          <KnowledgeView
            content={workspace.content}
            images={workspace.images}
            editorMode={editorMode}
            onEdit={(entry) => setEditorSelection({ kind: "content", entry })}
            onEditImage={(entry) => setEditorSelection({ kind: "image", entry })}
          />
        ) : null}
        {view === "admin" && workspace.ready ? (
          <AdminView
            content={workspace.content}
            viewer={viewer}
            onUpdateContent={async (entry) => {
              try {
                return await workspace.updateContent(entry, viewer);
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onAddContent={async (entry) => {
              try {
                return await workspace.addContent(entry, viewer);
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onRemoveContent={async (id) => {
              try {
                return await workspace.removeContent(id, viewer);
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onResetContent={async () => {
              try {
                const [contentReset, imagesReset] = await Promise.all([
                  workspace.resetContent(viewer),
                  workspace.resetImages(viewer),
                ]);
                return contentReset && imagesReset;
              } catch (reason) {
                showToast((reason as Error).message);
                return false;
              }
            }}
            onToast={showToast}
          />
        ) : null}
      </main>

      <PartnerFooter />

      {toast ? (
        <div className="site-toast" role="status">
          <Info size={19} />
          <span>{toast}</span>
          <button type="button" aria-label="Luk besked" onClick={() => setToast(null)}>
            <X size={17} />
          </button>
        </div>
      ) : null}

      {role === "admin" ? (
        <EditorToolbar
          active={editorMode}
          onToggle={() => {
            if (!workspace.ready) { showToast("Vent, til portalindholdet er hentet, før du aktiverer editoren."); return; }
            setEditorSelection(null);
            setEditorMode((current) => !current);
          }}
          onOpenLibrary={() => navigate("admin")}
        />
      ) : null}
      <EditorDrawer
        key={editorSelection ? `${editorSelection.kind}:${editorSelection.entry.id}` : "closed"}
        selection={role === "admin" && editorMode ? editorSelection : null}
        onClose={() => setEditorSelection(null)}
        onSaveContent={async (entry) => {
          try {
            const saved = await workspace.updateContent(entry, viewer);
            if (saved) showToast(entry.published ? `“${entry.title}” er gemt og publiceret på siden.` : `“${entry.title}” er gemt og afpubliceret.`);
            return saved;
          } catch (reason) {
            showToast((reason as Error).message);
            return false;
          }
        }}
        onSaveImage={async (entry) => {
          try {
            const saved = await workspace.updateImage(entry, viewer);
            if (saved) showToast("Portalbilledet er erstattet.");
            return saved;
          } catch (reason) {
            showToast((reason as Error).message);
            return false;
          }
        }}
        onResetImages={async () => {
          try {
            const reset = await workspace.resetImages(viewer);
            if (reset) showToast("Standardbillederne er gendannet.");
            return reset;
          } catch (reason) {
            showToast((reason as Error).message);
            return false;
          }
        }}
        onOpenLibrary={() => {
          if (navigate("admin")) setEditorSelection(null);
        }}
      />
      <SpotlightTour
        returnFocusSelector='[data-tour="profile"]'
        open={tourOpen}
        steps={onboardingSteps}
        activeStep={tourStep}
        onActiveStepChange={setTourStep}
        onClose={(reason) => {
          setTourOpen(false);
          if (reason === "skip") {
            try { window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true"); } catch {}
          }
        }}
        onComplete={completeTutorial}
      />
    </div>
  );
}

function Header({
  view,
  role,
  viewer,
  canSwitchRole,
  roleChanging,
  mobileMenu,
  profileOpen,
  notificationsOpen,
  notifications,
  notificationCount,
  notificationsLoading,
  notificationsError,
  onNavigate,
  onRoleChange,
  onMobileMenu,
  onProfile,
  onNotifications,
  onMarkNotificationsRead,
  onOpenNotification,
  editorMode,
  onToggleEditor,
  onTutorial,
  onLogout,
}: {
  view: View;
  role: WorkspaceRole;
  viewer: Actor;
  canSwitchRole: boolean;
  roleChanging: boolean;
  mobileMenu: boolean;
  profileOpen: boolean;
  notificationsOpen: boolean;
  notifications: PortalNotification[];
  notificationCount: number;
  notificationsLoading: boolean;
  notificationsError: string | null;
  onNavigate: (view: View) => void;
  onRoleChange: (role: WorkspaceRole) => void;
  onMobileMenu: () => void;
  onProfile: () => void;
  onNotifications: () => void;
  onMarkNotificationsRead: () => void;
  onOpenNotification: (notification: PortalNotification) => void;
  editorMode: boolean;
  onToggleEditor: () => void;
  onTutorial: () => void;
  onLogout: () => void;
}) {
  const allNavigation: Array<{ label: string; view: View }> = [
    { label: "Startside", view: "home" },
    { label: role === "admin" ? "Ansøgninger" : "Mine ansøgninger", view: "cases" },
    { label: "D-GITA Konsulent", view: "consultant" },
    { label: "Vejledning & FAQ", view: "knowledge" },
    { label: "Admin", view: "admin" },
  ];
  const navigation = allNavigation.filter((item) => canAccessArea(role, item.view));

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Gå til hovedindhold</a>
      <div className="header-inner">
        <button className="wordmark" data-tour="home" type="button" aria-label="Gå til startsiden" onClick={() => onNavigate("home")}>
          <BrandLockup />
        </button>

        <nav className={cx("site-nav", mobileMenu && "open")} data-tour="primary-navigation" aria-label="Primær navigation">
          {navigation.map((item) => (
            <button
              className={cx(view === item.view && "active")}
              key={item.label}
              type="button"
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          {canSwitchRole ? <label className="role-switcher" data-tour="role-switcher">
            <span>Testrolle</span>
            <select
              aria-label="Skift testrolle"
              disabled={roleChanging}
              value={role}
              onChange={(event) => onRoleChange(event.target.value as WorkspaceRole)}
            >
              {WORKSPACE_ROLES.map((value) => (
                <option key={value} value={value}>{ROLE_LABELS[value]}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label> : null}
          <div className="header-popover-anchor">
            <button className="header-icon-button" data-tour="notifications" type="button" aria-label="Notifikationer" aria-expanded={notificationsOpen} onClick={onNotifications}>
              <Bell size={20} />
              {notificationCount > 0 ? <span>{Math.min(notificationCount, 99)}</span> : null}
            </button>
            {notificationsOpen ? <NotificationPanel notifications={notifications} unreadCount={notificationCount} loading={notificationsLoading} error={notificationsError} onMarkAllRead={onMarkNotificationsRead} onOpen={onOpenNotification} /> : null}
          </div>
          <div className="header-popover-anchor profile-anchor">
            <button className="account-button" data-tour="profile" type="button" aria-expanded={profileOpen} onClick={onProfile}>
              <span className="account-avatar">{viewer.initials}</span>
              <span className="account-copy"><strong>{viewer.displayName}</strong><small>{viewer.municipality}</small></span>
              <ChevronDown size={16} />
            </button>
            {profileOpen ? (
              <div className="header-popover profile-menu">
                <div className="profile-menu-head"><span>{viewer.initials}</span><div><strong>{viewer.displayName}</strong><small>{ROLE_LABELS[role]}{viewer.provider === "dev" ? " · testtilstand" : ""}</small></div></div>
                {canSwitchRole ? <label className="profile-role-switcher">
                  <span>Testrolle</span>
                  <select disabled={roleChanging} aria-label="Skift testrolle fra profilmenuen" value={role} onChange={(event) => onRoleChange(event.target.value as WorkspaceRole)}>
                    {WORKSPACE_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label> : null}
                {capabilitiesFor(role).createApplications ? <button type="button" onClick={() => onNavigate("cases")}><ReceiptText size={17} /> Mine kvitteringer</button> : null}
                <button type="button" onClick={onTutorial}><BookOpen size={17} /> Tutorial</button>
                {role === "admin" ? <button type="button" onClick={onToggleEditor}><PencilLine size={17} /> Editor mode: {editorMode ? "aktiv" : "slået fra"}</button> : null}
                <button type="button" onClick={onLogout}><LogOut size={17} /> Log ud</button>
              </div>
            ) : null}
          </div>
          <button className="mobile-menu-button" type="button" aria-label="Vis navigation" aria-expanded={mobileMenu} onClick={onMobileMenu}>
            {mobileMenu ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function NotificationPanel({
  notifications,
  unreadCount,
  loading,
  error,
  onMarkAllRead,
  onOpen,
}: {
  notifications: PortalNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onMarkAllRead: () => void;
  onOpen: (notification: PortalNotification) => void;
}) {
  return (
    <div className="header-popover notification-panel">
      <div className="popover-title"><strong>Notifikationer</strong>{unreadCount > 0 ? <button type="button" onClick={onMarkAllRead}>Markér alle som læst</button> : <span>Ingen nye</span>}</div>
      {loading ? <div className="notice-empty"><Clock3 size={18} /><p>Henter notifikationer…</p></div> : null}
      {error ? <div className="notice-empty"><Info size={18} /><p>{error}</p></div> : null}
      {!loading && !error && notifications.length === 0 ? <div className="notice-empty"><Bell size={18} /><p>Der er ingen notifikationer endnu.</p></div> : null}
      {!loading ? notifications.map((notification) => {
        const Icon = notification.eventType.includes("submitted") ? FileCheck2 : notification.eventType.includes("mail") ? Mail : Info;
        const content = <><span><Icon size={18} /></span><div><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatNotificationTime(notification.createdAt)}</small></div></>;
        return caseNumberFromNotification(notification)
          ? <button className={cx("notice", notification.status === "unread" && "unread")} type="button" key={notification.id} onClick={() => onOpen(notification)}>{content}</button>
          : <div className={cx("notice", notification.status === "unread" && "unread")} key={notification.id}>{content}</div>;
      }) : null}
    </div>
  );
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function HomeView({
  role,
  content,
  images,
  editorMode,
  onEdit,
  onEditImage,
  onNavigate,
}: {
  role: WorkspaceRole;
  content: ContentEntry[];
  images: ImageEntry[];
  editorMode: boolean;
  onEdit: (entry: ContentEntry) => void;
  onEditImage: (entry: ImageEntry) => void;
  onNavigate: (view: View) => void;
}) {
  const canCreate = capabilitiesFor(role).createApplications;
  const localEmail = contactEmail(content);
  const localName = contentBody(content, "contact.local.name", "Din lokale konsulent");
  return (
    <div className="home-page">
      <section className="editorial-hero">
        <div className="hero-photo">
          <ManagedImage images={images} imageId="home.hero.image" fallbackSrc="/dgita-hero.png" fallbackAlt="Kommunale medarbejdere samarbejder om en IT-anskaffelse" editorMode={editorMode} onEdit={onEditImage} priority />
        </div>
        <div className="hero-content">
          <EditableText as="span" className="section-label" content={content} contentId="home.hero.eyebrow" fallback="Kalundborg Kommune · D-GITA" editorMode={editorMode} onEdit={onEdit} />
          <EditableText as="h1" content={content} contentId="home.hero.title" fallback="En god IT-anskaffelse starter med det rigtige behov." editorMode={editorMode} onEdit={onEdit} />
          <EditableText as="p" content={content} contentId="home.hero.body" fallback="Opret en ansøgning, eller se dine igangværende og historiske ansøgninger." editorMode={editorMode} onEdit={onEdit} />
          {editorMode || isContentVisible(content, "home.hero.note") ? <p className="hero-note"><Info size={17} /> <EditableText as="span" content={content} contentId="home.hero.note" fallback="Portalen bruges til køb under udbudsgrænsen." editorMode={editorMode} onEdit={onEdit} /></p> : null}
          <div className="hero-actions">
            {canCreate ? <button className="solid-button" data-tour="primary-action" type="button" onClick={() => onNavigate("application")}>Opret ansøgning <ArrowRight size={18} /></button> : null}
            <button className={canCreate ? "line-button light" : "solid-button"} data-tour={canCreate ? undefined : "primary-action"} type="button" onClick={() => onNavigate(role === "user" ? "cases" : "consultant")}>
              {role === "user" ? "Se mine ansøgninger" : "Åbn D-GITA-arbejdskøen"}
            </button>
          </div>
        </div>
      </section>

      <section className="home-intro page-width">
        <div className="intro-heading">
          <EditableText as="span" className="section-label dark" content={content} contentId="home.intro.eyebrow" fallback="Fra idé til sikker anskaffelse" editorMode={editorMode} onEdit={onEdit} />
          <EditableText as="h2" content={content} contentId="home.intro.title" fallback="Portalen samler hele forløbet." editorMode={editorMode} onEdit={onEdit} />
        </div>
        <EditableText as="p" content={content} contentId="home.intro.body" fallback="Du beskriver behovet én gang. Derefter hjælper D-GITA-konsulenten med marked, arkitektur, sikkerhed, økonomi, dokumentation og ledergodkendelse." editorMode={editorMode} onEdit={onEdit} />
      </section>

      <section className="process-section page-width" aria-label="D-GITA-processen">
        <ProcessStep number="01" content={content} titleId="home.process.describe.title" bodyId="home.process.describe.body" title="Beskriv behovet" text="Svar på de relevante spørgsmål om systemet, arbejdsprocesserne og værdien for kommunen." editorMode={editorMode} onEdit={onEdit} />
        <ProcessStep number="02" content={content} titleId="home.process.advise.title" bodyId="home.process.advise.body" title="Få faglig sparring" text="Din lokale D-GITA-konsulent gennemgår anskaffelsesform, risiko, data og IT-krav." editorMode={editorMode} onEdit={onEdit} />
        <ProcessStep number="03" content={content} titleId="home.process.approve.title" bodyId="home.process.approve.body" title="Indhent godkendelse" text="Lederen modtager et samlet, versionslåst beslutningsgrundlag og godkender digitalt." editorMode={editorMode} onEdit={onEdit} />
        <ProcessStep number="04" content={content} titleId="home.process.document.title" bodyId="home.process.document.body" title="Gem dokumentationen" text="Kvitteringer, bilag, kommentarer og statusændringer bliver samlet på sagen." editorMode={editorMode} onEdit={onEdit} />
      </section>

      <section className="help-editorial page-width">
        <div className="help-photo">
          <ManagedImage images={images} imageId="home.help.image" fallbackSrc="/dgita-help.png" fallbackAlt="En D-GITA-konsulent hjælper en kollega" editorMode={editorMode} onEdit={onEditImage} />
        </div>
        <div className="help-copy">
          <EditableText as="span" className="section-label dark" content={content} contentId="home.help.eyebrow" fallback="Har du brug for hjælp?" editorMode={editorMode} onEdit={onEdit} />
          <EditableText as="h2" content={content} contentId="home.help.title" fallback="Få afklaring, før du udfylder ansøgningen." editorMode={editorMode} onEdit={onEdit} />
          <EditableText as="p" content={content} contentId="home.help.body" fallback="Er du i tvivl om din IT-anskaffelse, hjælper din lokale konsulent dig i gang." editorMode={editorMode} onEdit={onEdit} />
          <div className="contact-person">
            <span>{personInitials(localName)}</span>
            <div><EditableText as="small" content={content} contentId="contact.local.role" fallback="Din lokale D-GITA-konsulent" editorMode={editorMode} onEdit={onEdit} /><EditableText as="strong" content={content} contentId="contact.local.name" fallback="Din lokale konsulent" editorMode={editorMode} onEdit={onEdit} />{localEmail ? <a href={`mailto:${localEmail}`}><EditableText as="span" content={content} contentId="contact.local.email" fallback="" editorMode={editorMode} onEdit={onEdit} insideInteractive /></a> : editorMode ? <EditableText as="span" content={content} contentId="contact.local.email" fallback="" editorMode={editorMode} onEdit={onEdit} /> : null}</div>
          </div>
          {localEmail ? <a className="solid-button dark" href={`mailto:${localEmail}?subject=Ønske%20om%20D-GITA-formøde`}>Book et formøde <ArrowRight size={18} /></a> : null}
        </div>
      </section>

      <section className="resources-section page-width">
        <div className="resources-heading"><EditableText as="span" className="section-label dark" content={content} contentId="home.resources.eyebrow" fallback="Viden og vejledning" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="home.resources.title" fallback="Genveje til et bedre forløb" editorMode={editorMode} onEdit={onEdit} /></div>
        <div className="resource-list" data-tour="knowledge-link">
          <ResourceLink content={content} titleId="home.resources.about.title" bodyId="home.resources.about.body" title="Om D-GITA" text="Læs om portalen og processen." editorMode={editorMode} onEdit={onEdit} onClick={() => onNavigate("knowledge")} />
          <ResourceLink content={content} titleId="home.resources.guide.title" bodyId="home.resources.guide.body" title="Vejledning / FAQ" text="Begreber, funktioner og svar undervejs." editorMode={editorMode} onEdit={onEdit} onClick={() => onNavigate("knowledge")} />
          <ResourceLink content={content} titleId="home.resources.links.title" bodyId="home.resources.links.body" title="Nyttige links" text="KITOS, databehandleraftaler og lokale skabeloner." editorMode={editorMode} onEdit={onEdit} onClick={() => onNavigate("knowledge")} />
          <ResourceLink content={content} titleId="home.resources.municipality.title" bodyId="home.resources.municipality.body" title="Info fra din kommune" text="Særlige krav og information fra Kalundborg." editorMode={editorMode} onEdit={onEdit} onClick={() => onNavigate("knowledge")} />
          <ResourceLink content={content} titleId="home.resources.changelog.title" bodyId="home.resources.changelog.body" title="Ny funktionalitet" text="Se de seneste ændringer i portalen." editorMode={editorMode} onEdit={onEdit} onClick={() => onNavigate("knowledge")} />
        </div>
        <div className="operation-strip"><span className="operation-dot" /><strong>Drift og integrationer</strong><span>Databasens og mailkøens status vises for administratorer under Integrationer og Mail &amp; kvitteringer.</span></div>
      </section>
    </div>
  );
}

function ProcessStep({ number, content, titleId, bodyId, title, text, editorMode, onEdit }: { number: string; content: ContentEntry[]; titleId: string; bodyId: string; title: string; text: string; editorMode: boolean; onEdit: (entry: ContentEntry) => void }) {
  return <article className="process-step"><span>{number}</span><EditableText as="h3" content={content} contentId={titleId} fallback={title} editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId={bodyId} fallback={text} editorMode={editorMode} onEdit={onEdit} /></article>;
}

function contactEmail(content: ContentEntry[]) {
  const email = contentBody(content, "contact.local.email", "").trim();
  return /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/u.test(email) ? email : "";
}

function ResourceLink({ content, titleId, bodyId, title, text, editorMode, onEdit, onClick }: { content: ContentEntry[]; titleId: string; bodyId: string; title: string; text: string; editorMode: boolean; onEdit: (entry: ContentEntry) => void; onClick: () => void }) {
  if (!editorMode && !isContentVisible(content, titleId)) return null;
  return <button className="resource-link" type="button" onClick={onClick}><span><EditableText as="strong" content={content} contentId={titleId} fallback={title} editorMode={editorMode} onEdit={onEdit} insideInteractive /><EditableText as="small" content={content} contentId={bodyId} fallback={text} editorMode={editorMode} onEdit={onEdit} insideInteractive /></span><ArrowRight size={19} /></button>;
}

function CasesView({ personal, rows: availableRows, onNew, onOpen }: { personal: boolean; rows: CaseRecord[]; onNew: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("Alle faser");
  const rows = useMemo(() => availableRows.filter((item) => {
    const q = query.toLowerCase();
    return (!q || `${item.id} ${item.system}`.toLowerCase().includes(q)) && (phase === "Alle faser" || item.phase === phase);
  }), [availableRows, query, phase]);
  const featured = availableRows[0];

  return (
    <div className="portal-page page-width">
      <PageIntro eyebrow={personal ? "Din sagsoversigt" : "Administrativ sagsoversigt"} title={personal ? "Mine ansøgninger" : "Alle ansøgninger"} text={personal ? "Følg dine igangværende og historiske IT-anskaffelser, kommentarer, ledergodkendelser og filer." : "Se alle ansøgninger i kommunen med ejer, status, godkendelse og ansvarlig konsulent."}>
        <button className="solid-button" type="button" onClick={onNew}><Plus size={18} /> Opret ansøgning</button>
      </PageIntro>

      {featured ? <section className="featured-case">
        <div className="featured-case-copy">
          <span className="section-label dark">Senest ændret · {featured.id}</span>
          <h2>{featured.system}</h2>
          <p>Sagen er {featured.phase.toLowerCase()}{featured.consultant !== "Ikke tildelt" ? ` hos ${featured.consultant}` : " og afventer tildeling"}.</p>
          <div className="featured-meta"><PhaseTag phase={featured.phase} /><ApprovalTag approval={featured.approval} /><span>Ændret {featured.changed}</span></div>
        </div>
        <div className="featured-progress" aria-label="Sagsforløb">
          {D_GITA_PHASES.map((phase, index) => <span key={phase} className={index < D_GITA_PHASES.indexOf(featured.phase) ? "done" : phase === featured.phase ? "current" : ""} title={phase}>{index < D_GITA_PHASES.indexOf(featured.phase) ? <Check size={16} /> : index + 1}</span>)}
        </div>
        <button className="line-button" type="button" onClick={() => onOpen(featured.id)}>Åbn sag <ArrowRight size={17} /></button>
      </section> : null}

      <section className="records-section">
        <div className="records-toolbar">
          <label className="clean-search"><Search size={18} /><input aria-label="Søg i ansøgninger" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg på sagsnummer eller system" /></label>
          <label className="clean-select"><Filter size={17} /><select value={phase} onChange={(event) => setPhase(event.target.value)} aria-label="Filtrér på fase"><option>Alle faser</option><option>Kladde</option><option>Indsendt</option><option>Under behandling</option><option>Afsluttet</option></select><ChevronDown size={16} /></label>
        </div>
        <RecordsTable rows={rows} onOpen={onOpen} applicantMode />
      </section>
    </div>
  );
}

function ConsultantView({ rows: availableRows, onOpen }: { rows: CaseRecord[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("Alle faser");
  const rows = useMemo(() => availableRows.filter((item) => {
    const q = query.toLowerCase();
    return (!q || `${item.id} ${item.system} ${item.applicant}`.toLowerCase().includes(q)) && (phase === "Alle faser" || item.phase === phase);
  }), [availableRows, query, phase]);
  const stats = useMemo(() => ({
    submitted: availableRows.filter((item) => item.phase === "Indsendt").length,
    reviewing: availableRows.filter((item) => item.phase === "Under behandling").length,
    awaitingLeader: availableRows.filter((item) => item.approval === "Afventer").length,
    closed: availableRows.filter((item) => item.phase === "Afsluttet").length,
  }), [availableRows]);
  const actionCount = new Set(availableRows.filter((item) => item.phase === "Indsendt" || item.approval === "Afventer").map((item) => item.id)).size;

  function exportRows() {
    const header = ["Sagsnummer", "System", "Fase", "Anmoder", "Kommune", "Konsulent", "Ledergodkendelse", "Oprettet", "Ændret"];
    const data = rows.map((item) => [item.id, item.system, item.phase, item.applicant, item.municipality, item.consultant, item.approval, item.created, item.changed]);
    const csv = `\uFEFF${[header, ...data].map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dgita-sager-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="portal-page page-width">
      <PageIntro eyebrow="D-GITA Konsulent" title="Alle sager" text="Visiter, prioritér og følg ansøgninger på tværs af fase, godkendelsesstatus, kommune og ansvarlig konsulent.">
        <div className="queue-count"><span>{actionCount}</span><div><small>Kræver handling</small><strong>I din arbejdskø</strong></div></div>
      </PageIntro>

      <section className="consultant-summary" aria-label="Sagsstatus">
        <SummaryStat value={String(stats.submitted)} label="Indsendt" detail="afventer visitering" />
        <SummaryStat value={String(stats.reviewing)} label="Under behandling" detail="aktive sager" />
        <SummaryStat value={String(stats.awaitingLeader)} label="Afventer leder" detail="åbne godkendelser" />
        <SummaryStat value={String(stats.closed)} label="Afsluttet" detail="alle gemte sager" />
      </section>

      <section className="records-section consultant-records">
        <div className="consultant-filter-title"><div><span className="section-label dark">Sagsliste</span><h2>Aktive ansøgninger</h2></div><button className="line-button" type="button" disabled={rows.length === 0} onClick={exportRows}><Download size={17} /> Eksportér CSV</button></div>
        <div className="records-toolbar">
          <label className="clean-search"><Search size={18} /><input aria-label="Søg i alle sager" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sagsnummer, system eller anmoder" /></label>
          <label className="clean-select"><Filter size={17} /><select value={phase} onChange={(event) => setPhase(event.target.value)}><option>Alle faser</option><option>Kladde</option><option>Indsendt</option><option>Under behandling</option><option>Afsluttet</option></select><ChevronDown size={16} /></label>
        </div>
        <RecordsTable rows={rows} onOpen={onOpen} />
      </section>
    </div>
  );
}

function SummaryStat({ value, label, detail }: { value: string; label: string; detail: string }) {
  return <article><strong>{value}</strong><div><span>{label}</span><small>{detail}</small></div></article>;
}

function RecordsTable({ rows, onOpen, applicantMode }: { rows: CaseRecord[]; onOpen: (id: string) => void; applicantMode?: boolean }) {
  return (
    <div className="clean-table-wrap">
      <table className="clean-table">
        <thead><tr><th>Sag</th><th>Fase</th><th>Oprettet</th><th>Ændret</th><th>{applicantMode ? "D-GITA Konsulent" : "Anmoder"}</th><th>Leder godkendt</th><th aria-label="Åbn" /></tr></thead>
        <tbody>{rows.map((item) => (
          <tr key={item.id} onClick={() => onOpen(item.id)}>
            <td><div className="record-name"><span>{item.system.slice(0, 2).toUpperCase()}</span><div><strong>{item.system}</strong><small>{item.id} · {item.municipality}</small></div></div></td>
            <td><PhaseTag phase={item.phase} /></td>
            <td>{item.created}</td>
            <td>{item.changed}</td>
            <td>{applicantMode ? item.consultant : item.applicant}</td>
            <td><ApprovalTag approval={item.approval} /></td>
            <td><button className="table-action" type="button" aria-label={`Åbn ${item.id}`}><ArrowRight size={18} /></button></td>
          </tr>
        ))}</tbody>
      </table>
      {rows.length === 0 ? <div className="no-records"><Search size={25} /><strong>Ingen sager matcher</strong><p>Prøv et andet søgeord eller en anden fase.</p></div> : null}
    </div>
  );
}

function PhaseTag({ phase }: { phase: Phase }) {
  const tone = phase === "Kladde" ? "gray" : phase === "Indsendt" ? "blue" : phase === "Under behandling" ? "amber" : "green";
  return <span className={cx("phase-tag", tone)}><i />{phase}</span>;
}

function ApprovalTag({ approval }: { approval: Approval }) {
  const tone = approval === "Godkendt" ? "green" : approval === "Afventer" ? "amber" : approval === "Afvist" ? "red" : "gray";
  return <span className={cx("approval-tag", tone)}>{approval === "Godkendt" ? <CheckCircle2 size={14} /> : approval === "Afvist" ? <XCircle size={14} /> : <Clock3 size={14} />}{approval}</span>;
}

function PageIntro({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children?: ReactNode }) {
  return <div className="page-intro"><div><span className="section-label dark">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{children ? <div className="page-intro-action">{children}</div> : null}</div>;
}

function AccessDenied({ onBack }: { onBack: () => void }) {
  return <div className="portal-page page-width"><section className="plain-section access-denied"><LockKeyhole size={28} /><span className="section-label dark">Adgang afvist</span><h1>Du kan ikke åbne denne ansøgning</h1><p>Sagen findes ikke, eller den tilhører en anden bruger. Almindelige brugere kan kun se deres egne ansøgninger.</p><button className="solid-button" type="button" onClick={onBack}><ArrowLeft size={17} /> Tilbage til dit område</button></section></div>;
}

function KnowledgeView({
  content,
  images,
  editorMode,
  onEdit,
  onEditImage,
}: {
  content: ContentEntry[];
  images: ImageEntry[];
  editorMode: boolean;
  onEdit: (entry: ContentEntry) => void;
  onEditImage: (entry: ImageEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const published = useMemo(() => content.filter((entry) => entry.published), [content]);
  const searchResults = useMemo(
    () => searchKnowledge(
      published.filter((entry) => entry.category === "form_help" || entry.category === "faq"),
      query,
    ),
    [published, query],
  );
  const guidance = searchResults.filter((result) => result.item.category === "form_help").map((result) => result.item);
  const faqs = searchResults.filter((result) => result.item.category === "faq").map((result) => result.item);
  const links = published.filter((entry) => entry.category === "link")
    .map((entry) => entry.id === "link.contact" ? { ...entry, url: contactEmail(content) ? `mailto:${contactEmail(content)}` : "" } : entry)
    .filter((entry) => Boolean(entry.url));
  const processor = published.filter((entry) => entry.category === "data_processor");
  const hasSearchResults = guidance.length > 0 || faqs.length > 0;
  const fuzzyMatch = query.trim() && searchResults.some((result) => result.matchKind === "fuzzy");

  return <div className="knowledge-page">
    <section className="knowledge-editorial-hero">
      <div className="knowledge-hero-photo"><ManagedImage images={images} imageId="knowledge.hero.image" fallbackSrc="/dgita-help.png" fallbackAlt="En D-GITA-konsulent vejleder en kommunal kollega" editorMode={editorMode} onEdit={onEditImage} priority /></div>
      <div className="knowledge-hero-copy"><EditableText as="span" className="section-label" content={content} contentId="knowledge.hero.eyebrow" fallback="Viden · Kalundborg Kommune" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h1" content={content} contentId="knowledge.hero.title" fallback="Vejledning til Den Gode IT-Anskaffelse" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.hero.body" fallback="En samlet gennemgang af IT-ansøgningsprocessen og D-GITA-konsulenternes rolle." editorMode={editorMode} onEdit={onEdit} /><div className="knowledge-hero-stats"><div><strong>{published.filter((entry) => entry.category === "form_help").length}</strong><small>vejledninger</small></div><div><strong>{published.filter((entry) => entry.category === "faq").length}</strong><small>FAQ-svar</small></div><div><strong>{links.length}</strong><small>nyttige links</small></div></div></div>
    </section>

    <div className="page-width knowledge-content">
      <section className="knowledge-intro"><div><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.intro.eyebrow" fallback="Information" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.intro.title" fallback="Kom godt fra behov til færdig sag." editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.info" fallback="Vejledningen tager dig gennem alle faser af en IT-anskaffelse." editorMode={editorMode} onEdit={onEdit} /></div><aside><Info size={21} /><div><EditableText as="strong" content={content} contentId="knowledge.tip.title" fallback="Vigtigt tip" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.tip" fallback="Involvér D-GITA-konsulenten tidligt i processen." editorMode={editorMode} onEdit={onEdit} /></div></aside></section>

      <section className="knowledge-process" aria-label="D-GITA-forløbet"><div className="knowledge-section-heading"><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.process.eyebrow" fallback="Det visuelle forløb" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.process.title" fallback="Tre roller. Ét fælles beslutningsgrundlag." editorMode={editorMode} onEdit={onEdit} /></div><div className="knowledge-process-steps"><article><span>01</span><EditableText as="small" content={content} contentId="knowledge.process.applicant.role" fallback="Anmoder" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h3" content={content} contentId="knowledge.process.applicant.title" fallback="Opret ansøgningen" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.process.applicant" fallback="Beskriv behovet og saml dokumentationen." editorMode={editorMode} onEdit={onEdit} /></article><article><span>02</span><EditableText as="small" content={content} contentId="knowledge.process.leader.role" fallback="Leder" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h3" content={content} contentId="knowledge.process.leader.title" fallback="Godkend grundlaget" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.process.leader" fallback="Lederen godkender eller afviser den indsendte version." editorMode={editorMode} onEdit={onEdit} /></article><article><span>03</span><EditableText as="small" content={content} contentId="knowledge.process.consultant.role" fallback="D-GITA" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h3" content={content} contentId="knowledge.process.consultant.title" fallback="Vurdér og færdigbehandl" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.process.consultant" fallback="D-GITA vurderer og færdigbehandler sagen i dialog med anmoderen." editorMode={editorMode} onEdit={onEdit} /></article></div></section>

      <section className="knowledge-about-grid"><article><BookOpen size={22} /><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.about.eyebrow" fallback="Om portalen" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.about.title" fallback="Den Gode IT-Anskaffelse" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.about" fallback="D-GITA samler de oplysninger, der skal bruges til en god IT-anskaffelse." editorMode={editorMode} onEdit={onEdit} /></article><article><UserCheck size={22} /><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.consultant.eyebrow" fallback="Rådgivning" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.consultant.title" fallback="D-GITA-konsulenten" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.consultant" fallback="Konsulenten hjælper med krav, dokumentation og kommunens IT-infrastruktur." editorMode={editorMode} onEdit={onEdit} /></article></section>

      <section className="knowledge-library"><div className="knowledge-library-head"><div><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.library.eyebrow" fallback="Ordbog og svar" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.library.title" fallback="Find det, du har brug for" editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.library.body" fallback="Søg på fx kontrakt, ESDH, risikovurdering, leder eller databehandleraftale." editorMode={editorMode} onEdit={onEdit} /></div><div className="knowledge-search-wrap"><label className="knowledge-search"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg i vejledninger og FAQ" aria-label="Søg i vejledninger og FAQ" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Ryd søgning"><X size={16} /></button> : null}</label><small className={fuzzyMatch ? "fuzzy-search-note matched" : "fuzzy-search-note"}>{fuzzyMatch ? "Vi fandt relevante svar trods en mulig stavefejl." : "Søgningen tåler almindelige stavefejl."}</small></div></div>
        {hasSearchResults ? <div className="knowledge-answer-grid"><section className="knowledge-accordion"><div className="knowledge-list-title"><BookOpen size={18} /><div><h3>Vejledninger</h3><small>{guidance.length} emner</small></div></div>{guidance.map((entry, index) => <div className="cms-item-shell" key={entry.id}><CollectionEditButton entry={entry} editorMode={editorMode} onEdit={onEdit} /><details className="guide-item"><summary><span>{String(index + 1).padStart(2, "0")}</span>{entry.title}<ChevronDown size={17} /></summary><div><p>{entry.body}</p><small>{entry.location}</small></div></details></div>)}</section><section className="knowledge-accordion"><div className="knowledge-list-title"><MessageSquare size={18} /><div><h3>Ofte stillede spørgsmål</h3><small>{faqs.length} svar</small></div></div>{faqs.map((entry) => <div className="cms-item-shell" key={entry.id}><CollectionEditButton entry={entry} editorMode={editorMode} onEdit={onEdit} /><details className="guide-item faq-guide-item"><summary><span>?</span>{entry.title}<ChevronDown size={17} /></summary><div><p>{entry.body}</p></div></details></div>)}</section></div> : <div className="knowledge-empty"><Search size={26} /><h3>Ingen svar matcher “{query}”</h3><p>Prøv et kortere søgeord, eller ryd søgningen for at se alle emner.</p><button className="line-button" type="button" onClick={() => setQuery("")}>Vis alle emner</button></div>}
      </section>

      <div className="knowledge-grid knowledge-bottom-grid"><section className="plain-section knowledge-section"><div className="plain-heading"><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.processor.eyebrow" fallback="Krav og dokumentation" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.processor.title" fallback="Databehandlerkrav" editorMode={editorMode} onEdit={onEdit} /></div>{processor.map((entry) => <div className="cms-item-shell" key={entry.id}><CollectionEditButton entry={entry} editorMode={editorMode} onEdit={onEdit} /><article className="knowledge-card"><ShieldCheck size={19} /><div><h3>{entry.title}</h3><p>{entry.body}</p></div></article></div>)}</section><section className="plain-section knowledge-section"><div className="plain-heading"><EditableText as="span" className="section-label dark" content={content} contentId="knowledge.links.eyebrow" fallback="Generelle og lokale genveje" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.links.title" fallback="Nyttige links" editorMode={editorMode} onEdit={onEdit} /></div><div className="knowledge-links">{links.map((entry) => entry.url && isSafeContentUrl(entry.url) ? <div className="cms-item-shell" key={entry.id}><CollectionEditButton entry={entry} editorMode={editorMode} onEdit={onEdit} /><a href={entry.url} target={entry.url.startsWith("https://") ? "_blank" : undefined} rel={entry.url.startsWith("https://") ? "noreferrer" : undefined}><Link2 size={18} /><span><strong>{entry.title}</strong><small>{entry.body}</small></span><ExternalLink size={16} /></a></div> : null)}</div></section></div>

      <section className="knowledge-contact"><div><EditableText as="span" className="section-label" content={content} contentId="knowledge.contact.eyebrow" fallback="Stadig i tvivl?" editorMode={editorMode} onEdit={onEdit} /><EditableText as="h2" content={content} contentId="knowledge.contact.title" fallback="Tag D-GITA med fra begyndelsen." editorMode={editorMode} onEdit={onEdit} /><EditableText as="p" content={content} contentId="knowledge.contact.body" fallback="Fortæl kort, hvad du har brug for hjælp til — fx at finde et system, skaffe kontrakt eller dokumentation eller komme i gang med din første ansøgning." editorMode={editorMode} onEdit={onEdit} /></div>{contactEmail(content) ? <a className="solid-button" href={`mailto:${contactEmail(content)}?subject=Ønske%20om%20D-GITA-formøde`}>Book et formøde <ArrowRight size={18} /></a> : null}</section>
    </div>
  </div>;
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <QuestionLabelContext.Provider value={title}><div className="question" role="group" aria-label={title}><div className="question-copy"><div className="question-title">{title}</div>{hint ? <p>{hint}</p> : null}</div>{labelQuestionControls(children, title)}</div></QuestionLabelContext.Provider>;
}

function CaseDetail({
  item,
  viewer,
  approval,
  fieldComments,
  onBack,
  onStartCorrection,
  onEditDraft,
  workspaceReady,
  onRetryWorkspace,
  onCaseChanged,
  onSaveApproval,
  onAddFieldComment,
  onToast,
}: {
  item: CaseRecord;
  viewer: WorkspaceViewer;
  approval: DgitaApproval;
  fieldComments: FieldComment[];
  onBack: () => void;
  onStartCorrection?: () => void;
  onEditDraft?: () => void;
  workspaceReady: boolean;
  onRetryWorkspace: () => void;
  onCaseChanged: () => Promise<void>;
  onSaveApproval: (approval: DgitaApproval) => Promise<boolean>;
  onAddFieldComment: (fieldId: string, fieldLabel: string, body: string) => Promise<boolean>;
  onToast: (message: string) => void;
}) {
  const [tab, setTab] = useState("overblik");
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [mailSending, setMailSending] = useState(false);
  const [approvalRequesting, setApprovalRequesting] = useState(false);
  useUnsavedChanges(Boolean(statusMessage.trim()), mailSending || approvalRequesting);
  const mailAttemptRef = useRef<{ message: string; key: string } | null>(null);
  const canProcess = capabilitiesFor(viewer.role).processApplications;
  const caseFeed = useCaseCommentsAndActivity(item.id);
  const caseDetail = useCaseDetail(item.id);
  const tabs = ["overblik", "ansøgning", "filer", "kommentarer", ...(canProcess ? ["dgita"] : []), "historik"];

  async function queueStatusMessage() {
    const message = statusMessage.trim();
    if (!message || mailSending) return;
    setMailSending(true);
    if (mailAttemptRef.current?.message !== message) mailAttemptRef.current = { message, key: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(item.id)}/mail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, idempotencyKey: mailAttemptRef.current.key }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Statusmailen kunne ikke sættes i kø.");
      setStatusMessage("");
      mailAttemptRef.current = null;
      setStatusComposerOpen(false);
      onToast("Statusmailen er sat i den sikre Outlook-kø.");
    } catch (reason) {
      onToast((reason as Error).message);
    } finally {
      setMailSending(false);
    }
  }

  async function requestLeaderApproval() {
    if (approvalRequesting) return;
    setApprovalRequesting(true);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(item.id)}/approval-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json() as { approverName?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Godkendelsen kunne ikke oprettes.");
      onToast(`Godkendelsen er sat i mailkø til ${payload.approverName ?? item.leader}.`);
      await Promise.all([caseFeed.refresh(), caseDetail.refetch(), onCaseChanged()]);
    } catch (reason) {
      onToast((reason as Error).message);
    } finally {
      setApprovalRequesting(false);
    }
  }

  return (
    <div className="detail-page page-width">
      <button className="back-text" type="button" onClick={onBack}><ArrowLeft size={18} /> {viewer.role === "user" ? "Mine ansøgninger" : "Alle sager"}</button>
      <section className="case-title-block">
        <div><span className="section-label dark">{item.id} · {item.municipality} Kommune</span><h1>{item.system}</h1><div className="case-title-meta"><PhaseTag phase={item.phase} /><span>Ændret {item.changed}</span></div></div>
        <div><ReceiptLinks caseNumber={item.id} submitted={Boolean(item.receiptAvailable)} approved={item.approval === "Godkendt"} closed={item.phase === "Afsluttet"} />{onEditDraft ? <button className="solid-button" type="button" onClick={onEditDraft}><PencilLine size={17} /> Fortsæt kladde</button> : null}{onStartCorrection ? <button className="solid-button" type="button" onClick={onStartCorrection}><PencilLine size={17} /> Ret og genindsend</button> : null}{canProcess ? <button className="solid-button" type="button" onClick={() => setStatusComposerOpen((current) => !current)}><Mail size={17} /> Send statusmail</button> : null}</div>
      </section>

      {statusComposerOpen ? <section className="status-mail-composer" aria-label="Sæt statusmail i kø"><div><span className="section-label dark">Outlook-status</span><h2>Skriv status til {item.applicant}</h2><p>Mailen valideres og lægges i den idempotente mailkø. Den afsendes først, når Microsoft Graph er konfigureret.</p></div><textarea className="clean-input" rows={4} value={statusMessage} onChange={(event) => setStatusMessage(event.target.value)} placeholder="Skriv en kort, konkret status på sagen" maxLength={8000} /><div><button className="line-button" type="button" onClick={() => setStatusComposerOpen(false)}>Annuller</button><button className="solid-button" type="button" disabled={!statusMessage.trim() || mailSending} onClick={() => void queueStatusMessage()}><Send size={16} /> {mailSending ? "Gemmer…" : "Sæt i mailkø"}</button></div></section> : null}

      <CaseJourney active={item.phase} />

      <nav className="detail-tabs" aria-label="Sagens indhold">
        {tabs.map((name) => <button className={tab === name ? "active" : ""} type="button" key={name} onClick={() => { if (confirmNavigation()) setTab(name); }}>{name === "overblik" ? <LayoutGrid size={17} /> : name === "ansøgning" ? <FileText size={17} /> : name === "filer" ? <Paperclip size={17} /> : name === "kommentarer" ? <MessageSquare size={17} /> : name === "dgita" ? <ShieldCheck size={17} /> : <History size={17} />}{name === "dgita" ? "D-GITA godkendelse" : name}<span>{name === "kommentarer" ? String(caseFeed.comments.length) : ""}</span></button>)}
      </nav>

      {tab === "overblik" ? caseDetail.detail ? <CaseOverview item={item} detail={caseDetail.detail} canRequestApproval={canProcess && Boolean(item.receiptAvailable) && !["closed", "approved", "rejected", "changes_requested"].includes(item.status ?? "")} approvalRequesting={approvalRequesting} onRequestApproval={() => void requestLeaderApproval()} /> : <CaseDetailDataState loading={caseDetail.isLoading} error={caseDetail.error?.message ?? null} onRetry={() => void caseDetail.refetch()} /> : null}
      {tab === "ansøgning" ? caseDetail.detail ? <ApplicationSnapshot detail={caseDetail.detail} canComment={canProcess} comments={fieldComments} onAddComment={onAddFieldComment} /> : <CaseDetailDataState loading={caseDetail.isLoading} error={caseDetail.error?.message ?? null} onRetry={() => void caseDetail.refetch()} /> : null}
      {tab === "filer" ? <FileList caseId={item.id} /> : null}
      {tab === "kommentarer" ? <Comments comments={caseFeed.comments} loading={caseFeed.isLoading} submitting={caseFeed.isSubmitting} error={caseFeed.error?.message ?? null} canInternal={canProcess} onSubmit={caseFeed.submitComment} /> : null}
      {tab === "dgita" && canProcess ? workspaceReady ? <DgitaApprovalPanel lockedReason={item.status === "closed" ? "Sagen er afsluttet. D-GITA-felterne er låst og vises til læsning." : item.status === "changes_requested" ? "Afvent anmoderens genindsendelse, før behandlingen fortsættes." : item.approval === "Afventer" ? "Afvent lederens beslutning, før D-GITA-felterne gemmes." : null} value={approval.updatedAt ? approval : { ...approval, phase: item.phase }} onSave={async (next) => { const saved = await onSaveApproval(next); if (saved) await Promise.all([caseDetail.refetch(), caseFeed.refresh()]); return saved; }} /> : <div className="data-state" role="status"><Info size={20} /><p>D-GITA-felterne skal hentes, før de kan redigeres.</p><button className="line-button" onClick={onRetryWorkspace}>Hent igen</button></div> : null}
      {tab === "historik" ? <AuditTrail events={caseFeed.events} loading={caseFeed.isLoading} error={caseFeed.error?.message ?? null} /> : null}
    </div>
  );
}

function CaseJourney({ active }: { active: Phase }) {
  const steps: Phase[] = ["Kladde", "Indsendt", "Under behandling", "Afsluttet"];
  const activeIndex = steps.indexOf(active);
  return <div className="case-journey">{steps.map((step, index) => <div className={cx(index < activeIndex && "done", index === activeIndex && "current")} key={step}><span>{index < activeIndex ? <Check size={15} /> : index + 1}</span><strong>{step}</strong>{index < steps.length - 1 ? <i /> : null}</div>)}</div>;
}

function CaseOverview({ item, detail, canRequestApproval, approvalRequesting, onRequestApproval }: { item: CaseRecord; detail: CaseDetail; canRequestApproval: boolean; approvalRequesting: boolean; onRequestApproval: () => void }) {
  const snapshot = detail.snapshot;
  const metadata = detail.case;
  const architectureReady = snapshot.hasArchitecture === "ja";
  const marketReady = snapshot.marketResearch === "ja";
  const implementation = [formatCaseDate(snapshot.startDate), formatCaseDate(snapshot.endDate)].filter(Boolean).join(" – ") || "Ikke oplyst";
  const consultant = metadata.consultantName?.trim() || null;
  const storedLeader = snapshot.approvingLeader?.trim() || item.leader?.trim() || "";
  const leader = storedLeader && !["Ikke valgt", "Ikke tildelt", "–"].includes(storedLeader) ? storedLeader : null;
  return <div className="case-content-grid"><div className="case-primary">
    {!architectureReady ? <section className="attention-block"><span><Info size={22} /></span><div><small>Opmærksomhedspunkt</small><h2>Arkitekturtegning mangler</h2><p>Ansøgeren har oplyst, at der endnu ikke er indhentet en arkitekturtegning. Brug den feltvise dialog til at bede om dokumentation; et afvist beslutningsgrundlag kan rettes og indsendes som en ny version.</p></div></section> : null}
    <section className="plain-section"><div className="plain-heading"><span className="section-label dark">Ansøgningen</span><h2>Nøgleoplysninger</h2></div><div className="facts-grid"><Fact label="Anskaffelsesform" value={snapshot.acquisitionMethod || snapshot.acquisitionType} /><Fact label="Ansvarlig organisation" value={snapshot.responsibleOrganization || snapshot.department} /><Fact label="Dataklassifikation" value={snapshot.personalData === "ja" ? snapshot.dataClassification : "Ingen personoplysninger"} /><Fact label="Antal brugere" value={snapshot.implementationUsers || "Ikke oplyst"} /><Fact label="Implementering" value={implementation} /><Fact label="Samlet finansiering" value={`${formatDanishAmount(getFinanceTotal(snapshot))} kr.`} /></div></section>
    <section className="plain-section"><div className="plain-heading"><span className="section-label dark">Faglig vurdering</span><h2>To centrale kontroller</h2></div><div className="assessment-list"><div className={cx("assessment", marketReady ? "ok" : "missing")}>{marketReady ? <CheckCircle2 size={21} /> : <XCircle size={21} />}<div><strong>{marketReady ? "Markedsafdækning gennemført" : "Markedsafdækning ikke gennemført"}</strong><p>Spørgsmål 26 er besvaret {marketReady ? "ja" : "nej"}.</p></div></div><div className={cx("assessment", architectureReady ? "ok" : "missing")}>{architectureReady ? <CheckCircle2 size={21} /> : <XCircle size={21} />}<div><strong>{architectureReady ? "Arkitekturbeskrivelse registreret" : "Arkitekturbeskrivelse mangler"}</strong><p>Spørgsmål 50 er besvaret {architectureReady ? "ja" : "nej"}.</p></div></div></div></section>
  </div><aside className="case-aside">
    <section><span className="section-label dark">Ansvar</span><h3>Personer på sagen</h3><Person name={metadata.applicantName} role="Anmoder" initials={personInitials(metadata.applicantName)} /><Person name={consultant || "Ikke tildelt"} role="D-GITA Konsulent" initials={consultant ? personInitials(consultant) : ""} unassigned={!consultant} /><Person name={leader || "Ikke valgt"} role="Godkendende leder" initials={leader ? personInitials(leader) : ""} unassigned={!leader} /></section>
    <section><span className="section-label dark">Godkendelse</span><h3>Ledergodkendelse</h3><ApprovalTag approval={item.approval} /><p>En beslutning bindes altid til den konkrete, indsendte version af ansøgningen.</p>{canRequestApproval ? <button className="line-button full" type="button" disabled={approvalRequesting} onClick={onRequestApproval}><Mail size={17} /> {approvalRequesting ? "Opretter…" : item.approval === "Afventer" ? "Send nyt godkendelseslink" : "Send til ledergodkendelse"}</button> : null}</section>
    <section><span className="section-label dark">Sagsdata</span><dl><div><dt>Version</dt><dd>{metadata.versionNumber || "Kladde"}</dd></div><div><dt>Oprettet</dt><dd>{formatFeedDate(metadata.createdAt)}</dd></div><div><dt>Ændret</dt><dd>{formatFeedDate(metadata.updatedAt)}</dd></div><div><dt>Kommune</dt><dd>{item.municipality}</dd></div><div><dt>ESDH</dt><dd>{snapshot.esdhContractUrl && isSafeContentUrl(snapshot.esdhContractUrl) ? <a href={snapshot.esdhContractUrl} target="_blank" rel="noreferrer">Åbn reference</a> : "Ikke angivet"}</dd></div></dl></section>
  </aside></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="fact"><small>{label}</small><strong>{value}</strong></div>;
}

function Person({ name, role, initials, unassigned = false }: { name: string; role: string; initials: string; unassigned?: boolean }) {
  return <div className={cx("case-person", unassigned && "unassigned")}><span aria-hidden="true">{unassigned ? <UserRound size={16} /> : initials}</span><div><strong>{name}</strong><small>{role}</small></div></div>;
}

function ApplicationSnapshot({
  detail,
  canComment,
  comments,
  onAddComment,
}: {
  detail: CaseDetail;
  canComment: boolean;
  comments: FieldComment[];
  onAddComment: (fieldId: string, fieldLabel: string, body: string) => Promise<boolean>;
}) {
  const [openSection, setOpenSection] = useState(0);
  const sections = applicationSnapshotSections(detail.snapshot);
  const selectedSection = sections[openSection] ?? sections[0];
  return <div className="snapshot-stack"><section className="snapshot plain-section"><div className="plain-heading"><span className="section-label dark">{detail.case.versionNumber > 0 ? "Indsendt version" : "Aktuel kladde"}</span><h2>Ansøgningens indhold</h2><span className="locked"><LockKeyhole size={15} /> {detail.case.versionNumber > 0 ? `Version ${detail.case.versionNumber} · låst` : "Kladde · kan redigeres"}</span></div>{sections.map((section, index) => <button className={openSection === index ? "open" : ""} type="button" key={section.title} aria-expanded={openSection === index} onClick={() => setOpenSection(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title}</strong><small>{section.rows.some((row) => !row.value || row.value === "Ikke oplyst") ? "Kontrollér svar" : "Udfyldt"}</small><ChevronRight size={18} /></button>)}{selectedSection ? <div className="snapshot-answer-grid" aria-live="polite"><h3>{selectedSection.title}</h3>{selectedSection.rows.map((row) => <Fact key={row.label} label={row.label} value={row.value || "Ikke oplyst"} />)}</div> : null}</section><FieldCommentsPanel snapshot={detail.snapshot} canComment={canComment} comments={comments} onAddComment={onAddComment} /></div>;
}

function FieldCommentsPanel({
  snapshot,
  canComment,
  comments,
  onAddComment,
}: {
  snapshot: ApplicationFormState;
  canComment: boolean;
  comments: FieldComment[];
  onAddComment: (fieldId: string, fieldLabel: string, body: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  useUnsavedChanges(Object.values(drafts).some((text) => Boolean(text.trim())), Boolean(savingField));
  const fieldValues = applicationFieldValues(snapshot);

  async function saveComment(fieldId: string, fieldLabel: string, body: string) {
    setSavingField(fieldId);
    try {
      if (await onAddComment(fieldId, fieldLabel, body)) {
        setDrafts((current) => ({ ...current, [fieldId]: "" }));
      }
    } finally {
      setSavingField(null);
    }
  }

  return <section className="plain-section field-comments-section"><div className="plain-heading"><span className="section-label dark">Feltvis dialog</span><h2>Kommentarer til ansøgningens felter</h2></div><p className="section-lead">D-GITA-konsulenten kan knytte en kommentar til et konkret svar. Delte kommentarer kan ses af anmoderen, mens interne noter ligger separat under D-GITA-godkendelsen.</p><div className="field-comment-list">{COMMENTABLE_APPLICATION_FIELDS.map((field) => {
    const fieldComments = comments.filter((comment) => comment.fieldId === field.id && comment.visibility === "applicant");
    const draft = drafts[field.id] ?? "";
    return <article className="field-comment-row" key={field.id}><div className="field-comment-answer"><small>{field.label}</small><strong>{fieldValues[field.id] || "Ikke oplyst"}</strong></div>{fieldComments.length ? <div className="saved-field-comments">{fieldComments.map((comment) => <div key={comment.id}><MessageSquare size={15} /><p>{comment.body}</p><small>{comment.authorName} · {new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.createdAt))}</small></div>)}</div> : <p className="no-field-comment">Ingen kommentarer til feltet.</p>}{canComment ? <div className="field-comment-composer"><textarea rows={2} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={`Kommentér feltet “${field.label}”`} /><button className="line-button" type="button" disabled={!draft.trim() || savingField !== null} onClick={() => void saveComment(field.id, field.label, draft.trim())}><Send size={15} /> {savingField === field.id ? "Gemmer…" : "Gem kommentar"}</button></div> : null}</article>;
  })}</div></section>;
}

function CaseDetailDataState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  return <section className="plain-section case-data-state">{loading ? <p className="section-lead">Henter de gemte formulardata…</p> : <><p className="field-error">{error || "Sagsdata kunne ikke hentes."}</p><button className="line-button" type="button" onClick={onRetry}>Prøv igen</button></>}</section>;
}

function applicationFieldValues(snapshot: ApplicationFormState): Record<string, string> {
  return {
    system: getDisplaySystemName(snapshot),
    purpose: snapshot.purpose,
    users: snapshot.implementationUsers,
    "personal-data": snapshot.personalData === "ja" ? `Ja · ${snapshot.dataClassification || "klassifikation ikke angivet"}` : "Nej",
    finance: `${formatDanishAmount(getFinanceTotal(snapshot))} kr.`,
  };
}

function applicationSnapshotSections(snapshot: ApplicationFormState) {
  const yesNo = (value: "ja" | "nej") => value === "ja" ? "Ja" : "Nej";
  const list = (values: string[]) => values.length ? values.join(", ") : "Ikke oplyst";
  const files = (kind: keyof ApplicationFormState["attachments"]) => snapshot.attachments[kind].map((file) => file.name).join(", ") || "Ingen bilag";
  return [
    { title: "Generelle oplysninger", rows: [{ label: "System", value: getDisplaySystemName(snapshot) }, { label: "Kontaktperson", value: snapshot.contactPerson }, { label: "Afdeling", value: snapshot.department }, { label: "Forretningsområde", value: snapshot.businessType }] },
    { title: "Systemoplysninger", rows: [{ label: "Beskrivelse", value: snapshot.systemDescription }, { label: "Leverandør", value: snapshot.supplier }, { label: "Rettighedshaver", value: snapshot.rightsHolder }, { label: "Dataejer", value: snapshot.dataOwner }, { label: "Systemejer", value: snapshot.systemOwner }] },
    { title: "System og anskaffelsesform", rows: [{ label: "Anskaffelsesform", value: snapshot.acquisitionMethod }, { label: "Anskaffelsestype", value: snapshot.acquisitionType === "tilkøb" ? "Tilkøb" : "Nyanskaffelse" }, { label: "Markedsafdækning", value: yesNo(snapshot.marketResearch) }, { label: "Undersøgte systemer", value: snapshot.marketResearchSystems }] },
    { title: "Værdi for kommunen", rows: [{ label: "Formål", value: snapshot.purpose }, { label: "Funktionalitet", value: snapshot.functionDescription }, { label: "KLE-emner", value: list(snapshot.kleTopics) }, { label: "Tværgående", value: yesNo(snapshot.crossCutting) }, { label: "Afdelinger", value: list(snapshot.crossDepartments) }] },
    { title: "Investering", rows: [{ label: "Budget", value: yesNo(snapshot.hasBudget) }, { label: "Budgetbeløb", value: `${snapshot.budgetAmount || "0"} kr.` }, { label: "Engangsomkostning", value: `${snapshot.oneTimeCost || "0"} kr.` }, { label: "Årlig omkostning", value: `${snapshot.yearlyCost || "0"} kr.` }, { label: "Forventede gevinster", value: snapshot.benefits }] },
    { title: "Risikovurdering", rows: [{ label: "Risikovurdering udført", value: yesNo(snapshot.hasRiskAssessment) }, { label: "Behov for hjælp", value: yesNo(snapshot.needsRiskHelp) }, { label: "Personoplysninger", value: yesNo(snapshot.personalData) }, { label: "Dataklassifikation", value: snapshot.dataClassification }, { label: "Bilag", value: files("risk-assessment") }] },
    { title: "Databehandleraftale", rows: [{ label: "Databehandleraftale", value: yesNo(snapshot.hasDpa) }, { label: "Kontrakt", value: yesNo(snapshot.hasContract) }, { label: "DPA-bilag", value: files("data-processing-agreement") }, { label: "Kontraktbilag", value: files("contract") }] },
    { title: "Implementering", rows: [{ label: "Start", value: formatCaseDate(snapshot.startDate) }, { label: "Slut", value: formatCaseDate(snapshot.endDate) }, { label: "Antal brugere", value: snapshot.implementationUsers }, { label: "Ressourcer", value: snapshot.implementationResources }, { label: "Milepæle", value: list(snapshot.milestones) }] },
    { title: "IT-krav", rows: [{ label: "Arkitekturtegning", value: yesNo(snapshot.hasArchitecture) }, { label: "Arkitekturbilag", value: files("architecture") }, { label: "Leverandørtjekliste", value: yesNo(snapshot.hasSupplierChecklist) }, { label: "Tjeklistebilag", value: files("supplier-checklist") }, { label: "Journaliseret i ESDH", value: yesNo(snapshot.checklistJournalized) }] },
    { title: "Øvrige", rows: [{ label: "Godkendende chef", value: snapshot.approvingLeader }, { label: "Bemærkninger", value: snapshot.remarks }, { label: "Bekræftelse af oplysninger", value: snapshot.consent ? "Ja" : "Nej" }] },
  ];
}

function formatCaseDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function personInitials(name: string | null) {
  if (!name) return "–";
  return name.trim().split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("da-DK") || "–";
}

function YesNoControl({ value, onChange }: { value: "" | "Ja" | "Nej"; onChange: (value: "Ja" | "Nej") => void }) {
  return <SegmentedChoice value={value} onChange={onChange} options={[{ value: "Ja", label: "Ja" }, { value: "Nej", label: "Nej" }]} />;
}

function DgitaApprovalPanel({ value, onSave, lockedReason }: { lockedReason: string | null; value: DgitaApproval; onSave: (value: DgitaApproval) => Promise<boolean> }) {
  const [draft, setDraft] = useState<DgitaApproval>(() => structuredClone(value));
  const [infrastructureError, setInfrastructureError] = useState("");
  const infrastructureRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState(() => JSON.stringify(value));
  const dirty = JSON.stringify(draft) !== baseline;
  const clearGuard = useUnsavedChanges(dirty, saving);
  if (!dirty && baseline !== JSON.stringify(value)) {
    setDraft(structuredClone(value));
    setBaseline(JSON.stringify(value));
  }

  async function save() {
    if (saving) return;
    if (draft.infrastructureChanges === "Ja" && !draft.infrastructureDescription?.trim()) {
      setInfrastructureError("Beskriv ændringerne i infrastrukturen.");
      infrastructureRef.current?.focus();
      return;
    }
    setInfrastructureError("");
    setSaving(true);
    try {
      if (await onSave(draft)) { setBaseline(JSON.stringify(draft)); clearGuard(); }
    } finally { setSaving(false); }
  }

  function update<K extends keyof DgitaApproval>(field: K, next: DgitaApproval[K]) {
    if (saving) return;
    if (field === "infrastructureDescription" || field === "infrastructureChanges") setInfrastructureError("");
    setDraft((current) => ({ ...current, [field]: next, ...(field === "infrastructureChanges" && next !== "Ja" ? { infrastructureDescription: "" } : {}) }));
  }

  return <div className="dgita-review-layout"><section className="plain-section dgita-review"><div className="plain-heading"><span className="section-label dark">Internt arbejdsområde</span><h2>D-GITA-godkendelse</h2><button className="solid-button" type="button" disabled={saving || Boolean(lockedReason)} onClick={() => void save()}><Save size={17} /> {saving ? "Gemmer…" : "Gem D-GITA-felter"}</button></div><div className="internal-notice"><LockKeyhole size={18} /><p>Dette område er kun tilgængeligt for D-GITA-konsulenter og administratorer. Interne kommentarer vises aldrig for anmoderen eller i PDF-kvitteringen.</p></div>{lockedReason ? <p className="review-lock-note" role="status"><LockKeyhole size={16} /> {lockedReason}</p> : null}<fieldset className="review-fields" disabled={saving || Boolean(lockedReason)}><Question title="D-GITA felt: Er ansøgningen godkendt?"><YesNoControl value={draft.approved} onChange={(next) => update("approved", next)} /></Question><Question title="D-GITA felt: Dato"><input className="clean-input" type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></Question><Question title="D-GITA felt: Relevant sikkerheds- og regelramme" hint="Valget angiver en ramme, ikke det konkrete behandlingsgrundlag. Afklar hjemmel og krav med kommunens ansvarlige."><label className="clean-select review-select"><select value={draft.legalBasis} onChange={(event) => update("legalBasis", event.target.value as DgitaApproval["legalBasis"])}><option value="">Vælg ramme</option>{D_GITA_FRAMEWORKS.map((basis) => <option key={basis}>{basis}</option>)}</select><ChevronDown size={16} /></label></Question><Question title="D-GITA felt: D-GITA ansvarlig" hint="Skriv her hvem der er ansvarlig for behandling af formularen."><input className="clean-input" value={draft.responsible} onChange={(event) => update("responsible", event.target.value)} placeholder="Søg efter person" /></Question><Question title="D-GITA felt: Er der flere D-GITA ansvarlige?"><YesNoControl value={draft.hasAdditionalResponsible} onChange={(next) => update("hasAdditionalResponsible", next)} /></Question>{draft.hasAdditionalResponsible === "Ja" ? <Question title="Hvis ja, angiv næste D-GITA ansvarlige"><input className="clean-input" value={draft.additionalResponsible} onChange={(event) => update("additionalResponsible", event.target.value)} placeholder="Angiv en eller flere personer" /></Question> : null}<Question title="D-GITA felt: IT-konsulent" hint="Vælg den person som bliver koblet på løsningen, som en teknisk ansvarlig fra IT-afdelingen."><input className="clean-input" value={draft.itConsultant} onChange={(event) => update("itConsultant", event.target.value)} placeholder="Søg efter person" /></Question><Question title="D-GITA felt: Medfører systemet ændringer i den eksisterende infrastruktur?"><YesNoControl value={draft.infrastructureChanges} onChange={(next) => update("infrastructureChanges", next)} /></Question>{draft.infrastructureChanges === "Ja" ? <Question title="Beskriv ændringerne i infrastrukturen" hint="Beskriv fx integrationer, netværk eller adgang. Oplysningerne er interne og indgår ikke i brugerens kvittering."><textarea ref={infrastructureRef} className="clean-input" rows={4} maxLength={8000} aria-required="true" aria-invalid={infrastructureError ? true : undefined} aria-describedby={infrastructureError ? "infrastructure-description-error" : undefined} value={draft.infrastructureDescription ?? ""} onChange={(event) => update("infrastructureDescription", event.target.value)} />{infrastructureError ? <p className="field-error" id="infrastructure-description-error" role="alert">{infrastructureError}</p> : null}</Question> : null}<Question title="D-GITA felt: Bemærkninger"><textarea className="clean-input" rows={4} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></Question><Question title="D-GITA felt: Interne kommentarer" hint="Kommentarer mellem D-GITA konsulenter. Feltet er skjult for anmoder og medtages ikke i den PDF, der genereres ved endelig godkendelse."><textarea className="clean-input internal-comment-input" rows={5} value={draft.internalComments} onChange={(event) => update("internalComments", event.target.value)} /></Question><Question title="D-GITA felt: Fase" hint="Beskriver hvilken fase ansøgningen er i."><label className="clean-select review-select"><select value={draft.phase} onChange={(event) => update("phase", event.target.value as DgitaApproval["phase"])}>{D_GITA_PHASES.map((phase) => <option key={phase}>{phase}</option>)}</select><ChevronDown size={16} /></label></Question></fieldset></section><aside className="review-source-note"><ShieldCheck size={23} /><span className="section-label dark">Kildematch</span><h3>Felter fra den nuværende løsning</h3><p>Godkendelsesfelterne og hjælpeteksterne er kortlagt fra Power Pages-formularen “D-GITA-Godkendelse”.</p><ul><li><Check size={14} /> Betinget ekstra ansvarlig</li><li><Check size={14} /> Ramme: NSIS, NIS2 eller GDPR</li><li><Check size={14} /> Intern kommentar adskilt fra ansøger</li><li><Check size={14} /> Fase og infrastrukturbeslutning</li></ul></aside></div>;
}

function FileList({ caseId }: { caseId: string }) {
  const [files, setFiles] = useState<Array<{ id: string; name: string; size: number; contentType: string; createdAt: string; downloadUrl: string }>>([]);
  const [fileState, setFileState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/cases/${encodeURIComponent(caseId)}/attachments`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const payload = (await response.json()) as { files?: typeof files; error?: string };
      if (!response.ok || !payload.files) throw new Error(payload.error || "Filerne kunne ikke hentes.");
      setFiles(payload.files);
      setFileState("ready");
    }).catch((reason: unknown) => {
      if ((reason as Error).name !== "AbortError") setFileState("error");
    });
    return () => controller.abort();
  }, [caseId]);

  return <section className="plain-section file-section"><div className="plain-heading"><span className="section-label dark">Dokumenter</span><h2>Filer på sagen</h2></div>{fileState === "loading" ? <p className="section-lead">Henter dokumenter…</p> : null}{fileState === "error" ? <p className="section-lead">Dokumenterne kunne ikke hentes. Prøv at åbne fanen igen.</p> : null}{fileState === "ready" && files.length === 0 ? <div className="empty-comments"><FolderOpen size={25} /><strong>Ingen filer på sagen</strong><p>Bilag, der uploades i ansøgningen, vises her med sikker download.</p></div> : null}{files.map((file) => <div className="document-row" key={file.id}><FileText size={20} /><div><strong>{file.name}</strong><small>{file.contentType.split("/").at(-1)?.toUpperCase()} · {formatFileSize(file.size)}</small></div><span>{new Intl.DateTimeFormat("da-DK", { dateStyle: "medium" }).format(new Date(file.createdAt))}</span><a href={file.downloadUrl} aria-label={`Download ${file.name}`}><Download size={18} /></a></div>)}</section>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("da-DK", { maximumFractionDigits: 1 })} MB`;
}

function Comments({
  comments,
  loading,
  submitting,
  error,
  canInternal,
  onSubmit,
}: {
  comments: CaseComment[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
  canInternal: boolean;
  onSubmit: (input: SubmitCaseCommentInput) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<CaseCommentVisibility>("applicant");
  useUnsavedChanges(Boolean(draft.trim()), submitting);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    if (await onSubmit({ body, visibility })) setDraft("");
  }

  return <section className="plain-section comments-section"><div className="plain-heading"><span className="section-label dark">Sagsdialog</span><h2>Kommentarer</h2></div>{loading ? <p className="section-lead">Henter sagsdialog…</p> : null}{error ? <p className="field-error">{error}</p> : null}{!loading && comments.length === 0 ? <div className="empty-comments"><MessageSquare size={25} /><strong>Der er ingen kommentarer at vise</strong><p>Start en dialog med anmoder eller D-GITA-konsulenten.</p></div> : <div className="case-comment-list">{comments.map((comment) => <article className={cx("case-comment", comment.visibility === "internal" && "internal")} key={comment.id}><span>{comment.authorName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><header><strong>{comment.authorName}</strong>{comment.visibility === "internal" ? <small><LockKeyhole size={12} /> Intern D-GITA-note</small> : <small>Delt på sagen</small>}</header><p>{comment.body}</p><time>{formatFeedDate(comment.createdAt)}</time></div></article>)}</div>}<div className="comment-composer"><textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Skriv en kommentar til sagen…" maxLength={8000} />{canInternal ? <label className="comment-visibility">Synlighed<select value={visibility} onChange={(event) => setVisibility(event.target.value as CaseCommentVisibility)}><option value="applicant">Delt med anmoder</option><option value="internal">Kun D-GITA</option></select></label> : null}<div><button className="solid-button" type="button" disabled={!draft.trim() || submitting} onClick={() => void submit()}><Send size={17} /> {submitting ? "Gemmer…" : "Opret kommentar"}</button></div></div></section>;
}

function AuditTrail({ events, loading, error }: { events: CaseActivityEvent[]; loading: boolean; error: string | null }) {
  return <section className="plain-section audit-section"><div className="plain-heading"><span className="section-label dark">Auditspor</span><h2>Historik på sagen</h2></div>{loading ? <p className="section-lead">Henter auditspor…</p> : null}{error ? <p className="field-error">{error}</p> : null}{!loading && !error && events.length === 0 ? <div className="empty-comments"><History size={25} /><strong>Ingen aktivitet registreret endnu</strong><p>Nye ændringer til sagen bliver gemt i det append-only auditspor.</p></div> : null}{events.map((event, index) => <div className="audit-row" key={event.id}><div><span>{index === 0 ? <History size={16} /> : <Check size={15} />}</span>{index < events.length - 1 ? <i /> : null}</div><time>{formatFeedDate(event.createdAt)}</time><strong>{event.summary}</strong><small>{event.actorName}</small></div>)}</section>;
}

function formatFeedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type AdminTab = ContentCategory | "formular" | "mail" | "integrationer";

function AdminView({
  content,
  viewer,
  onUpdateContent,
  onAddContent,
  onRemoveContent,
  onResetContent,
  onToast,
}: {
  content: ContentEntry[];
  viewer: WorkspaceViewer;
  onUpdateContent: (entry: ContentEntry) => Promise<boolean>;
  onAddContent: (entry: ContentEntry) => Promise<boolean>;
  onRemoveContent: (id: string) => Promise<boolean>;
  onResetContent: () => Promise<boolean>;
  onToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<AdminTab>("portal_text");
  const [resetting, setResetting] = useState(false);
  const contentTabs = Object.entries(CONTENT_CATEGORY_LABELS) as Array<[ContentCategory, string]>;
  const tabs: Array<[AdminTab, string]> = [
    ...contentTabs,
    ["formular", "Formularstruktur"],
    ["mail", "Mail & kvitteringer"],
    ["integrationer", "Integrationer"],
  ];
  const isContentTab = tab in CONTENT_CATEGORY_LABELS;

  return <div className="portal-page page-width"><PageIntro eyebrow="Administration" title="Indhold, formular og workflows" text="Redigér portaltekster, hjælpetekster, FAQ, links og databehandlerkrav. Administratorrollen har samtidig adgang til sager og D-GITA-behandling."><div className="admin-test-badge"><ShieldCheck size={17} /><span><strong>Admin · servervalideret</strong><small>{viewer.displayName}</small></span></div></PageIntro>
    <div className="admin-mode-note"><Info size={18} /><p>Ændringer gemmes i portalens database med administratoridentitet og auditspor. Testrollen erstattes senere af kommunal SSO.</p><button className="line-button" type="button" disabled={resetting} onClick={() => { if (!window.confirm("Gendan standardteksterne? Dine tilpassede tekster bliver erstattet.")) return; setResetting(true); void onResetContent().then((saved) => { if (saved) onToast("Standardindholdet er gendannet."); }).finally(() => setResetting(false)); }}><RotateCcw size={16} /> {resetting ? "Gendanner…" : "Gendan standard"}</button></div>
    <nav className="admin-nav" aria-label="Adminområder">{tabs.map(([id, label]) => <button className={tab === id ? "active" : ""} type="button" key={id} onClick={() => { if (confirmNavigation()) setTab(id); }}>{label}</button>)}</nav>
    {isContentTab ? <ContentManager category={tab as ContentCategory} content={content} onUpdate={onUpdateContent} onAdd={onAddContent} onRemove={onRemoveContent} onToast={onToast} /> : null}
    {tab === "integrationer" ? <div className="admin-layout"><section className="plain-section"><div className="plain-heading"><span className="section-label dark">Systemforbindelser</span><h2>Integrationer</h2></div><div className="integration-list"><Integration icon={Mail} title="Microsoft Outlook" detail="Microsoft Graph-mailkø med automatisk behandling" status="Kræver miljøopsætning" tone="waiting" /><Integration icon={LayoutGrid} title="KITOS" detail="Importeret systemkatalog og lokale systemer" status="Data indlæst" tone="healthy" /><Integration icon={FolderOpen} title="Dokumentlager" detail="Privat dokumentlager med adgangskontrol og kontrolsummer" status="Kontrolleres ved brug" tone="waiting" /><Integration icon={Inbox} title="ESDH" detail="Journalreferencer gemmes; automatisk arkivering er ikke tilsluttet" status="Ikke tilsluttet" tone="waiting" /></div></section><aside className="security-panel"><ShieldCheck size={27} /><span className="section-label">Fremtidig adgang</span><h2>Kommunal SSO og rolleclaims</h2><p>Testdropdownen erstattes af en servervalideret identitet fra Fælleskommunal Adgangsstyring eller kommunens Entra ID.</p><ul><li><Check size={15} /> Stabil brugeridentitet som ejer</li><li><Check size={15} /> Roller fra godkendte grupper</li><li><Check size={15} /> Tenant-adskilte data og auditspor</li></ul></aside></div> : null}
    {tab === "formular" ? <section className="plain-section admin-table-section"><div className="plain-heading"><span className="section-label dark">Publiceret motorversion 1</span><h2>Formularens sektioner</h2></div><p className="section-lead">Tekster redigeres under Hjælpetekster. Feltnøgler, validering og betingelser er kodeadministreret og låst til en formularversion, så eksisterende ansøgninger ikke ændres bagudrettet.</p>{applicationSteps.slice(0, -1).map((name, index) => <div className="admin-form-row" key={name}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{name}</strong><small>Betingede spørgsmål og servervalidering</small></div></div>)}</section> : null}
    {tab === "mail" ? <MailAdminPanel onToast={onToast} /> : null}
  </div>;
}

function ContentManager({
  category,
  content,
  onUpdate,
  onAdd,
  onRemove,
  onToast,
}: {
  category: ContentCategory;
  content: ContentEntry[];
  onUpdate: (entry: ContentEntry) => Promise<boolean>;
  onAdd: (entry: ContentEntry) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onToast: (message: string) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  useUnsavedChanges(Boolean(newTitle || newBody || newUrl), adding);
  const entries = content.filter((entry) => entry.category === category);
  const needsUrl = category === "link";

  async function addEntry() {
    if (!newTitle.trim() || !newBody.trim()) {
      onToast("Skriv både titel og tekst, før indholdet tilføjes.");
      return;
    }
    if (needsUrl && !isSafeContentUrl(newUrl)) {
      onToast("Linket skal være et sikkert https-, mailto- eller internt link.");
      return;
    }
    const entry: ContentEntry = {
      id: `custom.${category}.${crypto.randomUUID()}`,
      category,
      title: newTitle.trim(),
      body: newBody.trim(),
      url: needsUrl ? newUrl.trim() : undefined,
      location: CONTENT_CATEGORY_LABELS[category],
      published: true,
    };
    setAdding(true);
    try {
      if (await onAdd(entry)) {
        setNewTitle("");
        setNewBody("");
        setNewUrl("");
        onToast("Indholdet er tilføjet og publiceret i portalen.");
      }
    } finally {
      setAdding(false);
    }
  }

  return <section className="plain-section content-manager"><div className="plain-heading"><span className="section-label dark">Redigerbart indhold</span><h2>{CONTENT_CATEGORY_LABELS[category]}</h2><span className="content-count">{entries.length} elementer</span></div><p className="section-lead">Ret titel, tekst, publiceringsstatus{needsUrl ? " og linkadresse" : ""}. Tekniske feltnøgler og formularlogik kan ikke ændres her.</p><div className="content-entry-list">{entries.map((entry) => <ContentEditorCard key={`${entry.id}:${entry.updatedAt ?? "default"}`} entry={entry} onUpdate={onUpdate} onRemove={onRemove} onToast={onToast} />)}</div><div className="new-content-card"><div><span className="section-label dark">Nyt element</span><h3>Tilføj til {CONTENT_CATEGORY_LABELS[category].toLowerCase()}</h3></div><label>Titel<input className="clean-input" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Skriv en tydelig titel" /></label><label>Tekst<textarea className="clean-input" rows={4} value={newBody} onChange={(event) => setNewBody(event.target.value)} placeholder="Skriv indholdet" /></label>{needsUrl ? <label>Linkadresse<input className="clean-input" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://…, /intern-side eller mailto:…" /></label> : null}<button className="solid-button" type="button" disabled={adding} onClick={() => void addEntry()}><Plus size={17} /> {adding ? "Publicerer…" : "Tilføj og publicér"}</button></div></section>;
}

function ContentEditorCard({
  entry,
  onUpdate,
  onRemove,
  onToast,
}: {
  entry: ContentEntry;
  onUpdate: (entry: ContentEntry) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState(entry);
  const [urlError, setUrlError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(entry), saving || removing);

  async function save() {
    if (draft.url && !isSafeContentUrl(draft.url)) {
      setUrlError("Brug https://, mailto: eller en intern sti der starter med /.");
      return;
    }
    setUrlError("");
    setSaving(true);
    try {
      if (await onUpdate(draft)) onToast(`“${draft.title}” er gemt.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      if (!window.confirm("Slet denne tekst? Egne tekster kan ikke gendannes automatisk.")) return; if (await onRemove(entry.id)) onToast(`“${entry.title}” er fjernet. Egne tekster kan ikke gendannes automatisk.`);
    } finally {
      setRemoving(false);
    }
  }

  return <article className="content-editor-card"><div className="content-editor-meta"><span>{entry.location}</span><code>{entry.id}</code></div><label>Titel<input className="clean-input" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Tekst<textarea className="clean-input" rows={4} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} /></label>{entry.id === "link.contact" ? <p>Kontaktlinket bruger den fælles e-mailadresse. Ret den under Portaltekster → Kontakt · e-mail.</p> : entry.category === "link" ? <label>Linkadresse<input className={cx("clean-input", urlError && "input-error")} value={draft.url ?? ""} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} />{urlError ? <small className="field-error">{urlError}</small> : null}</label> : null}<div className="content-editor-actions"><label className="publish-toggle"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft((current) => ({ ...current, published: event.target.checked }))} /><span /> Publiceret</label><div><button className="quiet-danger" type="button" disabled={removing || saving} onClick={() => void remove()}><Trash2 size={16} /> {removing ? "Fjerner…" : "Fjern"}</button><button className="solid-button" type="button" disabled={saving || removing} onClick={() => void save()}><Save size={16} /> {saving ? "Gemmer…" : "Gem"}</button></div></div>{entry.updatedAt ? <small className="content-updated">Senest ændret {new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.updatedAt))}{entry.updatedBy ? ` af ${entry.updatedBy}` : ""}</small> : null}</article>;
}

function Integration({ icon: Icon, title, detail, status, tone }: { icon: LucideIcon; title: string; detail: string; status: string; tone: "healthy" | "waiting" }) {
  return <div className="integration-row"><span><Icon size={20} /></span><div><strong>{title}</strong><small>{detail}</small></div><em className={tone}><i />{status}</em></div>;
}
