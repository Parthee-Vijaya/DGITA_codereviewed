import {
  EMPTY_D_GITA_APPROVAL,
  isSafeContentUrl,
  isSafeImageUrl,
  normalizeDgitaApproval,
  type CaseRecord,
  type ContentEntry,
  type DgitaApproval,
  type InformationRequest,
  type FieldComment,
  type ImageEntry,
  type WorkspaceRole,
} from "./model";

import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import {
  lifecycleForDgitaApproval,
  normalizeDgitaApprovalInput,
  normalizeFieldCommentInput,
  normalizeWorkspaceCaseId,
  normalizeContentInput,
  normalizeImageInput,
  normalizeInformationRequestInput,
} from "./validation";
import { ensureVersionedSeed, PORTAL_DEFAULT_SEED } from "./seed-guard";
import { seedPortalDefaults, seedContentDefaults, seedImageDefaults } from "./pilot-seed";
export { seedPortalDefaults } from "./pilot-seed";
import { permitsDemoSeed, readRuntimeEnvironment } from "../runtime/environment";
import { canonicalizeResponsiblePeople, listResponsiblePeople } from "./responsible-directory";
import { committedLeaderApprovalSql, informationRequestEventId, publicInformationRequest } from "../cases/workflow-policy";
import { approvalMandateSql } from "../approval/mandate";

export type PortalActor = {
  userId?: string;
  subject: string;
  tenantId: string;
  role: WorkspaceRole;
  displayName: string;
  email: string;
  initials: string;
  municipality: string;
  provider: string;
};

type ApplicationRow = {
  id: string;
  case_number: string;
  tenant_id: string;
  owner_user_id: string;
  owner_subject: string;
  owner_email: string;
  applicant_name: string;
  municipality: string;
  system_name: string | null;
  status: string;
  phase: string;
  current_version_number: number;
  current_version_id: string | null;
  row_version: number;
  information_request_json: string | null;
  has_current_leader_approval: number;
  final_decision_status: "approved" | "rejected" | null;
  final_decision_comment: string | null;
  final_decided_at: string | null;
  consultant_name: string | null;
  assigned_consultant_user_id: string | null;
  consultant_subject: string | null;
  consultant_provider: string | null;
  leader_approval_status: string | null;
  leader_review_request_id: string | null;
  draft_state_json: string;
  created_at: string;
  updated_at: string;
};

type StoredContentRow = {
  key: string;
  content_type: string;
  status: string;
  value_json: string | null;
};

type StoredApprovalRow = {
  updated_at: string | null;
  row_version: number;
  phase: DgitaApproval["phase"];
  case_number: string;
  internal_fields_json: string;
  assigned_consultant_user_id: string | null;
  consultant_name: string | null;
};

type StoredFieldCommentRow = {
  id: string;
  case_number: string;
  field_id: string;
  visibility: "applicant" | "internal";
  body: string;
  author_subject: string;
  author_name: string;
  created_at: string;
};

type StoredImageAssetRow = {
  id: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
};

type AccessibleApplicationRow = {
  id: string;
  status: string;
  phase: string;
  row_version: number;
  current_version_id: string | null;
  owner_user_id: string;
  assigned_consultant_user_id: string | null;
  consultant_name: string | null;
  owner_email: string;
  owner_name: string;
  system_name: string | null;
};

export class PortalAccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "PortalAccessError";
  }
}

export async function preparePortalData() {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  if (permitsDemoSeed(await readRuntimeEnvironment())) {
    await ensureVersionedSeed(DB, PORTAL_DEFAULT_SEED, seedPortalDefaults);
  }
  return DB;
}

