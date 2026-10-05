import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { getPersistenceBindings } from "../../db/persistence";
import { assertMailStillAuthorized, MailAttachmentReferenceError, type ClaimedMail } from "../mail/claim-authorization";
import type { ServerActor } from "../auth/types";
import type { ApplicationFormState } from "../application/engine";
import { preparePortalData, resolveActorUserId } from "../workspace/server-repository";

export type ReceiptKind = "submission" | "approval" | "final";

type ReceiptApplicationRow = {
  id: string;
  case_number: string;
  system_name: string | null;
  status: string;
  owner_user_id: string;
  owner_name: string;
  owner_email: string;
  receipt_version_id: string | null;
  receipt_version_number: number | null;
  snapshot_json: string | null;
  submitted_at: string | null;
  approval_status: "approved" | "rejected" | null;
  approver_name: string | null;
  decision_comment: string | null;
  decided_at: string | null;
  dgita_status?: string | null;
  dgita_reviewer?: string | null;
  dgita_comment?: string | null;
  dgita_decided_at?: string | null;
};

type StoredReceiptRow = {
  id: string;
  storage_key: string;
  checksum_sha256: string | null;
  size_bytes: number | null;
};

export class ReceiptError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

export async function getOrCreateReceipt(
  actor: ServerActor,
  caseNumber: string,
  kind: ReceiptKind = "submission",
  expectedApplicationVersionId?: string,
) {
  const DB = await preparePortalData();
  const actorUserId = await resolveActorUserId(DB, actor);
  const application = await findReceiptApplication(DB, actor.tenantId, caseNumber, expectedApplicationVersionId, actor.role === "user" ? actorUserId : undefined);
  return materializeReceipt(DB, actor, actorUserId, application, kind);
}

/** Internal job capability: a current DB claim and its exact immutable reference are mandatory. */
export async function getOrCreateOutboxReceipt(claim: ClaimedMail, kind: ReceiptKind, versionId: string) {
  const DB = await preparePortalData();
  await assertMailStillAuthorized(DB, claim);
  let references: unknown;
  try { references = JSON.parse(claim.attachments_json); } catch { throw new MailAttachmentReferenceError(); }
  if (!Array.isArray(references) || !references.some((item) => item?.receiptKind === kind && item?.applicationVersionId === versionId)) {
    throw new MailAttachmentReferenceError();
  }
  const target = await DB.prepare("SELECT case_number FROM portal_applications WHERE id = ? AND tenant_id = ?")
    .bind(claim.application_id, claim.tenant_id).first<{ case_number: string }>();
  if (!target) throw new MailAttachmentReferenceError();
  const application = await findReceiptApplication(DB, claim.tenant_id, target.case_number, versionId);
  return materializeReceipt(DB, { tenantId: claim.tenant_id, subject: "service:mail-scheduler" }, null, application, kind, () => assertMailStillAuthorized(DB, claim));
}

