import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";
import {
  CaseDialogError,
  normalizeCaseNumber,
  normalizeCommentInput,
  type CaseCommentApiVisibility,
  type CaseCommentVisibility,
} from "./dialog-validation";

export {
  CaseDialogError,
  MAX_CASE_COMMENT_LENGTH,
  normalizeCaseNumber,
  normalizeCommentInput,
  type CaseCommentApiVisibility,
  type CaseCommentCategory,
  type CaseCommentVisibility,
  type CreateCaseCommentInput,
} from "./dialog-validation";

type ApplicationAccessRow = {
  id: string;
  current_version_id: string | null;
  owner_user_id: string;
  assigned_consultant_user_id: string | null;
};

type CommentRow = {
  id: string;
  body: string;
  visibility: CaseCommentVisibility;
  created_at: string;
  author_name: string;
};

type ActivityRow = {
  id: string;
  event_type: string;
  payload_json: string;
  occurred_at: string;
  actor_name: string | null;
};

export async function listCaseComments(
  actor: ServerActor,
  caseNumberValue: string,
) {
  const caseNumber = normalizeCaseNumber(caseNumberValue);
  const DB = await portalDb();
  const application = await accessibleApplication(DB, actor, caseNumber);
  const visibilityClause = actor.role === "user" ? "AND c.visibility = 'shared'" : "";
  const result = await DB.prepare(`
    SELECT c.id, c.body, c.visibility, c.created_at,
           author.display_name AS author_name
    FROM portal_case_comments c
    INNER JOIN portal_users author
      ON author.id = c.author_user_id AND author.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.application_id = ?
      AND c.status <> 'deleted' ${visibilityClause}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 500
  `)
    .bind(actor.tenantId, application.id)
    .all<CommentRow>();

  return result.results.reverse().map(toComment);
}

export async function createCaseComment(
  actor: ServerActor,
  caseNumberValue: string,
  input: unknown,
) {
  const caseNumber = normalizeCaseNumber(caseNumberValue);
  const comment = normalizeCommentInput(actor, input);
  const DB = await portalDb();
  const application = await accessibleApplication(DB, actor, caseNumber);
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [
    DB.prepare(`
      INSERT INTO portal_case_comments
        (id, tenant_id, application_id, application_version_id, author_user_id,
         visibility, category, body, status, parent_comment_id, created_at,
         edited_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, NULL, NULL)
    `).bind(
      id,
      actor.tenantId,
      application.id,
      application.current_version_id,
      actor.userId,
      comment.visibility,
      comment.category,
      comment.body,
      now,
    ),
    DB.prepare(`
      INSERT INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      VALUES (?, ?, ?, ?, ?, 'case_comment.created', 'case_comment', ?, ?, NULL, ?)
    `).bind(
      auditId,
      actor.tenantId,
      application.id,
      actor.userId,
      actor.subject,
      id,
      JSON.stringify({
        caseNumber,
        category: comment.category,
        visibility: comment.visibility,
      }),
      now,
    ),
    DB.prepare(`
      UPDATE portal_applications
      SET updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ?
    `).bind(now, application.id, actor.tenantId),
  ];
  const notificationRecipient = comment.visibility === "shared"
    ? actor.userId === application.owner_user_id
      ? application.assigned_consultant_user_id
      : application.owner_user_id
    : null;
  if (notificationRecipient && notificationRecipient !== actor.userId) {
    statements.push(DB.prepare(`
      INSERT INTO portal_notifications
        (id, tenant_id, recipient_user_id, application_id, source_event_id,
         event_type, title, body, link_path, status, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, 'case_comment.created', ?, ?, ?, 'unread', ?, NULL)
      ON CONFLICT(recipient_user_id, source_event_id) DO NOTHING
    `).bind(
      crypto.randomUUID(),
      actor.tenantId,
      notificationRecipient,
      application.id,
      auditId,
      `Ny kommentar på ${caseNumber}`,
      comment.body.slice(0, 240),
      `/?case=${encodeURIComponent(caseNumber)}`,
      now,
    ));
  }
  if (comment.visibility === "shared" && actor.userId === application.owner_user_id && !application.assigned_consultant_user_id) {
    statements.push(DB.prepare(`
      INSERT INTO portal_notifications
        (id, tenant_id, recipient_user_id, application_id, source_event_id,
         event_type, title, body, link_path, status, created_at, read_at)
      SELECT ? || ':' || user.id, ?, user.id, ?, ?, 'case_comment.created', ?, ?, ?, 'unread', ?, NULL
      FROM portal_users user WHERE user.tenant_id = ? AND user.status = 'active' AND user.id <> ?
        AND EXISTS (SELECT 1 FROM portal_user_roles role WHERE role.user_id = user.id
          AND role.tenant_id = user.tenant_id AND role.role = 'dgita_consultant')
      ON CONFLICT(recipient_user_id, source_event_id) DO NOTHING
    `).bind(crypto.randomUUID(), actor.tenantId, application.id, auditId,
      `Ny kommentar på ${caseNumber}`, comment.body.slice(0, 240), `/?case=${encodeURIComponent(caseNumber)}`,
      now, actor.tenantId, actor.userId));
  }
  await DB.batch(statements);

  return {
    id,
    body: comment.body,
    visibility: toApiVisibility(comment.visibility),
    authorName: actor.displayName,
    createdAt: now,
  };
}