export async function resolveActorUserId(DB: D1Database, actor: PortalActor) {
  if (actor.userId) return actor.userId;
  const row = await DB.prepare(
    `SELECT id FROM portal_users
     WHERE tenant_id = ? AND external_subject = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(actor.tenantId, actor.subject)
    .first<{ id: string }>();
  if (!row) throw new PortalAccessError(401, "Brugeren findes ikke i portalen.");
  return row.id;
}

export async function listResponsiblePeopleForActor(actor: PortalActor) {
  if (actor.role !== "consultant" && actor.role !== "admin") {
    throw new PortalAccessError(403, "Kun D-GITA kan hente listen over ansvarlige.");
  }
  return listResponsiblePeople(await preparePortalData(), actor.tenantId);
}

export async function listCasesForActor(actor: PortalActor): Promise<CaseRecord[]> {
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const ownerClause = actor.role === "user" ? "AND a.owner_user_id = ?" : "";
  const query = `
    SELECT
      a.id, a.case_number, a.tenant_id, a.owner_user_id, a.system_name,
      a.status, a.phase, a.current_version_number, a.current_version_id, a.row_version, a.draft_state_json,
      (SELECT event.payload_json FROM portal_audit_events event
        WHERE event.tenant_id = a.tenant_id AND event.application_id = a.id
          AND event.id = 'information-request:' || a.id || ':' || a.current_version_id
          AND event.event_type = 'application.information_requested') AS information_request_json,
      a.created_at, a.updated_at,
      ${committedLeaderApprovalSql("a")} AS has_current_leader_approval,
      final_review.status AS final_decision_status, final_review.decision_comment AS final_decision_comment,
      final_review.decided_at AS final_decided_at,
      owner.external_subject AS owner_subject,
      owner.email AS owner_email,
      owner.display_name AS applicant_name,
      tenant.name AS municipality,
      consultant.id AS assigned_consultant_user_id,
      consultant.display_name AS consultant_name,
      consultant.external_subject AS consultant_subject,
      consultant.identity_provider AS consultant_provider,
      (SELECT open_request.id FROM portal_approval_requests open_request
        WHERE open_request.tenant_id = a.tenant_id AND open_request.application_id = a.id
          AND open_request.status IN ('pending', 'approving', 'rejecting')
        ORDER BY open_request.created_at DESC, open_request.id DESC LIMIT 1) AS leader_review_request_id,
      CASE WHEN leader_approval.status IN ('pending', 'approving', 'rejecting')
        AND (COALESCE(julianday(leader_approval.expires_at) > julianday('now'), 0) = 0
          OR NOT EXISTS (SELECT 1 FROM portal_approval_requests request
            WHERE request.id = leader_approval.id AND ${approvalMandateSql()})) THEN 'expired'
        ELSE leader_approval.status END AS leader_approval_status
    FROM portal_applications a
    INNER JOIN portal_users owner ON owner.id = a.owner_user_id
    INNER JOIN portal_tenants tenant ON tenant.id = a.tenant_id
    LEFT JOIN portal_users consultant ON consultant.id = a.assigned_consultant_user_id AND consultant.tenant_id = a.tenant_id
    LEFT JOIN portal_dgita_approvals final_review ON final_review.tenant_id = a.tenant_id
      AND final_review.application_id = a.id AND final_review.application_version_id = a.current_version_id
      AND a.status = 'closed' AND final_review.status IN ('approved', 'rejected') AND final_review.decided_at IS NOT NULL
    LEFT JOIN portal_approval_requests leader_approval
      ON leader_approval.id = (
        SELECT request.id FROM portal_approval_requests request
        WHERE request.tenant_id = a.tenant_id AND request.application_id = a.id
          AND request.application_version_id IS a.current_version_id
        ORDER BY request.created_at DESC, request.id DESC LIMIT 1
      )
    WHERE a.tenant_id = ? ${ownerClause}
    ORDER BY a.updated_at DESC, a.case_number DESC
  `;
  const statement = DB.prepare(query);
  const result = actor.role === "user"
    ? await statement.bind(actor.tenantId, userId).all<ApplicationRow>()
    : await statement.bind(actor.tenantId).all<ApplicationRow>();
  return result.results.map((row) => toCaseRecord(row, actor.role !== "user"));
}

export async function listWorkspaceContentForActor(
  DB: D1Database,
  actor: Pick<PortalActor, "tenantId" | "role">,
) {
  const contentStatement = actor.role === "admin"
    ? DB.prepare(
        `SELECT key, content_type, status, value_json FROM portal_content_entries
         WHERE tenant_id = ? AND content_type IN ('content', 'image')
         ORDER BY created_at, key`,
      ).bind(actor.tenantId)
    : DB.prepare(
        `SELECT key, content_type, status,
           CASE WHEN status = 'published' THEN value_json ELSE NULL END AS value_json
         FROM portal_content_entries
         WHERE tenant_id = ?
           AND (content_type = 'content' OR (content_type = 'image' AND status = 'published'))
         ORDER BY created_at, key`,
      ).bind(actor.tenantId);
  const contentRows = (await contentStatement.all<StoredContentRow>()).results;

  return {
    content: contentRows
      .filter((row) => row.content_type === "content")
      .flatMap((row): ContentEntry[] => {
        // A tombstone suppresses built-in fallback without exposing draft text or metadata.
        const hidden: ContentEntry = {
          id: row.key, category: "portal_text", title: "", body: "", location: "", published: false,
        };
        if (actor.role !== "admin" && row.status !== "published") return [hidden];
        const entries = row.value_json ? parseEntry<ContentEntry>(row.value_json) : [];
        if (actor.role !== "admin" && entries.some((entry) => !entry.published)) return [hidden];
        return entries.map((entry) => ({ ...entry, id: row.key, published: row.status === "published" }));
      }),
    images: contentRows
      .filter((row) => row.content_type === "image")
      .flatMap((row) => row.value_json ? parseEntry<ImageEntry>(row.value_json) : []),
  };
}

export async function getWorkspaceForActor(actor: PortalActor) {
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const content = await listWorkspaceContentForActor(DB, actor);

  const accessClause = actor.role === "user" ? "AND a.owner_user_id = ?" : "";
  const accessBindings = actor.role === "user"
    ? [actor.tenantId, userId]
    : [actor.tenantId];

  const commentResult = await DB.prepare(`
    SELECT c.id, a.case_number, c.field_id, c.visibility, c.body,
           author.external_subject AS author_subject,
           author.display_name AS author_name, c.created_at
    FROM portal_field_comments c
    INNER JOIN portal_applications a ON a.id = c.application_id AND a.tenant_id = c.tenant_id
    INNER JOIN portal_users author ON author.id = c.author_user_id
    WHERE c.tenant_id = ? AND c.status = 'active' ${accessClause}
      ${actor.role === "user" ? "AND c.visibility = 'applicant'" : ""}
    ORDER BY c.created_at
  `)
    .bind(...accessBindings)
    .all<StoredFieldCommentRow>();

  let approvals: Record<string, DgitaApproval> = {};
  if (actor.role !== "user") {
    const approvalRows = await DB.prepare(`
      SELECT a.case_number, a.row_version, a.phase, approval.internal_fields_json, approval.updated_at,
        consultant.id AS assigned_consultant_user_id, consultant.display_name AS consultant_name
      FROM portal_applications a
      LEFT JOIN portal_users consultant ON consultant.id = a.assigned_consultant_user_id
        AND consultant.tenant_id = a.tenant_id
      LEFT JOIN portal_dgita_approvals approval
        ON a.id = approval.application_id AND a.tenant_id = approval.tenant_id
        AND approval.application_version_id IS a.current_version_id
      WHERE a.tenant_id = ?
      ORDER BY approval.updated_at
    `)
      .bind(actor.tenantId)
      .all<StoredApprovalRow>();
    approvals = Object.fromEntries(
      approvalRows.results.flatMap((row) => {
        const parsed = parseJson<DgitaApproval>(row.internal_fields_json);
        return [[row.case_number, { ...normalizeDgitaApproval(parsed ?? {
          ...EMPTY_D_GITA_APPROVAL, phase: row.phase,
          responsibleUserId: row.assigned_consultant_user_id ?? "",
          responsible: row.consultant_name ?? "",
        }), updatedAt: row.updated_at ?? undefined, revision: row.row_version }]];
      }),
    );
  }

  return {
    ...content,
    approvals,
    fieldComments: commentResult.results.map((row) => ({
      id: row.id,
      caseId: row.case_number,
      fieldId: row.field_id,
      fieldLabel: fieldLabel(row.field_id),
      body: row.body,
      authorSubject: row.author_subject,
      authorName: row.author_name,
      createdAt: row.created_at,
      visibility: row.visibility,
    } satisfies FieldComment)),
  };
}

export async function upsertContentForActor(
  actor: PortalActor,
  entry: ContentEntry,
) {
  requireAdmin(actor);
  entry = normalizeContentInput(entry);
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.body !== "string" || !entry.id || !entry.title.trim() || !entry.body.trim()) {
    throw new PortalAccessError(422, "Titel og tekst skal udfyldes.");
  }
  if (entry.url && !isSafeContentUrl(entry.url)) {
    throw new PortalAccessError(422, "Linkadressen er ikke tilladt.");
  }
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const existing = await DB.prepare(
    `SELECT value_json FROM portal_content_entries
     WHERE tenant_id = ? AND key = ? AND content_type = 'content' LIMIT 1`,
  )
    .bind(actor.tenantId, entry.id)
    .first<{ value_json: string }>();
  const stable = existing ? parseJson<ContentEntry>(existing.value_json) : null;
  const now = new Date().toISOString();
  const saved: ContentEntry = {
    ...entry,
    category: stable?.category ?? entry.category,
    location: stable?.location ?? entry.location,
    updatedAt: now,
    updatedBy: actor.displayName,
  };
  await DB.prepare(`
    INSERT INTO portal_content_entries
      (id, tenant_id, key, locale, page_path, content_type, value_json, status,
       version, updated_by_user_id, created_at, updated_at, published_at)
    VALUES (?, ?, ?, 'da-DK', ?, 'content', ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, key, locale) DO UPDATE SET
      value_json = excluded.value_json,
      status = excluded.status,
      version = portal_content_entries.version + 1,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at,
      published_at = excluded.published_at
  `)
    .bind(
      `content:${actor.tenantId}:${saved.id}`,
      actor.tenantId,
      saved.id,
      saved.location,
      JSON.stringify(saved),
      saved.published ? "published" : "draft",
      userId,
      now,
      now,
      saved.published ? now : null,
    )
    .run();
  await recordAudit(DB, actor, "content.updated", "content_entry", saved.id, {
    published: saved.published,
  });
  return saved;
}

export async function deleteContentForActor(actor: PortalActor, key: string) {
  requireAdmin(actor);
  const DB = await preparePortalData();
  const result = await DB.prepare(
    `DELETE FROM portal_content_entries
     WHERE tenant_id = ? AND key = ? AND content_type = 'content'`,
  )
    .bind(actor.tenantId, key)
    .run();
  await recordAudit(DB, actor, "content.deleted", "content_entry", key, {});
  return Number(result.meta.changes ?? 0) > 0;
}

export async function upsertImageForActor(actor: PortalActor, entry: ImageEntry) {
  requireAdmin(actor);
  entry = normalizeImageInput(entry);
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.alt !== "string" || typeof entry.src !== "string" || !entry.id || !entry.alt.trim() || !isSafeImageUrl(entry.src)) {
    throw new PortalAccessError(422, "Billede eller alttekst er ugyldig.");
  }
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const contentEntryId = `image:${actor.tenantId}:${entry.id}`;
  const existing = await DB.prepare(
    `SELECT id, value_json FROM portal_content_entries
     WHERE tenant_id = ? AND key = ? AND content_type = 'image' LIMIT 1`,
  )
    .bind(actor.tenantId, entry.id)
    .first<{ id: string; value_json: string }>();
  const stable = existing ? parseJson<ImageEntry>(existing.value_json) : null;
  if (entry.src.startsWith("/api/content-images/") && entry.src !== stable?.src) {
    throw new PortalAccessError(422, "Et gemt portalbillede kan ikke genbruges fra en anden indholdspost.");
  }
  const now = new Date().toISOString();
  let saved: ImageEntry = {
    ...entry,
    location: stable?.location ?? entry.location,
    updatedAt: now,
    updatedBy: actor.displayName,
  };
  const currentAssets = (await DB.prepare(`
    SELECT id, storage_key, content_type, size_bytes, checksum_sha256
    FROM portal_images
    WHERE tenant_id = ? AND content_entry_id = ? AND status = 'ready'
  `).bind(actor.tenantId, contentEntryId).all<StoredImageAssetRow>()).results;
  const uploaded = decodeUploadedImage(entry.src);
  let newAsset: (StoredImageAssetRow & { originalName: string }) | null = null;
  if (uploaded) {
    const { FILES } = await getPersistenceBindings();
    const id = crypto.randomUUID();
    const checksum = await sha256Bytes(uploaded.bytes);
    const extension = uploaded.contentType === "image/jpeg" ? "jpg" : uploaded.contentType.split("/")[1];
    const originalName = `${entry.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}.${extension}`;
    const pathname = `tenants/${actor.tenantId}/content-images/${entry.id}/${id}.${extension}`;
    const stored = await FILES.put(pathname, uploaded.bytes, {
      httpMetadata: { contentType: uploaded.contentType },
      customMetadata: { tenantId: actor.tenantId, contentEntryId, checksum },
    });
    newAsset = {
      id,
      storage_key: stored.key,
      content_type: uploaded.contentType,
      size_bytes: uploaded.bytes.byteLength,
      checksum_sha256: checksum,
      originalName,
    };
    saved = { ...saved, src: `/api/content-images/${id}` };
  }

  const contentStatement = DB.prepare(`
    INSERT INTO portal_content_entries
      (id, tenant_id, key, locale, page_path, content_type, value_json, status,
       version, updated_by_user_id, created_at, updated_at, published_at)
    VALUES (?, ?, ?, 'da-DK', ?, 'image', ?, 'published', 1, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, key, locale) DO UPDATE SET
      value_json = excluded.value_json,
      version = portal_content_entries.version + 1,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at,
      published_at = excluded.published_at
  `)
    .bind(
      contentEntryId,
      actor.tenantId,
      saved.id,
      saved.location,
      JSON.stringify(saved),
      userId,
      now,
      now,
      now,
    );
  const replacingStoredAsset = Boolean(newAsset) || Boolean(stable?.src.startsWith("/api/content-images/") && saved.src !== stable.src);
  const statements = [contentStatement];
  if (replacingStoredAsset) {
    statements.push(DB.prepare(`
      UPDATE portal_images
      SET status = 'deleted', deleted_at = ?
      WHERE tenant_id = ? AND content_entry_id = ? AND status = 'ready'
    `).bind(now, actor.tenantId, contentEntryId));
  } else if (stable?.src === saved.src && saved.src.startsWith("/api/content-images/")) {
    statements.push(DB.prepare(`
      UPDATE portal_images SET alt_text = ?
      WHERE tenant_id = ? AND content_entry_id = ? AND status = 'ready'
    `).bind(saved.alt.trim(), actor.tenantId, contentEntryId));
  }
  if (newAsset) {
    statements.push(DB.prepare(`
      INSERT INTO portal_images
        (id, tenant_id, content_entry_id, storage_key, original_name, alt_text,
         content_type, size_bytes, checksum_sha256, status, uploaded_by_user_id,
         created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, NULL)
    `).bind(
      newAsset.id,
      actor.tenantId,
      contentEntryId,
      newAsset.storage_key,
      newAsset.originalName,
      saved.alt.trim(),
      newAsset.content_type,
      newAsset.size_bytes,
      newAsset.checksum_sha256,
      userId,
      now,
    ));
  }
  try {
    await DB.batch(statements);
  } catch (error) {
    if (newAsset) {
      try {
        const committed = await DB.prepare("SELECT id FROM portal_images WHERE id = ? AND tenant_id = ? AND storage_key = ?")
          .bind(newAsset.id, actor.tenantId, newAsset.storage_key).first<{ id: string }>();
        if (!committed) {
          const { FILES } = await getPersistenceBindings();
          await FILES.delete(newAsset.storage_key);
        }
      } catch { /* An ambiguous commit must not delete a referenced image. */ }
    }
    throw error;
  }
  if (replacingStoredAsset && currentAssets.length > 0) {
    const { FILES } = await getPersistenceBindings();
    await Promise.allSettled(currentAssets.map((asset) => FILES.delete(asset.storage_key)));
  }
  await recordAudit(DB, actor, "image.updated", "content_entry", saved.id, {
    storage: newAsset ? "r2" : saved.src.startsWith("https://") ? "external" : "static",
  });
  return saved;
}

export async function getPortalImageForActor(actor: PortalActor, imageId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(imageId)) {
    throw new PortalAccessError(404, "Billedet findes ikke.");
  }
  const DB = await preparePortalData();
  const row = await DB.prepare(`
    SELECT id, storage_key, content_type, size_bytes, checksum_sha256
    FROM portal_images
    WHERE id = ? AND tenant_id = ? AND status = 'ready' AND deleted_at IS NULL
    LIMIT 1
  `).bind(imageId, actor.tenantId).first<StoredImageAssetRow>();
  if (!row) throw new PortalAccessError(404, "Billedet findes ikke.");
  const { FILES } = await getPersistenceBindings();
  const object = await FILES.get(row.storage_key);
  if (!object) throw new PortalAccessError(404, "Billedfilen findes ikke.");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== row.size_bytes || await sha256Bytes(bytes) !== row.checksum_sha256) {
    throw new PortalAccessError(409, "Billedfilens integritet kunne ikke bekræftes.");
  }
  return { row, bytes };
}

/** Internal server-side history; deliberately absent from workspace, receipt and public activity payloads. */
export async function listApprovalHistoryForActor(actor: PortalActor, caseNumberValue: unknown) {
  if (actor.role !== "consultant" && actor.role !== "admin") {
    throw new PortalAccessError(403, "Kun D-GITA kan læse den interne vurderingshistorik.");
  }
  const caseNumber = normalizeWorkspaceCaseId(caseNumberValue);
  const DB = await preparePortalData();
  await resolveActorUserId(DB, actor);
  const application = await accessibleApplication(DB, actor, caseNumber);
  const result = await DB.prepare(`
    SELECT id, application_version_id, application_revision, reviewer_user_id,
           reviewer_subject, internal_fields_json, created_at
    FROM portal_dgita_review_history
    WHERE tenant_id = ? AND application_id = ?
    ORDER BY application_revision, id
  `).bind(actor.tenantId, application.id).all<{
    id: string;
    application_version_id: string | null;
    application_revision: number;
    reviewer_user_id: string;
    reviewer_subject: string;
    internal_fields_json: string;
    created_at: string;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    applicationVersionId: row.application_version_id,
    applicationRevision: row.application_revision,
    reviewerUserId: row.reviewer_user_id,
    reviewerSubject: row.reviewer_subject,
    approval: parseJson<DgitaApproval>(row.internal_fields_json),
    createdAt: row.created_at,
  }));
}

/** One immutable public request per submitted version; retries cannot duplicate it. */
export async function requestApplicationInformationForActor(actor: PortalActor, caseNumberValue: unknown, value: unknown) {
  if (actor.role !== "consultant" && actor.role !== "admin") throw new PortalAccessError(403, "Kun D-GITA kan bede om flere oplysninger.");
  const input = normalizeInformationRequestInput(value);
  const caseNumber = normalizeWorkspaceCaseId(caseNumberValue);
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const application = await accessibleApplication(DB, actor, caseNumber);
  if (application.current_version_id !== input.expectedVersionId) throw new PortalAccessError(409, "Ansøgningsversionen er ændret. Hent sagen igen.");
  const auditId = informationRequestEventId(application.id, input.expectedVersionId);
  const stored = await readInformationRequest(DB, actor.tenantId, auditId);
  if (stored) return repeatedInformationRequest(stored, input, application.status);
  if (application.row_version !== input.expectedRowVersion || !["submitted", "under_review", "approved", "rejected"].includes(application.status)) {
    throw new PortalAccessError(409, "Sagen er ændret eller kan ikke sendes til supplering. Hent sagen igen.");
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(new Date());
  if (input.dueDate < today) throw new PortalAccessError(422, "Fristen skal være i dag eller senere.");
  const now = new Date().toISOString();
  const request: InformationRequest = { reason: input.reason, dueDate: input.dueDate,
    requestedAt: now, applicationVersionId: input.expectedVersionId, revision: application.row_version + 1 };
  const results = await DB.batch([
    DB.prepare(`UPDATE portal_applications
      SET status = 'changes_requested', phase = 'Indsendt', updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND row_version = ? AND current_version_id = ?
        AND status IN ('submitted', 'under_review', 'approved', 'rejected')
        AND NOT EXISTS (SELECT 1 FROM portal_audit_events WHERE id = ?)
        AND EXISTS (SELECT 1 FROM portal_tenants tenant WHERE tenant.id = portal_applications.tenant_id AND tenant.status = 'active')
        AND EXISTS (SELECT 1 FROM portal_users actor JOIN portal_user_roles role
          ON role.user_id = actor.id AND role.tenant_id = actor.tenant_id
          WHERE actor.id = ? AND actor.tenant_id = portal_applications.tenant_id AND actor.status = 'active'
            AND role.role IN ('dgita_consultant', 'admin'))
        AND NOT EXISTS (SELECT 1 FROM portal_approval_requests leader
          WHERE leader.tenant_id = portal_applications.tenant_id AND leader.application_id = portal_applications.id
            AND leader.status IN ('pending', 'approving', 'rejecting'))`)
      .bind(now, application.id, actor.tenantId, input.expectedRowVersion, input.expectedVersionId, auditId, userId),
    DB.prepare(`INSERT INTO portal_audit_events
      (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
       entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'application.information_requested', 'application', ?, ?, NULL, ?
      WHERE changes() = 1`)
      .bind(auditId, actor.tenantId, application.id, userId, actor.subject, application.id, JSON.stringify(request), now),
    DB.prepare(`INSERT INTO portal_notifications
      (id, tenant_id, recipient_user_id, application_id, source_event_id, event_type,
       title, body, link_path, status, created_at, read_at)
      SELECT ?, ?, ?, ?, ?, 'application.information_requested', ?, ?, ?, 'unread', ?, NULL
      WHERE changes() = 1`)
      .bind(crypto.randomUUID(), actor.tenantId, application.owner_user_id, application.id, auditId,
        `Flere oplysninger til ${caseNumber}`, `Frist: ${input.dueDate}. ${input.reason}`,
        `/?case=${encodeURIComponent(caseNumber)}`, now),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    const repeated = await readInformationRequest(DB, actor.tenantId, auditId);
    const current = await accessibleApplication(DB, actor, caseNumber);
    if (repeated && current.current_version_id === input.expectedVersionId) return repeatedInformationRequest(repeated, input, current.status);
    throw new PortalAccessError(409, "Sagen eller lederbehandlingen er ændret. Tilbagekald en åben lederanmodning, og hent sagen igen før supplering.");
  }
  return request;
}

async function readInformationRequest(DB: D1Database, tenantId: string, id: string) {
  const row = await DB.prepare(`SELECT payload_json FROM portal_audit_events
    WHERE tenant_id = ? AND id = ? AND event_type = 'application.information_requested'`)
    .bind(tenantId, id).first<{ payload_json: string }>();
  return publicInformationRequest(row?.payload_json ?? null);
}

function repeatedInformationRequest(stored: InformationRequest, input: ReturnType<typeof normalizeInformationRequestInput>, status: string) {
  if (status !== "changes_requested" || stored.reason !== input.reason || stored.dueDate !== input.dueDate) {
    throw new PortalAccessError(409, "Denne version er allerede sendt til supplering med en anden anmodning, eller sagen har ændret sig.");
  }
  return stored;
}

export function saveApprovalForActor(
  actor: PortalActor, caseNumberValue: unknown, approvalValue: unknown,
  expectedUpdatedAt: unknown, expectedRowVersion: unknown,
) {
  return saveApprovalWithDecision(actor, caseNumberValue, approvalValue, expectedUpdatedAt, expectedRowVersion);
}

export async function rejectApplicationForActor(actor: PortalActor, caseNumberValue: unknown, value: unknown) {
  if (actor.role !== "consultant" && actor.role !== "admin") throw new PortalAccessError(403, "Kun D-GITA kan give endeligt afslag.");
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 8000) {
    throw new PortalAccessError(422, "Skriv den offentlige begrundelse for afslaget (3–8000 tegn).");
  }
  if (typeof input.expectedVersionId !== "string" || !input.expectedVersionId || input.expectedVersionId.length > 160 ||
      !Number.isSafeInteger(input.expectedRowVersion) || Number(input.expectedRowVersion) < 1 ||
      (input.expectedUpdatedAt !== null && typeof input.expectedUpdatedAt !== "string")) {
    throw new PortalAccessError(409, "Hent den aktuelle ansøgningsversion før afslaget.");
  }
  const DB = await preparePortalData();
  const caseNumber = normalizeWorkspaceCaseId(caseNumberValue);
  const application = await accessibleApplication(DB, actor, caseNumber);
  const prior = await DB.prepare(`SELECT internal_fields_json FROM portal_dgita_approvals
    WHERE tenant_id = ? AND application_id = ? AND application_version_id IS ?`)
    .bind(actor.tenantId, application.id, application.current_version_id).first<{ internal_fields_json: string }>();
  const repeated = await completedFinalRejection(DB, actor.tenantId, application.id, input);
  if (repeated) return repeated;
  const approval = normalizeDgitaApproval(parseJson<DgitaApproval>(prior?.internal_fields_json ?? "") ?? {
    ...EMPTY_D_GITA_APPROVAL, responsibleUserId: application.assigned_consultant_user_id ?? "",
    responsible: application.consultant_name ?? "",
  });
  try {
    return await saveApprovalWithDecision(actor, caseNumber, {
      ...approval, approved: "Nej", phase: "Afsluttet", notes: input.reason.trim(),
    }, input.expectedUpdatedAt, input.expectedRowVersion, true, input.expectedVersionId);
  } catch (error) {
    if (error instanceof PortalAccessError && error.status === 409) {
      const completed = await completedFinalRejection(DB, actor.tenantId, application.id, input);
      if (completed) return completed;
    }
    throw error;
  }
}

async function completedFinalRejection(DB: D1Database, tenantId: string, applicationId: string, input: Record<string, unknown>) {
  const row = await DB.prepare(`SELECT review.internal_fields_json
    FROM portal_applications application
    JOIN portal_audit_events event ON event.application_id = application.id AND event.tenant_id = application.tenant_id
    JOIN portal_dgita_approvals review ON review.application_id = application.id AND review.tenant_id = application.tenant_id
      AND review.application_version_id = application.current_version_id
    WHERE application.id = ? AND application.tenant_id = ? AND application.status = 'closed'
      AND application.current_version_id = ? AND application.row_version = ?
      AND event.id = ? AND event.event_type = 'application.finally_rejected'
      AND json_extract(event.payload_json, '$.expectedRowVersion') = ?
      AND json_extract(event.payload_json, '$.reason') = ?`)
    .bind(applicationId, tenantId, input.expectedVersionId, Number(input.expectedRowVersion) + 1,
      `final-rejection:${applicationId}:${input.expectedVersionId}`, input.expectedRowVersion, String(input.reason).trim())
    .first<{ internal_fields_json: string }>();
  return row ? parseJson<DgitaApproval>(row.internal_fields_json) : null;
}

async function saveApprovalWithDecision(
  actor: PortalActor,
  caseNumberValue: unknown,
  approvalValue: unknown,
  expectedUpdatedAt: unknown,
  expectedRowVersion: unknown,
  finalRejection = false,
  expectedVersionId?: unknown,
) {
  if (actor.role !== "consultant" && actor.role !== "admin") {
    throw new PortalAccessError(403, "Kun D-GITA kan redigere godkendelsesfelter.");
  }
  const caseNumber = normalizeWorkspaceCaseId(caseNumberValue);
  const approval = normalizeDgitaApprovalInput(approvalValue);
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const application = await accessibleApplication(DB, actor, caseNumber);
  if (expectedVersionId !== undefined && expectedVersionId !== application.current_version_id) {
    throw new PortalAccessError(409, "Ansøgningsversionen er ændret. Hent sagen igen.");
  }
  if (!Number.isInteger(expectedRowVersion) || expectedRowVersion !== application.row_version) {
    throw new PortalAccessError(409, "Sagen er ændret siden felterne blev hentet. Dine ændringer er bevaret her; åbn sagen igen før du gemmer.");
  }
  if (expectedUpdatedAt !== null && typeof expectedUpdatedAt !== "string") {
    throw new PortalAccessError(409, "Hent D-GITA-felterne igen, før du gemmer.");
  }
  const prior = await DB.prepare(`SELECT updated_at, internal_fields_json FROM portal_dgita_approvals
    WHERE tenant_id = ? AND application_id = ? AND application_version_id IS ?`)
    .bind(actor.tenantId, application.id, application.current_version_id).first<{ updated_at: string; internal_fields_json: string }>();
  if ((prior?.updated_at ?? null) !== expectedUpdatedAt) {
    throw new PortalAccessError(409, "D-GITA-felterne er ændret af en anden. Dine ændringer er bevaret her; åbn sagen igen for at se den nyeste version.");
  }
  const now = new Date().toISOString();
  const lifecycle = lifecycleForDgitaApproval(
    approval,
    {
      status: application.status,
      currentVersionId: application.current_version_id,
    },
    now,
    finalRejection,
  );
  const previous = parseJson<DgitaApproval>(prior?.internal_fields_json ?? "") ?? {
    ...EMPTY_D_GITA_APPROVAL,
    responsibleUserId: application.assigned_consultant_user_id ?? "",
    responsible: application.consultant_name ?? "",
  };
  const identities = await canonicalizeResponsiblePeople(DB, actor.tenantId, approval,
    previous ? normalizeDgitaApproval(previous) : null, application.assigned_consultant_user_id);
  const activeLeaderApproval = await DB.prepare(`
    SELECT id FROM portal_approval_requests
    WHERE tenant_id = ? AND application_id = ?
      AND status IN ('pending', 'approving', 'rejecting')
    LIMIT 1
  `).bind(actor.tenantId, application.id).first<{ id: string }>();
  if (activeLeaderApproval) {
    throw new PortalAccessError(
      409,
      "Afvent lederens beslutning, før D-GITA-felterne færdiggøres.",
    );
  }
  const leaderGate = approval.approved === "Ja" ? committedLeaderApprovalSql("portal_applications") : "1 = 1";
  if (approval.approved === "Ja" && !await DB.prepare(`SELECT id FROM portal_applications WHERE id = ? AND tenant_id = ? AND ${leaderGate}`)
    .bind(application.id, actor.tenantId).first()) {
    throw new PortalAccessError(409, "En positiv D-GITA-beslutning kræver lederens godkendelse af den aktuelle ansøgningsversion.");
  }
  const normalized: DgitaApproval = {
    ...identities.approval,
    revision: application.row_version + 1,
    updatedAt: now,
    updatedBy: actor.displayName,
  };
  const reviewStatus = normalized.approved === "Ja"
    ? "approved"
    : normalized.approved === "Nej"
      ? "rejected"
      : normalized.phase === "Under behandling"
        ? "in_review"
        : "pending";
  const auditId = crypto.randomUUID();
  const historyId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    DB.prepare(`
      UPDATE portal_applications
      SET status = ?, phase = ?, closed_at = ?, updated_at = ?,
          assigned_consultant_user_id = ?,
          row_version = row_version + 1
      WHERE id = ? AND tenant_id = ? AND row_version = ?
        AND current_version_id IS ?
        AND status <> 'closed'
        AND ${finalRejection ? "1 = 1" : "status <> 'changes_requested'"}
        AND ${leaderGate}
        AND EXISTS (SELECT 1 FROM portal_tenants tenant
          WHERE tenant.id = portal_applications.tenant_id AND tenant.status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS (
            SELECT 1 FROM portal_users person
            WHERE person.id = selected.value AND person.tenant_id = portal_applications.tenant_id
              AND person.status = 'active'
              AND EXISTS (SELECT 1 FROM portal_user_roles role WHERE role.user_id = person.id
                AND role.tenant_id = person.tenant_id AND role.role IN ('dgita_consultant', 'admin'))
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS (
            SELECT 1 FROM portal_users person
            WHERE person.id = selected.value AND person.tenant_id = portal_applications.tenant_id
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM portal_approval_requests request
          WHERE request.tenant_id = portal_applications.tenant_id
            AND request.application_id = portal_applications.id
            AND request.status IN ('pending', 'approving', 'rejecting')
        )
    `).bind(
      lifecycle.status,
      lifecycle.phase,
      lifecycle.closedAt,
      now,
      identities.assignmentId,
      application.id,
      actor.tenantId,
      application.row_version,
      application.current_version_id,
      JSON.stringify(identities.activeIds),
      JSON.stringify(identities.preservedIds),
    ),
    DB.prepare(`
      INSERT INTO portal_dgita_approvals
        (id, tenant_id, application_id, application_version_id, reviewer_user_id,
         status, internal_fields_json, decision_comment, created_at, updated_at,
         decided_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE changes() = 1 AND EXISTS (
        SELECT 1 FROM portal_applications application
        WHERE application.id = ? AND application.tenant_id = ?
          AND application.row_version = ? AND application.updated_at = ?
          AND application.status = ? AND application.phase = ?
      )
      ON CONFLICT(tenant_id, application_id) DO UPDATE SET
        application_version_id = excluded.application_version_id,
        reviewer_user_id = excluded.reviewer_user_id,
        status = excluded.status,
        internal_fields_json = excluded.internal_fields_json,
        decision_comment = excluded.decision_comment,
        updated_at = excluded.updated_at,
        decided_at = excluded.decided_at
    `).bind(
      `approval:${actor.tenantId}:${application.id}`,
      actor.tenantId,
      application.id,
      application.current_version_id,
      userId,
      reviewStatus,
      JSON.stringify(normalized),
      normalized.notes,
      now,
      now,
      normalized.approved ? now : null,
      application.id,
      actor.tenantId,
      application.row_version + 1,
      now,
      lifecycle.status,
      lifecycle.phase,
    ),
    DB.prepare(`
      INSERT INTO portal_dgita_review_history
        (id, tenant_id, application_id, application_version_id, application_revision,
         reviewer_user_id, reviewer_subject, internal_fields_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE changes() = 1
    `).bind(
      historyId,
      actor.tenantId,
      application.id,
      application.current_version_id,
      application.row_version + 1,
      userId,
      actor.subject,
      JSON.stringify(normalized),
      now,
    ),
    DB.prepare(`
      INSERT INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'dgita.review.updated', 'application', ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_dgita_review_history history
        WHERE history.id = ? AND history.tenant_id = ? AND history.application_id = ?
      )
    `).bind(
      auditId,
      actor.tenantId,
      application.id,
      userId,
      actor.subject,
      application.id,
      JSON.stringify({
        phase: normalized.phase,
        approved: normalized.approved,
        applicationVersionId: application.current_version_id,
      }),
      now,
      historyId,
      actor.tenantId,
      application.id,
    ),
  ];

  if (finalRejection) {
    statements.push(DB.prepare(`INSERT INTO portal_audit_events
      (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
       entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'application.finally_rejected', 'application', ?, ?, NULL, ?
      WHERE EXISTS (SELECT 1 FROM portal_dgita_review_history WHERE id = ?)`)
      .bind(`final-rejection:${application.id}:${application.current_version_id}`, actor.tenantId, application.id,
        userId, actor.subject, application.id,
        JSON.stringify({ reason: normalized.notes, applicationVersionId: application.current_version_id,
          expectedRowVersion: application.row_version, revision: application.row_version + 1 }), now, historyId));
  }

  if (lifecycle.status === "closed" && application.current_version_id) {
    const closedAuditId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const outboxId = crypto.randomUUID();
    const subject = `D-GITA-sag ${caseNumber} er afsluttet`;
    const decision = normalized.approved === "Ja" ? "godkendt" : "afvist";
    const text = `Hej ${application.owner_name}\n\nD-GITA har afsluttet ${caseNumber}. Sagen er ${decision}, og den afsluttende kvittering er vedlagt mailen.\n\nSystem: ${application.system_name || "Ikke navngivet"}`;
    const html = `<p>Hej ${escapeHtml(application.owner_name)}</p><p>D-GITA har afsluttet <strong>${escapeHtml(caseNumber)}</strong>. Sagen er <strong>${decision}</strong>, og den afsluttende kvittering er vedlagt mailen.</p><p>System: ${escapeHtml(application.system_name || "Ikke navngivet")}</p>`;
    statements.push(
      DB.prepare(`
        INSERT INTO portal_audit_events
          (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
           entity_type, entity_id, payload_json, ip_hash, occurred_at)
        SELECT ?, ?, ?, ?, ?, 'application.closed', 'application', ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM portal_dgita_review_history WHERE id = ?)
          AND EXISTS (
          SELECT 1 FROM portal_applications application
          WHERE application.id = ? AND application.tenant_id = ?
            AND application.status = 'closed' AND application.closed_at = ?
        )
      `).bind(
        closedAuditId,
        actor.tenantId,
        application.id,
        userId,
        actor.subject,
        application.id,
        JSON.stringify({
          approved: normalized.approved,
          applicationVersionId: application.current_version_id,
        }),
        now,
        historyId,
        application.id,
        actor.tenantId,
        now,
      ),
      DB.prepare(`
        INSERT INTO portal_notifications
          (id, tenant_id, recipient_user_id, application_id, source_event_id,
           event_type, title, body, link_path, status, created_at, read_at)
        SELECT ?, ?, ?, ?, ?, 'application.closed', ?, ?, ?, 'unread', ?, NULL
        WHERE EXISTS (
          SELECT 1 FROM portal_audit_events event
          WHERE event.id = ? AND event.tenant_id = ?
        )
      `).bind(
        notificationId,
        actor.tenantId,
        application.owner_user_id,
        application.id,
        closedAuditId,
        subject,
        `Sagen er ${decision}. Den afsluttende kvittering er klar.`,
        `/?case=${encodeURIComponent(caseNumber)}`,
        now,
        closedAuditId,
        actor.tenantId,
      ),
      DB.prepare(`
        INSERT INTO portal_mail_outbox
          (id, tenant_id, application_id, recipient_user_id, recipient_email,
           recipient_name, template_key, subject, text_body, html_body,
           attachments_json, idempotency_key, status, attempt_count,
           next_attempt_at, provider, provider_message_id, last_error,
           created_by_user_id, created_at, updated_at, sent_at)
        SELECT ?, ?, ?, ?, ?, ?, 'application.closed', ?, ?, ?, ?, ?,
               'queued', 0, ?, 'microsoft_graph', NULL, NULL, ?, ?, ?, NULL
        WHERE EXISTS (
          SELECT 1 FROM portal_audit_events event
          WHERE event.id = ? AND event.tenant_id = ?
        )
        ON CONFLICT(tenant_id, idempotency_key) DO NOTHING
      `).bind(
        outboxId,
        actor.tenantId,
        application.id,
        application.owner_user_id,
        application.owner_email,
        application.owner_name,
        subject,
        text,
        html,
        JSON.stringify([{
          receiptKind: "final",
          applicationVersionId: application.current_version_id,
        }]),
        `application.closed:${application.current_version_id}:${application.owner_email.toLowerCase()}`,
        now,
        userId,
        now,
        now,
        closedAuditId,
        actor.tenantId,
      ),
    );
  }

  const results = await DB.batch(statements);
  if (
    Number(results[0]?.meta.changes ?? 0) !== 1 ||
    Number(results[1]?.meta.changes ?? 0) !== 1 ||
    Number(results[2]?.meta.changes ?? 0) !== 1 ||
    Number(results[3]?.meta.changes ?? 0) !== 1
  ) {
    throw new PortalAccessError(
      409,
      "Sagen blev ændret samtidig. Genindlæs siden og prøv igen.",
    );
  }
  return normalized;
}

export async function addFieldCommentForActor(
  actor: PortalActor,
  inputValue: unknown,
) {
  if (actor.role === "user") {
    throw new PortalAccessError(403, "Kun D-GITA kan kommentere ansøgningsfelter.");
  }
  const input = normalizeFieldCommentInput(inputValue);
  const DB = await preparePortalData();
  const userId = await resolveActorUserId(DB, actor);
  const application = await accessibleApplication(DB, actor, input.caseId);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [DB.prepare(`
      INSERT INTO portal_field_comments
        (id, tenant_id, application_id, application_version_id, field_id,
         author_user_id, visibility, body, status, parent_comment_id,
         created_at, edited_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, NULL, NULL)
    `).bind(
      input.id,
      actor.tenantId,
      application.id,
      application.current_version_id,
      input.fieldId,
      userId,
      input.visibility,
      input.body.trim(),
      now,
    ), DB.prepare(`
      INSERT INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      VALUES (?, ?, ?, ?, ?, 'field_comment.created', 'field_comment', ?, ?, NULL, ?)
    `).bind(
      auditId,
      actor.tenantId,
      application.id,
      userId,
      actor.subject,
      input.id,
      JSON.stringify({ fieldId: input.fieldId, visibility: input.visibility }),
      now,
    )];
  if (input.visibility === "applicant" && application.owner_user_id !== userId) {
    statements.push(DB.prepare(`
      INSERT INTO portal_notifications
        (id, tenant_id, recipient_user_id, application_id, source_event_id,
         event_type, title, body, link_path, status, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, 'field_comment.created', ?, ?, ?, 'unread', ?, NULL)
      ON CONFLICT(recipient_user_id, source_event_id) DO NOTHING
    `).bind(
      crypto.randomUUID(),
      actor.tenantId,
      application.owner_user_id,
      application.id,
      auditId,
      `D-GITA har kommenteret ${input.fieldLabel}`,
      input.body.trim().slice(0, 240),
      `/?case=${encodeURIComponent(input.caseId)}`,
      now,
    ));
  }
  await DB.batch(statements);
  return {
    ...input,
    body: input.body.trim(),
    authorSubject: actor.subject,
    authorName: actor.displayName,
    createdAt: now,
  } satisfies FieldComment;
}

export async function resetWorkspaceContentForActor(actor: PortalActor) {
  requireAdmin(actor);
  const DB = await preparePortalData();
  await DB.prepare(
    `DELETE FROM portal_content_entries
     WHERE tenant_id = ? AND content_type = 'content'`,
  )
    .bind(actor.tenantId)
    .run();
  await seedContentDefaults(DB, actor.tenantId);
  await recordAudit(DB, actor, "content.reset", "tenant", actor.tenantId, {});
}

export async function resetWorkspaceImagesForActor(actor: PortalActor) {
  requireAdmin(actor);
  const DB = await preparePortalData();
  const assets = (await DB.prepare(`
    SELECT id, storage_key, content_type, size_bytes, checksum_sha256
    FROM portal_images WHERE tenant_id = ? AND status = 'ready'
  `).bind(actor.tenantId).all<StoredImageAssetRow>()).results;
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(
      `DELETE FROM portal_content_entries
       WHERE tenant_id = ? AND content_type = 'image'`,
    ).bind(actor.tenantId),
    DB.prepare(`
      UPDATE portal_images SET status = 'deleted', deleted_at = ?
      WHERE tenant_id = ? AND status = 'ready'
    `).bind(now, actor.tenantId),
  ]);
  if (assets.length > 0) {
    const { FILES } = await getPersistenceBindings();
    await Promise.allSettled(assets.map((asset) => FILES.delete(asset.storage_key)));
  }
  await seedImageDefaults(DB, actor.tenantId);
  await recordAudit(DB, actor, "images.reset", "tenant", actor.tenantId, {});
}

async function accessibleApplication(
  DB: D1Database,
  actor: PortalActor,
  caseNumber: string,
) {
  const userId = await resolveActorUserId(DB, actor);
  const ownerClause = actor.role === "user" ? "AND application.owner_user_id = ?" : "";
  const statement = DB.prepare(`
    SELECT application.id, application.status, application.phase,
           application.row_version, application.current_version_id,
           application.owner_user_id, consultant.id AS assigned_consultant_user_id, application.system_name,
           consultant.display_name AS consultant_name,
           owner.email AS owner_email, owner.display_name AS owner_name
    FROM portal_applications application
    INNER JOIN portal_users owner
      ON owner.id = application.owner_user_id
      AND owner.tenant_id = application.tenant_id
    LEFT JOIN portal_users consultant ON consultant.id = application.assigned_consultant_user_id
      AND consultant.tenant_id = application.tenant_id
    WHERE application.tenant_id = ? AND application.case_number = ?
      ${ownerClause}
    LIMIT 1
  `);
  const row = actor.role === "user"
    ? await statement.bind(actor.tenantId, caseNumber, userId).first<AccessibleApplicationRow>()
    : await statement.bind(actor.tenantId, caseNumber).first<AccessibleApplicationRow>();
  if (!row) throw new PortalAccessError(404, "Sagen findes ikke, eller du har ikke adgang.");
  return row;
}

async function recordAudit(
  DB: D1Database,
  actor: PortalActor,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  applicationId: string | null = null,
) {
  const actorUserId = await resolveActorUserId(DB, actor);
  await DB.prepare(`
    INSERT INTO portal_audit_events
      (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
       entity_type, entity_id, payload_json, ip_hash, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).bind(
    crypto.randomUUID(), actor.tenantId, applicationId, actorUserId, actor.subject,
    eventType, entityType, entityId, JSON.stringify(payload), new Date().toISOString(),
  ).run();
}

function toCaseRecord(row: ApplicationRow, includeAssignmentIdentity: boolean): CaseRecord {
  const metadata = parseJson<{ _demo?: { leader?: string; approval?: CaseRecord["approval"] }; approvingLeader?: string; aiUsage?: unknown }>(row.draft_state_json);
  return {
    id: row.case_number,
    status: row.status,
    currentVersionId: row.current_version_id,
    revision: row.row_version,
    informationRequest: publicInformationRequest(row.information_request_json),
    hasCurrentLeaderApproval: Boolean(row.has_current_leader_approval),
    finalDecision: row.final_decision_status && row.final_decided_at ? {
      outcome: row.final_decision_status, reason: row.final_decision_comment ?? "", decidedAt: row.final_decided_at,
    } : null,
    aiUsage: metadata?.aiUsage === "ja" || metadata?.aiUsage === "nej" || metadata?.aiUsage === "ved-ikke" ? metadata.aiUsage : "",
    tenantId: row.tenant_id,
    ownerSubject: row.owner_subject,
    ownerEmail: row.owner_email,
    system: row.system_name || "Ikke navngivet",
    phase: normalizePhase(row.phase),
    created: formatDanishDate(row.created_at),
    changed: formatDanishDate(row.updated_at),
    consultant: row.consultant_name || "Ikke tildelt",
    ...(includeAssignmentIdentity ? {
      assignedConsultantUserId: row.assigned_consultant_user_id,
      assignedConsultantSubject: row.consultant_subject,
      assignedConsultantProvider: row.consultant_provider,
      leaderReviewLocked: Boolean(row.leader_review_request_id),
      openLeaderApprovalRequestId: row.leader_review_request_id,
    } : {}),
    awaitingLeader: row.leader_approval_status !== null && ["pending", "approving", "rejecting"].includes(row.leader_approval_status),
    applicant: row.applicant_name,
    municipality: row.municipality.replace(/ Kommune$/, ""),
    leader: metadata?._demo?.leader || metadata?.approvingLeader || "Ikke valgt",
    approval: resolveCaseApproval(row.leader_approval_status, metadata?._demo?.approval),
    receiptAvailable: row.current_version_number > 0,
  };
}

export function resolveCaseApproval(
  requestStatus: string | null,
  demoApproval: unknown,
): CaseRecord["approval"] {
  if (requestStatus !== null) return normalizeLeaderApproval(requestStatus);
  return isCaseApproval(demoApproval) ? demoApproval : "Ikke startet";
}

function normalizeLeaderApproval(requestStatus: string): CaseRecord["approval"] {
  if (requestStatus === "approved") return "Godkendt";
  if (requestStatus === "rejected") return "Afvist";
  if (["pending", "approving", "rejecting"].includes(requestStatus)) return "Afventer";
  return "Ikke startet";
}

function isCaseApproval(value: unknown): value is CaseRecord["approval"] {
  return value === "Ikke startet" || value === "Afventer" || value === "Godkendt" || value === "Afvist";
}

function normalizePhase(value: string): CaseRecord["phase"] {
  return value === "Indsendt" || value === "Under behandling" || value === "Afsluttet"
    ? value
    : "Kladde";
}

function formatDanishDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("da-DK", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date).replace(",", "");
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseEntry<T>(value: string): T[] {
  const parsed = parseJson<T>(value);
  return parsed ? [parsed] : [];
}

function decodeUploadedImage(value: string) {
  if (!value.startsWith("data:")) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/iu.exec(value);
  if (!match) {
    throw new PortalAccessError(422, "Upload kun et PNG-, JPG- eller WebP-billede.");
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(match[2].replace(/\s+/gu, ""));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new PortalAccessError(422, "Billedfilen kunne ikke afkodes.");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 3 * 1024 * 1024) {
    throw new PortalAccessError(422, "Billedfilen må højst fylde 3 MB.");
  }
  const contentType = match[1].toLowerCase();
  const signatureMatches = contentType === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === "image/png"
      ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!signatureMatches) {
    throw new PortalAccessError(422, "Billedfilens indhold matcher ikke filtypen.");
  }
  return { contentType, bytes };
}

async function sha256Bytes(bytes: ArrayBuffer | Uint8Array) {
  const source = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fieldLabel(fieldId: string) {
  const labels: Record<string, string> = {
    system: "System eller løsning",
    purpose: "Formål og ønsket effekt",
    users: "Antal brugere",
    "personal-data": "Personoplysninger",
    finance: "Samlet finansiering",
  };
  return labels[fieldId] ?? fieldId;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function requireAdmin(actor: PortalActor) {
  if (actor.role !== "admin") {
    throw new PortalAccessError(403, "Kun administratorer kan ændre portalindhold.");
  }
}