async function materializeReceipt(
  DB: D1Database, actor: Pick<ServerActor, "tenantId" | "subject">, actorUserId: string | null,
  application: ReceiptApplicationRow, kind: ReceiptKind, assertAuthorized: () => Promise<void> = async () => {},
) {
  if (
    !application.receipt_version_id ||
    application.receipt_version_number === null ||
    !application.snapshot_json
  ) {
    throw new ReceiptError(409, "En kladde har endnu ingen versionslåst kvittering.");
  }
  if (kind === "approval" && !application.approval_status) {
    throw new ReceiptError(409, "Lederbeslutningen er endnu ikke registreret.");
  }
  if (kind === "final" && application.status !== "closed") {
    throw new ReceiptError(409, "Sagen er endnu ikke afsluttet.");
  }

  const { FILES } = await getPersistenceBindings();
  const stored = await DB.prepare(`
    SELECT id, storage_key, checksum_sha256, size_bytes
    FROM portal_receipts
    WHERE tenant_id = ? AND application_version_id = ? AND kind = ? AND status = 'ready'
    LIMIT 1
  `)
    .bind(actor.tenantId, application.receipt_version_id, kind)
    .first<StoredReceiptRow>();

  // Preserve historical files and audit events, but regenerate legacy final
  // receipts that predate inclusion of the actual D-GITA decision.
  if (stored && (kind !== "final" || stored.storage_key.includes("/receipts/v2/"))) {
    const object = await FILES.get(stored.storage_key);
    if (object && stored.checksum_sha256 && stored.size_bytes !== null) {
      const storedBytes = new Uint8Array(await object.arrayBuffer());
      const storedChecksum = await sha256(storedBytes);
      if (
        storedBytes.byteLength === stored.size_bytes &&
        storedChecksum === stored.checksum_sha256
      ) {
      return {
        bytes: storedBytes,
        filename: receiptFilename(application.case_number, kind),
        checksum: storedChecksum,
      };
      }
    }
  }

  const state = parseSnapshot(application.snapshot_json);
  const bytes = await renderReceipt(application, state, kind);
  const checksum = await sha256(bytes);
  const receiptId = stored?.id ?? `receipt:${actor.tenantId}:${application.receipt_version_id}:${kind}`;
  const pathname = `tenants/${actor.tenantId}/applications/${application.id}/receipts/v2/${application.receipt_version_id}/${kind}-${checksum}.pdf`;
  const now = new Date().toISOString();

  const storedReceipt = await FILES.put(pathname, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      tenantId: actor.tenantId,
      applicationId: application.id,
      applicationVersionId: application.receipt_version_id,
      kind,
      checksum,
    },
  });

  await assertAuthorized();
  await DB.batch([
      DB.prepare(`
        INSERT INTO portal_receipts
          (id, tenant_id, application_id, application_version_id, kind, status,
           storage_key, checksum_sha256, size_bytes, content_type,
           created_by_user_id, created_at, generated_at, failure_reason)
        VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, 'application/pdf', ?, ?, ?, NULL)
        ON CONFLICT(tenant_id, application_version_id, kind) DO UPDATE SET
          status = 'ready',
          storage_key = excluded.storage_key,
          checksum_sha256 = excluded.checksum_sha256,
          size_bytes = excluded.size_bytes,
          generated_at = excluded.generated_at,
          failure_reason = NULL
      `).bind(
        receiptId,
        actor.tenantId,
        application.id,
        application.receipt_version_id,
        kind,
        storedReceipt.key,
        checksum,
        bytes.byteLength,
        actorUserId,
        now,
        now,
      ),
      DB.prepare(`
        INSERT INTO portal_audit_events
          (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
           entity_type, entity_id, payload_json, ip_hash, occurred_at)
        VALUES (?, ?, ?, ?, ?, 'receipt.generated', 'receipt', ?, ?, NULL, ?)
      `).bind(
        crypto.randomUUID(),
        actor.tenantId,
        application.id,
        actorUserId,
        actor.subject,
        receiptId,
        JSON.stringify({ kind, versionNumber: application.receipt_version_number, checksum }),
        now,
      ),
  ]);

  return { bytes, filename: receiptFilename(application.case_number, kind), checksum };
}

async function findReceiptApplication(
  DB: D1Database,
  tenantId: string,
  caseNumber: string,
  expectedApplicationVersionId?: string,
  ownerUserId?: string,
) {
  const ownerClause = ownerUserId ? "AND a.owner_user_id = ?" : "";
  const statement = DB.prepare(`
    SELECT a.id, a.case_number, a.system_name, a.status, a.owner_user_id,
           owner.display_name AS owner_name, owner.email AS owner_email,
           version.id AS receipt_version_id,
           version.version_number AS receipt_version_number,
           version.snapshot_json, version.submitted_at,
           leader_approval.status AS approval_status,
           leader_approval.approver_name, leader_approval.decision_comment,
           leader_approval.decided_at,
           dgita.status AS dgita_status, reviewer.display_name AS dgita_reviewer,
           dgita.decision_comment AS dgita_comment, dgita.decided_at AS dgita_decided_at
    FROM portal_applications a
    INNER JOIN portal_users owner ON owner.id = a.owner_user_id
    LEFT JOIN portal_application_versions version
      ON version.id = COALESCE(?, a.current_version_id)
      AND version.application_id = a.id AND version.tenant_id = a.tenant_id
    LEFT JOIN portal_approval_requests leader_approval
      ON leader_approval.id = (
        SELECT request.id FROM portal_approval_requests request
        WHERE request.application_id = a.id
          AND request.application_version_id = version.id
          AND request.status IN ('approved', 'rejected')
        ORDER BY request.decided_at DESC, request.id DESC LIMIT 1
      )
    LEFT JOIN portal_dgita_approvals dgita
      ON dgita.application_id = a.id AND dgita.tenant_id = a.tenant_id AND dgita.application_version_id = version.id
    LEFT JOIN portal_users reviewer ON reviewer.id = dgita.reviewer_user_id AND reviewer.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.case_number = ? ${ownerClause}
    LIMIT 1
  `);
  const row = ownerUserId
    ? await statement.bind(expectedApplicationVersionId ?? null, tenantId, caseNumber, ownerUserId).first<ReceiptApplicationRow>()
    : await statement.bind(expectedApplicationVersionId ?? null, tenantId, caseNumber).first<ReceiptApplicationRow>();
  if (!row) throw new ReceiptError(404, "Sagen findes ikke, eller du har ikke adgang.");
  return row;
}