export async function listCaseActivity(
  actor: ServerActor,
  caseNumberValue: string,
) {
  const caseNumber = normalizeCaseNumber(caseNumberValue);
  const DB = await portalDb();
  const application = await accessibleApplication(DB, actor, caseNumber);
  const userVisibilityClause = actor.role === "user"
    ? `AND (
        e.event_type IN (
          'application.created', 'application.draft_saved',
          'application.correction_started', 'application.correction_saved',
          'application.submitted', 'application.resubmitted',
          'application.closed', 'application.information_requested', 'application.finally_rejected',
          'approval.requested', 'approval.approved', 'approval.rejected',
          'receipt.generated', 'mail.sent', 'field_comment.created'
        )
        OR (
          e.event_type = 'case_comment.created'
          AND json_valid(e.payload_json)
          AND json_extract(e.payload_json, '$.visibility') = 'shared'
        )
      )`
    : "";
  const result = await DB.prepare(`
    SELECT e.id, e.event_type, e.payload_json,
           e.occurred_at, actor.display_name AS actor_name
    FROM portal_audit_events e
    LEFT JOIN portal_users actor
      ON actor.id = e.actor_user_id AND actor.tenant_id = e.tenant_id
    WHERE e.tenant_id = ? AND e.application_id = ? ${userVisibilityClause}
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 500
  `)
    .bind(actor.tenantId, application.id)
    .all<ActivityRow>();

  return result.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    summary: activitySummary(row.event_type, row.payload_json),
    createdAt: row.occurred_at,
    actorName: row.actor_name ?? "System",
  }));
}

async function portalDb() {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  return DB;
}

async function accessibleApplication(
  DB: D1Database,
  actor: ServerActor,
  caseNumber: string,
) {
  const ownerClause = actor.role === "user" ? "AND owner_user_id = ?" : "";
  const statement = DB.prepare(`
    SELECT id, current_version_id, owner_user_id, assigned_consultant_user_id
    FROM portal_applications
    WHERE tenant_id = ? AND case_number = ? ${ownerClause}
    LIMIT 1
  `);
  const row = actor.role === "user"
    ? await statement
        .bind(actor.tenantId, caseNumber, actor.userId)
        .first<ApplicationAccessRow>()
    : await statement.bind(actor.tenantId, caseNumber).first<ApplicationAccessRow>();
  if (!row) {
    throw new CaseDialogError(
      404,
      "CASE_NOT_FOUND",
      "Sagen findes ikke, eller du har ikke adgang.",
    );
  }
  return row;
}

function toComment(row: CommentRow) {
  return {
    id: row.id,
    body: row.body,
    visibility: toApiVisibility(row.visibility),
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

function toApiVisibility(value: CaseCommentVisibility): CaseCommentApiVisibility {
  return value === "internal" ? "internal" : "applicant";
}

function activitySummary(eventType: string, payloadJson: string) {
  if (eventType === "application.created") return "Ansøgningen blev oprettet";
  if (eventType === "application.draft_saved") return "Kladden blev gemt";
  if (eventType === "application.correction_started") return "Rettelser blev åbnet";
  if (eventType === "application.correction_saved") return "Rettelserne blev gemt";
  if (eventType === "application.submitted") return "Ansøgningen blev indsendt";
  if (eventType === "application.resubmitted") return "Ansøgningen blev genindsendt";
  if (eventType === "application.information_requested") return "D-GITA bad om flere oplysninger";
  if (eventType === "application.finally_rejected") return "D-GITA gav endeligt afslag";
  if (eventType === "application.closed") return "D-GITA afsluttede sagen";
  if (eventType === "case_comment.created") {
    const payload = safeJsonObject(payloadJson);
    return payload.visibility === "internal"
      ? "Der blev tilføjet en intern note"
      : "Der blev tilføjet en kommentar";
  }
  if (eventType === "field_comment.created") return "Der blev kommenteret på et felt";
  if (eventType === "dgita.review.updated") return "D-GITA-behandlingen blev opdateret";
  if (eventType === "approval.requested") return "Sagen blev sendt til ledergodkendelse";
  if (eventType === "approval.approved") return "Lederen godkendte ansøgningen";
  if (eventType === "approval.rejected") return "Lederen afviste ansøgningen";
  if (eventType === "receipt.generated") return "En versionslåst PDF-kvittering blev genereret";
  if (eventType === "mail.queued") return "En mail blev sat i kø";
  if (eventType === "mail.sent") return "En mail blev sendt via Outlook";
  return "Sagen blev opdateret";
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
