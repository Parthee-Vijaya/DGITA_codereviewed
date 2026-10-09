export const WORKSPACE_ROLES = ["user", "consultant", "admin"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type WorkspaceArea =
  | "home"
  | "cases"
  | "consultant"
  | "application"
  | "detail"
  | "knowledge"
  | "admin";

export type WorkspaceViewer = {
  subject: string;
  tenantId: string;
  role: WorkspaceRole;
  displayName: string;
  email: string;
  initials: string;
  municipality: string;
};

/** Historical fixture references only. New databases use SYNTHETIC_VIEWERS. */
export const LEGACY_DEMO_VIEWERS: Record<WorkspaceRole, WorkspaceViewer> = {
  user: {
    subject: "demo-user-partheepan",
    tenantId: "kalundborg",
    role: "user",
    displayName: "Partheepan Vijayamohan",
    email: "partheepan.vijayamohan@kalundborg.dk",
    initials: "PV",
    municipality: "Kalundborg Kommune",
  },
  consultant: {
    subject: "demo-consultant-casper",
    tenantId: "kalundborg",
    role: "consultant",
    displayName: "Casper Kjeldsen Ravn",
    email: "ckra@kalundborg.dk",
    initials: "CK",
    municipality: "Kalundborg Kommune",
  },
  admin: {
    subject: "demo-admin-louise",
    tenantId: "kalundborg",
    role: "admin",
    displayName: "Louise Møller",
    email: "dgita-admin@kalundborg.dk",
    initials: "LM",
    municipality: "Kalundborg Kommune",
  },
};

export type Phase = "Kladde" | "Indsendt" | "Under behandling" | "Afsluttet";
export type Approval = "Ikke startet" | "Afventer" | "Godkendt" | "Afvist";

export type CaseRecord = {
  id: string;
  status?: string;
  tenantId: string;
  ownerSubject: string;
  ownerEmail: string;
  system: string;
  phase: Phase;
  created: string;
  changed: string;
  consultant: string;
  assignedConsultantUserId?: string | null;
  assignedConsultantSubject?: string | null;
  assignedConsultantProvider?: string | null;
  applicant: string;
  municipality: string;
  leader: string;
  approval: Approval;
  receiptAvailable?: boolean;
  awaitingLeader?: boolean;
  leaderReviewLocked?: boolean;
  openLeaderApprovalRequestId?: string | null;
};

const partheepanOwner = {
  tenantId: "kalundborg",
  ownerSubject: LEGACY_DEMO_VIEWERS.user.subject,
  ownerEmail: LEGACY_DEMO_VIEWERS.user.email,
  applicant: LEGACY_DEMO_VIEWERS.user.displayName,
  municipality: "Kalundborg",
};

const anitaOwner = {
  tenantId: "kalundborg",
  ownerSubject: "kalundborg-user-anita-lauridsen",
  ownerEmail: "anita.lauridsen@kalundborg.dk",
  applicant: "Anita Mark Vig Lauridsen",
  municipality: "Kalundborg",
};

export const LEGACY_DEMO_CASES: CaseRecord[] = [
  {
    ...partheepanOwner,
    id: "ITA-001290",
    system: "test",
    phase: "Kladde",
    created: "26-08-2026 13:26",
    changed: "26-08-2026 13:27",
    consultant: "Ikke tildelt",
    leader: "Ikke valgt",
    approval: "Ikke startet",
  },
  {
    ...partheepanOwner,
    id: "ITA-001284",
    system: "WSUS klient",
    phase: "Under behandling",
    created: "26-08-2026 09:42",
    changed: "26-08-2026 10:57",
    consultant: "Peter Bjerre Ahlgren",
    leader: "Peter Bjerre Ahlgren",
    approval: "Godkendt",
  },
  {
    ...partheepanOwner,
    id: "ITA-001286",
    system: "Anette",
    phase: "Kladde",
    created: "26-08-2026 09:46",
    changed: "26-08-2026 09:47",
    consultant: "Ikke tildelt",
    leader: "Ikke valgt",
    approval: "Ikke startet",
  },
  {
    ...partheepanOwner,
    id: "ITA-001285",
    system: "Anita",
    phase: "Indsendt",
    created: "26-08-2026 09:43",
    changed: "26-08-2026 09:45",
    consultant: "Ikke tildelt",
    leader: "Ikke valgt",
    approval: "Ikke startet",
  },
  {
    ...partheepanOwner,
    id: "ITA-001283",
    system: "Acta Pension",
    phase: "Kladde",
    created: "03-07-2026 10:36",
    changed: "03-07-2026 10:36",
    consultant: "Ikke tildelt",
    leader: "Ikke valgt",
    approval: "Ikke startet",
  },
  {
    ...anitaOwner,
    id: "ITA-001280",
    system: "Tester test",
    phase: "Indsendt",
    created: "30-06-2026 08:58",
    changed: "30-06-2026 09:04",
    consultant: "Ikke tildelt",
    leader: "Partheepan Vijayamohan",
    approval: "Afventer",
  },
  {
    ...anitaOwner,
    id: "ITA-001278",
    system: "PacerData",
    phase: "Indsendt",
    created: "30-06-2026 08:38",
    changed: "30-06-2026 08:53",
    consultant: "Ikke tildelt",
    leader: "Partheepan Vijayamohan",
    approval: "Afventer",
  },
  {
    ...anitaOwner,
    id: "ITA-001235",
    system: "MoEva",
    phase: "Afsluttet",
    created: "16-06-2026 08:15",
    changed: "16-06-2026 08:27",
    consultant: "Anita Mark Vig Lauridsen",
    leader: "Anita Mark Vig Lauridsen",
    approval: "Godkendt",
  },
  {
    ...partheepanOwner,
    id: "ITA-001213",
    system: "Abena Bevillingssystem",
    phase: "Under behandling",
    created: "01-06-2026 10:43",
    changed: "02-06-2026 08:34",
    consultant: "Peter Bjerre Ahlgren",
    leader: "Peter Bjerre Ahlgren",
    approval: "Godkendt",
  },
  {
    ...partheepanOwner,
    id: "ITA-001183",
    system: "PacerData",
    phase: "Afsluttet",
    created: "18-05-2026 09:58",
    changed: "19-05-2026 10:26",
    consultant: "Partheepan Vijayamohan",
    leader: "Partheepan Vijayamohan",
    approval: "Godkendt",
  },
];

/** Neutral defaults for newly created test databases; historical ids are not migrated. */
export const SYNTHETIC_VIEWERS: Record<WorkspaceRole, WorkspaceViewer> = {
  user: { subject: "test-user-01", tenantId: "kalundborg", role: "user", displayName: "Testbruger 01", email: "user-01@example.invalid", initials: "T1", municipality: "Testkommune" },
  consultant: { subject: "test-consultant-01", tenantId: "kalundborg", role: "consultant", displayName: "Testkonsulent 01", email: "consultant-01@example.invalid", initials: "K1", municipality: "Testkommune" },
  admin: { subject: "test-admin-01", tenantId: "kalundborg", role: "admin", displayName: "Testadministrator 01", email: "admin-01@example.invalid", initials: "A1", municipality: "Testkommune" },
};

export const SYNTHETIC_EXTRA_USERS = [
  { id: "test-user-02", email: "user-02@example.invalid", displayName: "Testbruger 02", role: "user" as const },
  { id: "test-approver-01", email: "approver-01@example.invalid", displayName: "Testgodkender 01", role: "consultant" as const },
];

export const SYNTHETIC_APPROVERS = [
  { id: "test-approver-01", name: "Testgodkender 01" },
  { id: "test-user-01", name: "Testbruger 01" },
  { id: "test-user-02", name: "Testbruger 02" },
];

export const SYNTHETIC_CASES: CaseRecord[] = LEGACY_DEMO_CASES.map((item, index) => {
  const owner = item.ownerSubject === LEGACY_DEMO_VIEWERS.user.subject
    ? { subject: SYNTHETIC_VIEWERS.user.subject, email: SYNTHETIC_VIEWERS.user.email, name: SYNTHETIC_VIEWERS.user.displayName }
    : { subject: "test-user-02", email: "user-02@example.invalid", name: "Testbruger 02" };
  return {
    ...item, ownerSubject: owner.subject, ownerEmail: owner.email, applicant: owner.name,
    system: `Testsystem ${String(index + 1).padStart(2, "0")}`, municipality: "Testkommune",
    consultant: item.consultant === "Ikke tildelt" ? "Ikke tildelt" : "Testkonsulent 01",
    leader: item.leader === "Ikke valgt" ? "Ikke valgt" : "Testgodkender 01",
  };
});

/** Compatibility names now select neutral defaults for newly created test data. */
export const DEMO_VIEWERS = SYNTHETIC_VIEWERS;
export const DEMO_CASES = SYNTHETIC_CASES;

export type WorkspaceCapabilities = {
  createApplications: boolean;
  processApplications: boolean;
  commentOnFields: boolean;
  manageContent: boolean;
};

export function capabilitiesFor(role: WorkspaceRole): WorkspaceCapabilities {
  return {
    createApplications: role === "user" || role === "admin",
    processApplications: role === "consultant" || role === "admin",
    commentOnFields: role === "consultant" || role === "admin",
    manageContent: role === "admin",
  };
}

const ROLE_AREAS: Record<WorkspaceRole, readonly WorkspaceArea[]> = {
  user: ["home", "cases", "application", "detail", "knowledge"],
  consultant: ["home", "consultant", "detail", "knowledge"],
  admin: ["home", "cases", "consultant", "application", "detail", "knowledge", "admin"],
};

export function canAccessArea(role: WorkspaceRole, area: WorkspaceArea) {
  return ROLE_AREAS[role].includes(area);
}

export function defaultAreaForRole(role: WorkspaceRole): WorkspaceArea {
  return role === "consultant" ? "consultant" : "home";
}

export function canViewCase(viewer: WorkspaceViewer, item: CaseRecord) {
  if (viewer.tenantId !== item.tenantId) return false;
  if (viewer.role === "user") return item.ownerSubject === viewer.subject;
  return true;
}

export function filterCasesForViewer(viewer: WorkspaceViewer, items: CaseRecord[]) {
  return items.filter((item) => canViewCase(viewer, item));
}

export function resolveAccessibleCase(
  viewer: WorkspaceViewer,
  id: string,
  items: CaseRecord[],
) {
  const item = items.find((candidate) => candidate.id === id);
  return item && canViewCase(viewer, item) ? item : null;
}

export function projectCaseForViewer(
  viewer: WorkspaceViewer,
  item: CaseRecord,
  approval?: DgitaApproval,
) {
  if (!canViewCase(viewer, item)) return null;
  if (viewer.role === "user" || !approval) return { ...item };
  return { ...item, dgitaApproval: normalizeDgitaApproval(approval) };
}

export const D_GITA_FRAMEWORKS = ["NSIS", "NIS2", "GDPR"] as const;
/** Compatibility alias: stored legalBasis values are framework labels, never proof of lawful processing. */
export const D_GITA_LEGAL_BASES = D_GITA_FRAMEWORKS;
export const D_GITA_PHASES = ["Kladde", "Indsendt", "Under behandling", "Afsluttet"] as const;

export type DgitaApproval = {
  revision?: number;
  approved: "" | "Ja" | "Nej";
  date: string;
  /** Historical wire/storage key. A framework selection, not an Article 6/9 legal basis. */
  legalBasis: "" | (typeof D_GITA_FRAMEWORKS)[number];
  responsible: string;
  responsibleUserId: string;
  hasAdditionalResponsible: "" | "Ja" | "Nej";
  additionalResponsible: string;
  additionalResponsibleUserIds: string[];
  itConsultant: string;
  itConsultantUserId: string;
  infrastructureChanges: "" | "Ja" | "Nej";
  infrastructureDescription: string;
  notes: string;
  internalComments: string;
  phase: (typeof D_GITA_PHASES)[number];
  updatedAt?: string;
  updatedBy?: string;
};

export const EMPTY_D_GITA_APPROVAL: DgitaApproval = {
  approved: "",
  date: "",
  legalBasis: "",
  responsible: "",
  responsibleUserId: "",
  hasAdditionalResponsible: "",
  additionalResponsible: "",
  additionalResponsibleUserIds: [],
  itConsultant: "",
  itConsultantUserId: "",
  infrastructureChanges: "",
  infrastructureDescription: "",
  notes: "",
  internalComments: "",
  phase: "Kladde",
};

export function normalizeDgitaApproval(value: DgitaApproval): DgitaApproval {
  return {
    ...value,
    responsibleUserId: typeof value.responsibleUserId === "string" ? value.responsibleUserId : "",
    itConsultantUserId: typeof value.itConsultantUserId === "string" ? value.itConsultantUserId : "",
    additionalResponsibleUserIds: value.hasAdditionalResponsible === "Ja" && Array.isArray(value.additionalResponsibleUserIds)
      ? [...new Set(value.additionalResponsibleUserIds)] : [],
    additionalResponsible:
      value.hasAdditionalResponsible === "Ja" ? value.additionalResponsible : "",
    infrastructureDescription:
      value.infrastructureChanges === "Ja" && typeof value.infrastructureDescription === "string"
        ? value.infrastructureDescription.trim()
        : "",
  };
}

export type FieldComment = {
  id: string;
  caseId: string;
  fieldId: string;
  fieldLabel: string;
  body: string;
  authorSubject: string;
  authorName: string;
  createdAt: string;
  visibility: "applicant" | "internal";
};

export const COMMENTABLE_APPLICATION_FIELDS = [
  { id: "system", label: "System eller løsning" },
  { id: "purpose", label: "Formål og ønsket effekt" },
  { id: "users", label: "Antal brugere" },
  { id: "personal-data", label: "Personoplysninger" },
  { id: "finance", label: "Samlet finansiering" },
] as const;

export type ContentCategory =
  | "portal_text"
  | "form_help"
  | "faq"
  | "link"
  | "data_processor";

export type ContentEntry = {
  id: string;
  category: ContentCategory;
  title: string;
  body: string;
  url?: string;
  location: string;
  published: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type ImageEntry = {
  id: string;
  src: string;
  alt: string;
  location: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const DEFAULT_IMAGES: ImageEntry[] = [
  {
    id: "home.hero.image",
    src: "/dgita-hero.png",
    alt: "Kommunale medarbejdere samarbejder om en IT-anskaffelse",
    location: "Forside · Hero",
  },
  {
    id: "home.help.image",
    src: "/dgita-help.png",
    alt: "En D-GITA-konsulent hjælper en kollega",
    location: "Forside · Hjælp",
  },
  {
    id: "knowledge.hero.image",
    src: "/dgita-help.png",
    alt: "En D-GITA-konsulent vejleder en kommunal kollega",
    location: "Vejledning & FAQ · Hero",
  },
];

export const CONTENT_CATEGORY_LABELS: Record<ContentCategory, string> = {
  portal_text: "Portaltekster",
  form_help: "Hjælpetekster",
  faq: "FAQ",
  link: "Links",
  data_processor: "Databehandlerkrav",
};

function portalText(
  id: string,
  title: string,
  body: string,
  location: string,
): ContentEntry {
  return { id, category: "portal_text", title, body, location, published: true };
}

export const DEFAULT_CONTENT: ContentEntry[] = [
  portalText("home.hero.eyebrow", "Hero · overlinje", "Kalundborg Kommune · D-GITA", "Forside · Hero"),
  {
    id: "home.hero.title",
    category: "portal_text",
    title: "Forsideoverskrift",
    body: "En god IT-anskaffelse starter med det rigtige behov.",
    location: "Forside · Hero",
    published: true,
  },
  {
    id: "home.hero.body",
    category: "portal_text",
    title: "Forsideintroduktion",
    body: "Opret en ansøgning, eller se dine igangværende og historiske ansøgninger. D-GITA hjælper dig med at beskrive præcis, hvilke forandringer din IT-anskaffelse skal føre med sig.",
    location: "Forside · Hero",
    published: true,
  },
  portalText("home.hero.note", "Hero · bemærkning", "Portalen bruges til køb under udbudsgrænsen.", "Forside · Hero"),
  portalText("home.intro.eyebrow", "Introduktion · overlinje", "Fra idé til sikker anskaffelse", "Forside · Introduktion"),
  portalText("home.intro.title", "Introduktion · overskrift", "Portalen samler hele forløbet.", "Forside · Introduktion"),
  portalText("home.intro.body", "Introduktion · tekst", "Du beskriver behovet én gang. Derefter hjælper D-GITA-konsulenten med marked, arkitektur, sikkerhed, økonomi, dokumentation og ledergodkendelse.", "Forside · Introduktion"),
  portalText("home.process.describe.title", "Proces 1 · titel", "Beskriv behovet", "Forside · Proces"),
  portalText("home.process.describe.body", "Proces 1 · tekst", "Svar på de relevante spørgsmål om systemet, arbejdsprocesserne og værdien for kommunen.", "Forside · Proces"),
  portalText("home.process.advise.title", "Proces 2 · titel", "Få faglig sparring", "Forside · Proces"),
  portalText("home.process.advise.body", "Proces 2 · tekst", "Din lokale D-GITA-konsulent gennemgår anskaffelsesform, risiko, data og IT-krav.", "Forside · Proces"),
  portalText("home.process.approve.title", "Proces 3 · titel", "Indhent godkendelse", "Forside · Proces"),
  portalText("home.process.approve.body", "Proces 3 · tekst", "Lederen modtager et samlet, versionslåst beslutningsgrundlag og godkender digitalt.", "Forside · Proces"),
  portalText("home.process.document.title", "Proces 4 · titel", "Gem dokumentationen", "Forside · Proces"),
  portalText("home.process.document.body", "Proces 4 · tekst", "Kvitteringer, bilag, kommentarer og statusændringer bliver samlet på sagen.", "Forside · Proces"),
  portalText("home.help.eyebrow", "Hjælp · overlinje", "Har du brug for hjælp?", "Forside · Hjælp"),
  portalText("home.help.title", "Hjælp · overskrift", "Få afklaring, før du udfylder ansøgningen.", "Forside · Hjælp"),
  {
    id: "home.help.body",
    category: "portal_text",
    title: "Kontakt og hjælp",
    body: "Er du i tvivl om din IT-anskaffelse, markedsafdækningen eller risikovurderingen, hjælper din lokale konsulent dig i gang.",
    location: "Forside · Hjælp",
    published: true,
  },
  portalText("contact.local.role", "Kontakt · rolle", "Din lokale D-GITA-konsulent", "Forside · Kontakt"),
  portalText("contact.local.name", "Kontakt · navn", "Testkonsulent 01", "Forside · Kontakt"),
  portalText("contact.local.email", "Kontakt · e-mail", "consultant-01@example.invalid", "Forside · Kontakt"),
  portalText("home.resources.eyebrow", "Ressourcer · overlinje", "Viden og vejledning", "Forside · Ressourcer"),
  portalText("home.resources.title", "Ressourcer · overskrift", "Genveje til et bedre forløb", "Forside · Ressourcer"),
  portalText("home.resources.about.title", "Genvej · Om D-GITA", "Om D-GITA", "Forside · Ressourcer"),
  portalText("home.resources.about.body", "Genvej · Om D-GITA tekst", "Læs om portalen og processen.", "Forside · Ressourcer"),
  portalText("home.resources.guide.title", "Genvej · Vejledning", "Vejledning / FAQ", "Forside · Ressourcer"),
  portalText("home.resources.guide.body", "Genvej · Vejledning tekst", "Begreber, funktioner og svar undervejs.", "Forside · Ressourcer"),
  portalText("home.resources.links.title", "Genvej · Links", "Nyttige links", "Forside · Ressourcer"),
  portalText("home.resources.links.body", "Genvej · Links tekst", "KITOS, databehandleraftaler og lokale skabeloner.", "Forside · Ressourcer"),
  portalText("home.resources.municipality.title", "Genvej · Kommune", "Info fra din kommune", "Forside · Ressourcer"),
  portalText("home.resources.municipality.body", "Genvej · Kommune tekst", "Særlige krav og information fra Kalundborg.", "Forside · Ressourcer"),
  portalText("home.resources.changelog.title", "Genvej · Nyheder", "Ny funktionalitet", "Forside · Ressourcer"),
  portalText("home.resources.changelog.body", "Genvej · Nyheder tekst", "Se de seneste ændringer i portalen.", "Forside · Ressourcer"),
  portalText("knowledge.hero.eyebrow", "Vejledning · hero-overlinje", "Viden · Kalundborg Kommune", "Vejledning & FAQ · Hero"),
  {
    id: "knowledge.hero.title",
    category: "portal_text",
    title: "Vejledningssidens overskrift",
    body: "Vejledning til Den Gode IT-Anskaffelse",
    location: "Vejledning & FAQ · Hero",
    published: true,
  },
  {
    id: "knowledge.hero.body",
    category: "portal_text",
    title: "Vejledningssidens introduktion",
    body: "En samlet gennemgang af IT-ansøgningsprocessen, dokumentationen og D-GITA-konsulenternes rolle — fra de første overvejelser til den efterfølgende kontraktstyring.",
    location: "Vejledning & FAQ · Hero",
    published: true,
  },
  portalText("knowledge.intro.eyebrow", "Introduktion · overlinje", "Information", "Vejledning & FAQ · Introduktion"),
  portalText("knowledge.intro.title", "Introduktion · overskrift", "Kom godt fra behov til færdig sag.", "Vejledning & FAQ · Introduktion"),
  {
    id: "knowledge.info",
    category: "portal_text",
    title: "Om vejledningen",
    body: "Vejledningen tager dig gennem alle faser af en IT-anskaffelse. D-GITA-konsulenterne er specialiserede rådgivere, som hjælper med at gøre anskaffelsen værdiskabende, gennemarbejdet og i overensstemmelse med kommunens krav.",
    location: "Vejledning & FAQ · Introduktion",
    published: true,
  },
  portalText("knowledge.tip.title", "Tip · overskrift", "Vigtigt tip", "Vejledning & FAQ · Tip"),
  {
    id: "knowledge.tip",
    category: "portal_text",
    title: "Vigtigt tip",
    body: "Involvér D-GITA-konsulenten tidligt. En god forberedelsesfase giver bedre sparring og mindsker risikoen for forsinkelser og manglende dokumentation.",
    location: "Vejledning & FAQ · Tip",
    published: true,
  },
  portalText("knowledge.process.eyebrow", "Proces · overlinje", "Det visuelle forløb", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.title", "Proces · overskrift", "Tre roller. Ét fælles beslutningsgrundlag.", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.applicant.role", "Proces 1 · rolle", "Anmoder", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.applicant.title", "Proces 1 · titel", "Opret ansøgningen", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.leader.role", "Proces 2 · rolle", "Leder", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.leader.title", "Proces 2 · titel", "Godkend grundlaget", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.consultant.role", "Proces 3 · rolle", "D-GITA", "Vejledning & FAQ · Proces"),
  portalText("knowledge.process.consultant.title", "Proces 3 · titel", "Vurdér og færdigbehandl", "Vejledning & FAQ · Proces"),
  portalText("knowledge.about.eyebrow", "Om portalen · overlinje", "Om portalen", "Vejledning & FAQ · Om portalen"),
  portalText("knowledge.about.title", "Om portalen · overskrift", "Den Gode IT-Anskaffelse", "Vejledning & FAQ · Om portalen"),
  portalText("knowledge.consultant.eyebrow", "Konsulent · overlinje", "Rådgivning", "Vejledning & FAQ · Konsulentrollen"),
  portalText("knowledge.consultant.title", "Konsulent · overskrift", "D-GITA-konsulenten", "Vejledning & FAQ · Konsulentrollen"),
  portalText("knowledge.library.eyebrow", "Bibliotek · overlinje", "Ordbog og svar", "Vejledning & FAQ · Bibliotek"),
  portalText("knowledge.library.title", "Bibliotek · overskrift", "Find det, du har brug for", "Vejledning & FAQ · Bibliotek"),
  portalText("knowledge.library.body", "Bibliotek · søgehjælp", "Søg på fx kontrakt, ESDH, risikovurdering, leder eller databehandleraftale.", "Vejledning & FAQ · Bibliotek"),
  portalText("knowledge.processor.eyebrow", "Databehandlerkrav · overlinje", "Krav og dokumentation", "Vejledning & FAQ · Databehandlerkrav"),
  portalText("knowledge.processor.title", "Databehandlerkrav · overskrift", "Databehandlerkrav", "Vejledning & FAQ · Databehandlerkrav"),
  portalText("knowledge.links.eyebrow", "Links · overlinje", "Generelle og lokale genveje", "Vejledning & FAQ · Links"),
  portalText("knowledge.links.title", "Links · overskrift", "Nyttige links", "Vejledning & FAQ · Links"),
  portalText("knowledge.contact.eyebrow", "Kontakt · overlinje", "Stadig i tvivl?", "Vejledning & FAQ · Kontakt"),
  portalText("knowledge.contact.title", "Kontakt · overskrift", "Tag D-GITA med fra begyndelsen.", "Vejledning & FAQ · Kontakt"),
  portalText("knowledge.contact.body", "Kontakt · tekst", "Fortæl kort, hvad du har brug for hjælp til — fx at finde et system, skaffe kontrakt eller dokumentation eller komme i gang med din første ansøgning.", "Vejledning & FAQ · Kontakt"),
  {
    id: "knowledge.about",
    category: "portal_text",
    title: "Hvad er D-GITA?",
    body: "D-GITA står for Den Gode IT-Anskaffelse. Portalen er udviklet i et samarbejde mellem sjællandske kommuner i Digitaliseringsforeningen Sjælland (DIGIT) og samler de oplysninger, der skal bruges til at vurdere en ny IT-løsning.",
    location: "Vejledning & FAQ · Om portalen",
    published: true,
  },
  {
    id: "knowledge.consultant",
    category: "portal_text",
    title: "Hvad hjælper en D-GITA-konsulent med?",
    body: "D-GITA-konsulenten rådgiver om værdi, regler, dokumentation og sammenhængen med kommunens IT-infrastruktur. Jo tidligere konsulenten involveres, desto lettere er det at afklare spørgsmål og få anskaffelsen sikkert videre.",
    location: "Vejledning & FAQ · Konsulentrollen",
    published: true,
  },
  {
    id: "knowledge.process.applicant",
    category: "portal_text",
    title: "Procestrin 1 · Anmoder",
    body: "Du beskriver behovet, søger i systemkataloget og samler kontrakt, risikovurdering og øvrig dokumentation.",
    location: "Vejledning & FAQ · Proces",
    published: true,
  },
  {
    id: "knowledge.process.leader",
    category: "portal_text",
    title: "Procestrin 2 · Leder",
    body: "Den valgte leder modtager den låste version og godkender eller afviser ansøgningen på det beskrevne grundlag.",
    location: "Vejledning & FAQ · Proces",
    published: true,
  },
  {
    id: "knowledge.process.consultant",
    category: "portal_text",
    title: "Procestrin 3 · D-GITA",
    body: "D-GITA-konsulenten vurderer ansøgningen, kommenterer konkrete felter og færdigbehandler sagen i dialog med dig.",
    location: "Vejledning & FAQ · Proces",
    published: true,
  },
  {
    id: "form.intro",
    category: "form_help",
    title: "Introduktion til anmodningsformularen",
    body: "Spørgsmålene følger D-GITA-processen og tilpasses dine svar undervejs. Gem løbende din kladde, og vedhæft den dokumentation der efterspørges.",
    location: "Anmodning · Top",
    published: true,
  },
  {
    id: "form.catalog",
    category: "form_help",
    title: "Systemopslag i KITOS",
    body: "Søg først efter systemet. Resultatet viser både katalogdata og om løsningen allerede bruges i Kalundborg Kommune.",
    location: "Anmodning · Systemoplysninger",
    published: true,
  },
  {
    id: "form.market-research",
    category: "form_help",
    title: "Markedsafdækning",
    body: "Beskriv hvilke løsninger der er undersøgt, og vedhæft den dokumentation der ligger til grund for vurderingen.",
    location: "Anmodning · Anskaffelsesform",
    published: true,
  },
  {
    id: "guide.process",
    category: "form_help",
    title: "D-GITA-forløbet i tre faser",
    body: "1. Du opretter IT-ansøgningen og samler den nødvendige dokumentation.\n2. Den valgte leder godkender eller afviser den indsendte version.\n3. D-GITA-konsulenten vurderer og færdigbehandler ansøgningen i dialog med dig.",
    location: "Vejledning · Proces",
    published: true,
  },
  {
    id: "guide.save-draft",
    category: "form_help",
    title: "Husk at gemme formularen løbende",
    body: "Tryk på “Gem kladde”, mens du udfylder ansøgningen og før du forlader formularen. Kladden gemmes på serveren og er knyttet til din bruger og kommune.",
    location: "Vejledning · Formular",
    published: true,
  },
  {
    id: "guide.esdh",
    category: "form_help",
    title: "Hvilke oplysninger skal bruges til ESDH-sager?",
    body: "Kontraktsag\nHer journaliseres kontrakt, leverandørkorrespondance, arkitekturtegning, tjekliste og eventuelle bilag.\nSagstype: 85.15.00 · Handlingsfacet: Ø54\n\nDatabehandlersag\nHer journaliseres databehandleraftale, risikovurdering, opfølgning, korrespondance og dokumentation.\nSagstype: 85.10.00 · Handlingsfacet: P27",
    location: "Vejledning · ESDH",
    published: true,
  },
  {
    id: "guide.procurement-threshold",
    category: "form_help",
    title: "Hvad er en udbudsgrænse?",
    body: "En udbudsgrænse er en økonomisk tærskel, som afgør hvilke udbudsregler en offentlig indkøber skal følge. D-GITA bruges til anskaffelser under den relevante grænse. Er du i tvivl om beløb, kontraktværdi eller procedure, skal kommunens indkøbsfunktion involveres tidligt.",
    location: "Vejledning · Indkøb",
    published: true,
  },
  {
    id: "guide.contract",
    category: "form_help",
    title: "Hvad er en kontrakt — og hvorfor er den nødvendig?",
    body: "Kontrakten er den skriftlige ramme for samarbejdet med leverandøren. Den beskriver ydelser, betaling, rettigheder, support, ansvar og øvrige forpligtelser, så parterne har samme forståelse af aftalen. Bed leverandøren om et kontraktudkast tidligt i processen.",
    location: "Vejledning · Kontrakt",
    published: true,
  },
  {
    id: "guide.dpa",
    category: "form_help",
    title: "Hvad er en databehandleraftale (DBA)?",
    body: "En databehandleraftale fastlægger, hvordan en ekstern databehandler må behandle personoplysninger på kommunens vegne. Aftalen beskriver blandt andet formål, sikkerhed, underdatabehandlere, sletning og kontrol og skal sikre, at behandlingen følger GDPR og kommunens krav.",
    location: "Vejledning · Persondata",
    published: true,
  },
  {
    id: "guide.supplier-checklist",
    category: "form_help",
    title: "Hvad er tjeklisten til leverandøren?",
    body: "Tjeklisten hjælper kommunen med at afklare, om systemet understøtter login, brugeradministration, integrationer og kommunens eksisterende IT-infrastruktur. Leverandøren skal blandt andet beskrive dataflow, tekniske afhængigheder og systemets arkitektur, så risici og integrationsbehov bliver synlige tidligt.",
    location: "Vejledning · Leverandør",
    published: true,
  },
  {
    id: "guide.risk",
    category: "form_help",
    title: "Hvad er en risikovurdering?",
    body: "En risikovurdering identificerer og vurderer mulige uønskede hændelser i et IT-system: Hvad kan gå galt, hvor sandsynligt er det, hvor alvorlig er konsekvensen, og hvilke foranstaltninger mindsker risikoen? Resultatet bruges til at afgøre, om systemet kan tages i brug, eller om der først skal indføres ekstra sikkerhedskrav.",
    location: "Vejledning · Risiko",
    published: true,
  },
  {
    id: "guide.ai-dpa",
    category: "form_help",
    title: "Hvad kan AI hjælpe med i en DBA?",
    body: "Den planlagte AI-funktion kan analysere en uploadet databehandleraftale og fremhæve manglende bestemmelser, uklare formuleringer og områder, der kræver særlig opmærksomhed. Resultatet er beslutningsstøtte og skal altid valideres af den ansvarlige medarbejder eller D-GITA-konsulent.",
    location: "Vejledning · AI og DBA",
    published: true,
  },
  {
    id: "faq.esdh",
    category: "faq",
    title: "Hvilke informationer skal jeg bruge for at oprette ESDH-sager korrekt?",
    body: "På kontraktsagen journaliseres kontrakt, leverandørkorrespondance, arkitekturtegning, tjekliste og bilag (sagstype 85.15.00, handlingsfacet Ø54). På databehandlersagen journaliseres DBA, risikovurdering, opfølgning og dokumentation (sagstype 85.10.00, handlingsfacet P27).",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.leader-not-visible",
    category: "faq",
    title: "Hvorfor er lederen ikke synlig under Mine ansøgninger?",
    body: "Lederadviseringen oprettes ved indsendelse. Levering afhænger af mailkøen. En gemt kladde udløser ikke lederadvisering.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.contract",
    category: "faq",
    title: "Hvad er en kontrakt, og hvorfor er den nødvendig?",
    body: "Kontrakten beskriver ydelser, pris, rettigheder, support, ansvar og forpligtelser. Den gør samarbejdet tydeligt og reducerer risikoen for misforståelser. Bed leverandøren om et udkast, så det kan indgå i vurderingen.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.dpa",
    category: "faq",
    title: "Hvad er en databehandleraftale (DBA), og hvorfor er den nødvendig?",
    body: "En DBA fastlægger reglerne for en ekstern leverandørs behandling af personoplysninger på kommunens vegne. Den dokumenterer ansvar, sikkerhed, sletning og kontrol og er en vigtig del af kommunens GDPR-efterlevelse.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.supplier-checklist",
    category: "faq",
    title: "Hvad er tjeklisten til leverandøren, og hvordan bruges den?",
    body: "Tjeklisten bruges til at afdække login, brugeradministration, integrationer, dataflow og arkitektur. Leverandørens svar gør det lettere at vurdere, om løsningen passer ind i kommunens IT-landskab, og hvilke tekniske krav der mangler.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.risk",
    category: "faq",
    title: "Hvad er en risikovurdering, og hvordan bruges den?",
    body: "Risikovurderingen beskriver hvad der kan gå galt, sandsynligheden, konsekvensen og de nødvendige sikkerhedsforanstaltninger. Den bruges til at beslutte, om systemet er klar til brug, eller om risici først skal reduceres.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.no-consultant",
    category: "faq",
    title: "Hvorfor er der ikke en D-GITA-konsulent på min ansøgning?",
    body: "Ansøgningen er endnu ikke visiteret og fordelt til den konsulent, der skal behandle den. Når sagen bliver taget fra arbejdskøen, fremgår den ansvarlige konsulent af overblikket.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.ai-dpa",
    category: "faq",
    title: "Hvad kan AI hjælpe med i en databehandleraftale?",
    body: "AI kan pege på manglende bestemmelser, uklare formuleringer og mulige opmærksomhedspunkter. Analysen er beslutningsstøtte og erstatter ikke den faglige og juridiske vurdering.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "faq.form-meeting",
    category: "faq",
    title: "Jeg har spørgsmål til formularen — hvordan kommer jeg videre?",
    body: "Bestil et formøde med D-GITA. Beskriv kort, om du har brug for hjælp til processen, til at finde et nyt system, til at skaffe kontrakt eller dokumentation eller til noget andet. Konsulenten modtager beskeden direkte.",
    location: "Vejledning / FAQ",
    published: true,
  },
  {
    id: "link.dpa-templates",
    category: "link",
    title: "Databehandleraftaler og skabeloner",
    body: "Kommunernes Databehandlersekretariats materiale om databehandleraftaler.",
    url: "https://kommunedbs.dk/databehandleraftale/",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.datatilsynet",
    category: "link",
    title: "Datatilsynet",
    body: "Vejledninger om personoplysninger, sikkerhed og GDPR.",
    url: "https://www.datatilsynet.dk/",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.kle",
    category: "link",
    title: "KLE Online",
    body: "KL Emnesystematik til klassifikation af kommunale opgaver og sager.",
    url: "https://www.kle-online.dk/soegning",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.kombit",
    category: "link",
    title: "KOMBIT Digitaliseringskatalog",
    body: "KOMBITs produkter og tilhørende vejledninger.",
    url: "https://digitaliseringskataloget.dk/",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.virk",
    category: "link",
    title: "Virk · CVR-registret",
    body: "Slå leverandørens virksomhedsoplysninger op.",
    url: "https://virk.dk/",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.kai",
    category: "link",
    title: "KAI · IT-anskaffelse",
    body: "Kalundborg Kommunes interne information om AI-indkøb, retningslinjer for IT-anskaffelser og databehandleraftaler.",
    url: "https://kalundborg.sharepoint.com/sites/ITsikkerhed/SitePages/IT-anskaffelser-og-databehandleraftaler.aspx",
    location: "Links for Kalundborg Kommune",
    published: true,
  },
  {
    id: "link.kitos",
    category: "link",
    title: "KITOS systemkatalog",
    body: "Se fælleskommunale systemoplysninger og relationer.",
    url: "https://www.kitos.dk/",
    location: "Generelle links",
    published: true,
  },
  {
    id: "link.contact",
    category: "link",
    title: "Kontakt D-GITA",
    body: "Testkontakt til D-GITA. Adressen kan ikke modtage mail.",
    url: "mailto:contact-01@example.invalid",
    location: "Links for Kalundborg Kommune",
    published: true,
  },
  {
    id: "processor.minimum",
    category: "data_processor",
    title: "Databehandleraftale",
    body: "Når leverandøren behandler personoplysninger på kommunens vegne, skal databehandleraftalen vedhæftes eller begrundes.",
    location: "Databehandlerkrav",
    published: true,
  },
  {
    id: "processor.security",
    category: "data_processor",
    title: "Tekniske og organisatoriske foranstaltninger",
    body: "Beskriv adgangsstyring, logning, backup, sletning og leverandørens sikkerhedsforanstaltninger.",
    location: "Databehandlerkrav",
    published: true,
  },
];

export function contentBody(entries: ContentEntry[], id: string, fallback: string) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return fallback;
  return entry.published ? entry.body : "";
}

/** Missing records retain built-in content; an explicit unpublished record does not. */
export function isContentVisible(entries: ContentEntry[], id: string) {
  const entry = entries.find((candidate) => candidate.id === id);
  return entry ? entry.published : true;
}

export function isSafeContentUrl(value: string) {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("/") && !trimmed.startsWith("//") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  );
}

export function isSafeImageUrl(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("/") && !trimmed.startsWith("//") ||
    trimmed.startsWith("https://") ||
    /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed)
  );
}