function parseSnapshot(value: string) {
  try {
    const parsed = JSON.parse(value) as ApplicationFormState;
    if (parsed.schemaVersion !== "dgita-v1") throw new Error("schema");
    return parsed;
  } catch {
    throw new ReceiptError(422, "Den indsendte version kan ikke læses.");
  }
}

export async function renderReceipt(
  application: ReceiptApplicationRow,
  state: ApplicationFormState,
  kind: ReceiptKind,
) {
  const document = await PDFDocument.create();
  document.setTitle(`D-GITA kvittering ${application.case_number}`);
  document.setAuthor("D-GITA · Kalundborg Kommune");
  document.setSubject("Versionslåst kvittering for IT-anskaffelse");
  document.setCreator("D-GITA-portalen");
  const documentDate = receiptDocumentDate(application, kind);
  document.setCreationDate(documentDate);
  document.setModificationDate(documentDate);

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const layout = new ReceiptLayout(document, regular, bold);

  layout.heading("D-GITA", "Kvittering for IT-anskaffelse");
  layout.meta("Sagsnummer", application.case_number);
  layout.meta("Kvitteringstype", receiptKindLabel(kind));
  layout.meta("Version", String(application.receipt_version_number));
  layout.meta("Indsendt", formatDate(application.submitted_at));
  layout.meta("Anmoder", `${application.owner_name} · ${application.owner_email}`);
  layout.meta("System", application.system_name || displaySystem(state));
  if (kind === "approval") {
    layout.meta("Leders beslutning", application.approval_status === "approved" ? "Godkendt" : application.approval_status === "rejected" ? "Afvist" : "Ikke registreret");
    layout.meta("Godkendende leder", application.approver_name || state.approvingLeader);
    layout.meta("Beslutningstidspunkt", formatDate(application.decided_at));
    if (application.decision_comment) layout.meta("Bemærkning", application.decision_comment);
  }
  if (kind === "final") {
    layout.section("Endelig D-GITA-beslutning");
    layout.meta("Beslutning", application.dgita_status === "approved" ? "Godkendt" : application.dgita_status === "rejected" ? "Afvist" : "Ikke registreret");
    layout.meta("Behandlet af", application.dgita_reviewer ?? "Ikke registreret");
    layout.meta("Beslutningstidspunkt", formatDate(application.dgita_decided_at ?? null));
    if (application.dgita_comment) layout.field("Bemærkninger", application.dgita_comment);
  }
  layout.rule();
  layout.paragraph(
    "Denne kvittering gengiver den versionslåste ansøgning. Kontrolsummen og bilagsmanifestet registreres i portalens auditspor.",
  );

  for (const section of receiptSections(state)) {
    layout.section(section.title);
    for (const [label, value] of section.rows) layout.field(label, value);
  }

  layout.finish(application.case_number);
  return document.save({ useObjectStreams: false });
}

class ReceiptLayout {
  private page!: PDFPage;
  private y = 0;
  private pageNumber = 0;
  private readonly width = 595.28;
  private readonly height = 841.89;
  private readonly margin = 54;

  constructor(
    private readonly document: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  heading(eyebrow: string, title: string) {
    this.page.drawRectangle({
      x: 0,
      y: this.height - 184,
      width: this.width,
      height: 184,
      color: rgb(0.737, 0.302, 0.188),
    });
    this.page.drawText(pdfSafe(eyebrow.toUpperCase()), {
      x: this.margin,
      y: this.height - 70,
      size: 11,
      font: this.bold,
      color: rgb(0.973, 0.929, 0.918),
    });
    this.page.drawText(pdfSafe(title), {
      x: this.margin,
      y: this.height - 118,
      size: 25,
      font: this.bold,
      color: rgb(1, 1, 1),
    });
    this.y = this.height - 220;
  }

  meta(label: string, value: string) {
    this.field(label, value);
  }

  rule() {
    this.y -= 4;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.7,
      color: rgb(0.847, 0.839, 0.808),
    });
    this.y -= 20;
  }

  paragraph(value: string) {
    const lines = wrapText(pdfSafe(value), this.regular, 10, this.width - 2 * this.margin);
    for (const line of lines) {
      this.ensure(14);
      this.page.drawText(line, {
        x: this.margin,
        y: this.y,
        size: 10,
        font: this.regular,
        color: rgb(0.275, 0.31, 0.369),
      });
      this.y -= 14;
    }
    this.y -= 10;
  }

  section(title: string) {
    this.ensure(44);
    this.y -= 8;
    this.page.drawText(pdfSafe(title), {
      x: this.margin,
      y: this.y,
      size: 14,
      font: this.bold,
      color: rgb(0.608, 0.251, 0.157),
    });
    this.y -= 25;
  }

  field(label: string, value: string) {
    const safeValue = pdfSafe(value || "Ikke oplyst");
    const lines = wrapText(safeValue, this.regular, 9.5, 322);
    const labels = wrapText(pdfSafe(label), this.bold, 8.5, 130);
    this.ensure(Math.min(54, Math.max(labels.length, lines.length) * 13 + 12));
    for (let index = 0; index < Math.max(labels.length, lines.length); index += 1) {
      this.ensure(13);
      if (labels[index]) this.page.drawText(labels[index], {
        x: this.margin, y: this.y, size: 8.5, font: this.bold,
        color: rgb(0.325, 0.369, 0.439),
      });
      if (lines[index]) this.page.drawText(lines[index], {
        x: this.margin + 145,
        y: this.y,
        size: 9.5,
        font: this.regular,
        color: rgb(0.145, 0.145, 0.145),
      });
      this.y -= 13;
    }
    this.y -= 12;
    this.page.drawLine({
      start: { x: this.margin, y: this.y + 6 },
      end: { x: this.width - this.margin, y: this.y + 6 },
      thickness: 0.35,
      color: rgb(0.91, 0.898, 0.863),
    });
  }

  finish(caseNumber: string) {
    const pages = this.document.getPages();
    pages.forEach((page, index) => {
      page.drawText(pdfSafe(`${caseNumber} · D-GITA · Side ${index + 1} af ${pages.length}`), {
        x: this.margin,
        y: 27,
        size: 8,
        font: this.regular,
        color: rgb(0.275, 0.31, 0.369),
      });
    });
  }

  private ensure(required: number) {
    if (this.y - required < 52) this.newPage();
  }

  private newPage() {
    this.page = this.document.addPage([this.width, this.height]);
    this.pageNumber += 1;
    this.y = this.height - this.margin;
    if (this.pageNumber > 1) {
      this.page.drawText("D-GITA · Versionslåst ansøgning", {
        x: this.margin,
        y: this.y,
        size: 9,
        font: this.bold,
        color: rgb(0.608, 0.251, 0.157),
      });
      this.y -= 30;
    }
  }
}