export function editImageEntry(
  viewer: WorkspaceViewer,
  entries: ImageEntry[],
  edited: ImageEntry,
  updatedAt = new Date().toISOString(),
) {
  if (viewer.role !== "admin") {
    throw new Error("Kun administratorer må redigere portalbilleder.");
  }
  if (!isSafeImageUrl(edited.src)) {
    throw new Error("Billedadressen er ikke tilladt.");
  }
  return entries.map((current) =>
    current.id === edited.id
      ? {
          ...current,
          src: edited.src.trim(),
          alt: edited.alt.trim(),
          updatedAt,
          updatedBy: viewer.displayName,
        }
      : current,
  );
}

export function editContentEntry(
  viewer: WorkspaceViewer,
  entries: ContentEntry[],
  edited: ContentEntry,
  updatedAt = new Date().toISOString(),
) {
  if (viewer.role !== "admin") {
    throw new Error("Kun administratorer må redigere portalindhold.");
  }
  if (edited.url && !isSafeContentUrl(edited.url)) {
    throw new Error("Linkadressen er ikke tilladt.");
  }
  return entries.map((current) =>
    current.id === edited.id
      ? {
          ...current,
          title: edited.title,
          body: edited.body,
          url: edited.url,
          published: edited.published,
          updatedAt,
          updatedBy: viewer.displayName,
        }
      : current,
  );
}

export function projectDgitaApprovalForViewer(
  viewer: WorkspaceViewer,
  approval: DgitaApproval,
) {
  if (viewer.role === "user") return null;
  return normalizeDgitaApproval(approval);
}