function receiptSections(state: ApplicationFormState) {
  return [
    {
      title: "System og ansvar",
      rows: [
        ["System", displaySystem(state)],
        ["Forretningsområde", state.businessType],
        ["Beskrivelse", state.systemDescription],
        ["Leverandør", state.supplier],
        ["Rettighedshaver", state.rightsHolder],
        ["Kontaktperson", state.contactPerson],
        ["Afdeling", state.department],
        ["Dataejer", state.dataOwner],
        ["Systemejer", state.systemOwner],
      ],
    },
    {
      title: "Anskaffelse og formål",
      rows: [
        ["Anskaffelsesmetode", state.acquisitionMethod],
        ["Anskaffelsestype", state.acquisitionType === "tilkøb" ? "Tilkøb" : "Nyanskaffelse"],
        ["Formål", state.purpose],
        ["Funktionalitet", state.functionDescription],
        ["Tværgående", yesNo(state.crossCutting)],
        ["Berørte enheder", state.crossDepartments.join(", ")],
        ["Gevinster", state.benefits],
      ],
    },
    {
      title: "Økonomi og implementering",
      rows: [
        ["Budget til rådighed", yesNo(state.hasBudget)],
        ["Budgetbeløb", money(state.budgetAmount)],
        ["Engangsomkostning", money(state.oneTimeCost)],
        ["Årlig omkostning", money(state.yearlyCost)],
        ["Øvrige omkostninger", money(state.otherCost)],
        ["Startdato", state.startDate],
        ["Slutdato", state.endDate],
        ["Antal brugere", state.implementationUsers],
        ["Ressourcer", state.implementationResources],
      ],
    },
    {
      title: "Data, risiko og dokumentation",
      rows: [
        ["Personoplysninger", yesNo(state.personalData)],
        ["Dataklassifikation", state.dataClassification],
        ["Risikovurdering", yesNo(state.hasRiskAssessment)],
        ["Databehandleraftale", yesNo(state.hasDpa)],
        ["Kontrakt", yesNo(state.hasContract)],
        ["Leverandørtjekliste", yesNo(state.hasSupplierChecklist)],
        ["Arkitekturbeskrivelse", yesNo(state.hasArchitecture)],
        ["Bilag", attachmentSummary(state)],
      ],
    },
    {
      title: "Godkendelse",
      rows: [
        ["Godkendende chef", state.approvingLeader],
        ["Bemærkninger", state.remarks],
        ["Samtykke registreret", state.consent ? "Ja" : "Nej"],
      ],
    },
  ] satisfies Array<{ title: string; rows: Array<[string, string]> }>;
}

function displaySystem(state: ApplicationFormState) {
  return state.selectedSystem?.name || state.manualSystemName || state.catalogQuery || "Ikke navngivet";
}

function attachmentSummary(state: ApplicationFormState) {
  const names = Object.values(state.attachments)
    .flat()
    .filter((attachment) => attachment.status === "uploaded")
    .map((attachment) => attachment.name);
  return names.length ? names.join(", ") : "Ingen bilag";
}

function yesNo(value: "ja" | "nej") {
  return value === "ja" ? "Ja" : "Nej";
}

function money(value: string) {
  return value.trim() ? `${value.trim()} kr.` : "Ikke oplyst";
}

function formatDate(value: string | null) {
  if (!value) return "Ikke registreret";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(date);
}

function receiptDocumentDate(application: ReceiptApplicationRow, kind: ReceiptKind) {
  const value = kind === "approval" && application.decided_at
    ? application.decided_at
    : application.submitted_at;
  const date = value ? new Date(value) : new Date("2000-01-01T00:00:00.000Z");
  return Number.isNaN(date.getTime())
    ? new Date("2000-01-01T00:00:00.000Z")
    : date;
}

function receiptKindLabel(kind: ReceiptKind) {
  return kind === "submission" ? "Indsendelseskvittering" : kind === "approval" ? "Godkendelseskvittering" : "Afsluttende kvittering";
}

function receiptFilename(caseNumber: string, kind: ReceiptKind) {
  const suffix = kind === "submission" ? "indsendelse" : kind === "approval" ? "godkendelse" : "afsluttet";
  return `${caseNumber}-${suffix}.pdf`;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return ["Ikke oplyst"];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines.flatMap((line) => splitLongLine(line, font, size, maxWidth));
}

function splitLongLine(value: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return [value];
  const parts: string[] = [];
  let current = "";
  for (const character of value) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(current);
      current = character;
    } else current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

function pdfSafe(value: string) {
  return value
    .normalize("NFC")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "?");
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
