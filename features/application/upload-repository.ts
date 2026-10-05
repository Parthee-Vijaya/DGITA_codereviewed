import { getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";
import type { AttachmentDraft, UploadKind } from "./engine";
import { applicationEditMode } from "./correction-policy";
import {
  MAX_ACTIVE_DIRECT_UPLOADS_PER_APPLICATION,
  MAX_ACTIVE_DIRECT_UPLOADS_PER_USER,
  directUploadCleanupLimit,
  directUploadLifecycleTimes,
  directUploadMatches,
  safeAttachmentStorageName,
  type DirectUploadMetadata,
} from "./direct-upload-policy";
import { assertAttachmentScanAllowed, scanUploadBytes, type AttachmentScanStatus } from "./malware-scan";
import { ApplicationRepositoryError, portalDb, findApplicationById, appendApplicationAudit, assertApplicationId, assertOwner, assertCanCreate, sha256Bytes } from "./repository-support";

export async function getOwnedDraftForUpload(actor: ServerActor, id: string) {
  assertCanCreate(actor);
  assertApplicationId(id);
  const DB = await portalDb();
  const row = await findApplicationById(DB, id);
  if (!row) throw new ApplicationRepositoryError(404, "Kladden findes ikke.");
  assertOwner(actor, row);
  if (!applicationEditMode(row.status)) {
    throw new ApplicationRepositoryError(409, "Bilag på en indsendt version er låst.");
  }
  return { DB, application: row };
}

export async function storeApplicationAttachment(
  actor: ServerActor,
  applicationId: string,
  kind: UploadKind,
  file: File,
) {
  const { DB } = await getOwnedDraftForUpload(actor, applicationId);
  const { FILES } = await getPersistenceBindings();
  const bytes = await file.arrayBuffer();
  const checksum = await sha256Bytes(bytes);
  const scanStatus = await scanUploadBytes(new Uint8Array(bytes), checksum);
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-140) || "document";
  const pathname = `tenants/${actor.tenantId}/applications/${applicationId}/${id}/${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const stored = await FILES.put(pathname, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      tenantId: actor.tenantId,
      applicationId,
      ownerUserId: actor.userId,
      kind,
      checksum,
    },
  });
  const storageKey = stored.key;
  const now = new Date().toISOString();
  try {
    const inserted = await DB.prepare(`
      INSERT INTO portal_attachments
        (id, tenant_id, application_id, application_version_id, owner_user_id,
         kind, original_name, size_bytes, content_type, storage_key,
         checksum_sha256, status, scan_status, uploaded_by_user_id,
         created_at, immutable_at, deleted_at)
      SELECT ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, NULL, NULL
      WHERE EXISTS (
        SELECT 1 FROM portal_applications
        WHERE id = ? AND tenant_id = ? AND owner_user_id = ?
          AND status IN ('draft', 'changes_requested')
      )
    `).bind(
      id,
      actor.tenantId,
      applicationId,
      actor.userId,
      kind,
      file.name,
      file.size,
      contentType,
      storageKey,
      checksum,
      scanStatus,
      actor.userId,
      now,
      applicationId,
      actor.tenantId,
      actor.userId,
    ).run();
    if (Number(inserted.meta.changes ?? 0) !== 1) {
      throw new ApplicationRepositoryError(
        409,
        "Sagen blev indsendt, før bilaget var færdigt. Åbn sagen igen.",
      );
    }
  } catch (error) {
    // A database commit can succeed even when its response is lost. Never
    // remove the file unless an authoritative read confirms no committed row.
    try {
      const committed = await DB.prepare("SELECT id FROM portal_attachments WHERE id = ? AND tenant_id = ? AND storage_key = ?")
        .bind(id, actor.tenantId, storageKey).first<{ id: string }>();
      if (!committed) await FILES.delete(storageKey);
    } catch { /* Retain the object for reconciliation when the database is unavailable. */ }
    throw error;
  }
  return {
    id,
    kind,
    name: file.name,
    size: file.size,
    type: contentType,
    status: "uploaded" as const,
  } satisfies AttachmentDraft;
}

export type PendingApplicationAttachment = DirectUploadMetadata & {
  id: string;
  applicationId: string;
  storageKey: string;
  logicalStorageKey: string;
  status: "pending" | "verifying" | "ready";
  scanStatus?: string;
};

export type ApplicationAttachmentVerificationLease =
  PendingApplicationAttachment & {
    status: "verifying";
    leaseToken: string;
    leaseExpiresAt: string;
  };

export type ApplicationAttachmentBlobDeletion = {
  attachmentId: string;
  storageKey: string;
  leaseToken: string;
};

export async function beginApplicationAttachmentUpload(
  actor: ServerActor,
  applicationId: string,
  metadata: DirectUploadMetadata,
): Promise<PendingApplicationAttachment> {
  const { DB } = await getOwnedDraftForUpload(actor, applicationId);
  const id = crypto.randomUUID();
  const storageKey = applicationAttachmentLogicalStorageKey(
    actor.tenantId,
    applicationId,
    id,
    metadata.name,
  );
  const now = new Date().toISOString();
  const inserted = await DB.prepare(`
    INSERT INTO portal_attachments
      (id, tenant_id, application_id, application_version_id, owner_user_id,
       kind, original_name, size_bytes, content_type, storage_key,
       checksum_sha256, status, scan_status, uploaded_by_user_id,
       created_at, immutable_at, deleted_at)
    SELECT ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, NULL, NULL
    WHERE EXISTS (
      SELECT 1 FROM portal_applications
      WHERE id = ? AND tenant_id = ? AND owner_user_id = ?
        AND status IN ('draft', 'changes_requested')
    )
      AND (
        SELECT COUNT(*) FROM portal_attachments
        WHERE tenant_id = ? AND owner_user_id = ?
          AND application_version_id IS NULL
          AND status IN ('pending', 'verifying', 'quarantined')
      ) < ?
      AND (
        SELECT COUNT(*) FROM portal_attachments
        WHERE tenant_id = ? AND application_id = ?
          AND application_version_id IS NULL
          AND status IN ('pending', 'verifying', 'quarantined')
      ) < ?
  `).bind(
    id,
    actor.tenantId,
    applicationId,
    actor.userId,
    metadata.kind,
    metadata.name,
    metadata.size,
    metadata.contentType,
    storageKey,
    metadata.checksum,
    actor.userId,
    now,
    applicationId,
    actor.tenantId,
    actor.userId,
    actor.tenantId,
    actor.userId,
    MAX_ACTIVE_DIRECT_UPLOADS_PER_USER,
    actor.tenantId,
    applicationId,
    MAX_ACTIVE_DIRECT_UPLOADS_PER_APPLICATION,
  ).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    const quota = await DB.prepare(`
      SELECT
        (
          SELECT COUNT(*) FROM portal_attachments
          WHERE tenant_id = ? AND owner_user_id = ?
            AND application_version_id IS NULL
            AND status IN ('pending', 'verifying', 'quarantined')
        ) AS user_count,
        (
          SELECT COUNT(*) FROM portal_attachments
          WHERE tenant_id = ? AND application_id = ?
            AND application_version_id IS NULL
            AND status IN ('pending', 'verifying', 'quarantined')
        ) AS application_count
    `).bind(
      actor.tenantId,
      actor.userId,
      actor.tenantId,
      applicationId,
    ).first<{ user_count: number; application_count: number }>();
    if (Number(quota?.application_count ?? 0) >= MAX_ACTIVE_DIRECT_UPLOADS_PER_APPLICATION) {
      throw new ApplicationRepositoryError(
        409,
        "Sagen har for mange ufærdige uploads. Vent på de aktive uploads, eller prøv igen senere.",
      );
    }
    if (Number(quota?.user_count ?? 0) >= MAX_ACTIVE_DIRECT_UPLOADS_PER_USER) {
      throw new ApplicationRepositoryError(
        409,
        "Du har for mange ufærdige uploads. Vent på de aktive uploads, eller prøv igen senere.",
      );
    }
    throw new ApplicationRepositoryError(
      409,
      "Sagen blev indsendt, før uploaden kunne startes. Åbn sagen igen.",
    );
  }
  return {
    ...metadata,
    id,
    applicationId,
    storageKey,
    logicalStorageKey: storageKey,
    status: "pending",
  };
}

export async function getApplicationAttachmentUpload(
  actor: ServerActor,
  applicationId: string,
  attachmentId: string,
): Promise<PendingApplicationAttachment> {
  const { DB } = await getOwnedDraftForUpload(actor, applicationId);
  const row = await DB.prepare(`
    SELECT id, application_id, kind, original_name, size_bytes, content_type,
           storage_key, checksum_sha256, status, scan_status
    FROM portal_attachments
    WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
      AND application_version_id IS NULL AND status IN ('pending', 'verifying', 'ready')
    LIMIT 1
  `).bind(
    attachmentId,
    actor.tenantId,
    applicationId,
    actor.userId,
  ).first<{
    id: string;
    application_id: string;
    kind: UploadKind;
    original_name: string;
    size_bytes: number;
    content_type: string;
    storage_key: string;
    checksum_sha256: string;
    status: "pending" | "verifying" | "ready";
    scan_status: string;
  }>();
  if (!row) {
    throw new ApplicationRepositoryError(404, "Uploaden findes ikke, eller du har ikke adgang.");
  }
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind,
    name: row.original_name,
    size: row.size_bytes,
    contentType: row.content_type,
    storageKey: row.storage_key,
    logicalStorageKey: applicationAttachmentLogicalStorageKey(
      actor.tenantId,
      applicationId,
      row.id,
      row.original_name,
    ),
    checksum: row.checksum_sha256,
    status: row.status,
    scanStatus: row.scan_status,
  };
}

export async function acquireApplicationAttachmentVerification(
  actor: ServerActor,
  upload: PendingApplicationAttachment,
  authoritativeStorageKey: string,
  now = Date.now(),
): Promise<ApplicationAttachmentVerificationLease> {
  if (upload.status === "ready") {
    throw new ApplicationRepositoryError(409, "Bilaget er allerede færdigbehandlet.");
  }

  const { DB } = await getOwnedDraftForUpload(actor, upload.applicationId);
  const leaseToken = crypto.randomUUID();
  const lifecycle = directUploadLifecycleTimes(now);
  const [locked, markedVerifying] = await DB.batch([
    DB.prepare(`
      INSERT INTO portal_attachment_upload_locks
        (attachment_id, authoritative_storage_key, lease_token, acquired_at, expires_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_attachments attachment
        WHERE attachment.id = ? AND attachment.tenant_id = ?
          AND attachment.application_id = ? AND attachment.owner_user_id = ?
          AND attachment.application_version_id IS NULL
          AND attachment.status IN ('pending', 'verifying')
          AND EXISTS (
            SELECT 1 FROM portal_applications application
            WHERE application.id = attachment.application_id
              AND application.tenant_id = attachment.tenant_id
              AND application.owner_user_id = attachment.owner_user_id
              AND application.status IN ('draft', 'changes_requested')
          )
      )
      ON CONFLICT(attachment_id) DO UPDATE SET
        authoritative_storage_key = excluded.authoritative_storage_key,
        lease_token = excluded.lease_token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
      WHERE portal_attachment_upload_locks.expires_at <= ?
    `).bind(
      upload.id,
      authoritativeStorageKey,
      leaseToken,
      lifecycle.acquiredAt,
      lifecycle.leaseExpiresAt,
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
      lifecycle.acquiredAt,
    ),
    DB.prepare(`
      UPDATE portal_attachments
      SET status = 'verifying', storage_key = ?
      WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
        AND application_version_id IS NULL AND status IN ('pending', 'verifying')
        AND EXISTS (
          SELECT 1 FROM portal_attachment_upload_locks upload_lock
          WHERE upload_lock.attachment_id = portal_attachments.id
            AND upload_lock.lease_token = ?
            AND upload_lock.authoritative_storage_key = ?
        )
        AND EXISTS (
          SELECT 1 FROM portal_applications
          WHERE id = ? AND tenant_id = ? AND owner_user_id = ?
            AND status IN ('draft', 'changes_requested')
        )
    `).bind(
      authoritativeStorageKey,
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
      leaseToken,
      authoritativeStorageKey,
      upload.applicationId,
      actor.tenantId,
      actor.userId,
    ),
  ]);

  if (
    Number(locked?.meta.changes ?? 0) !== 1 ||
    Number(markedVerifying?.meta.changes ?? 0) !== 1
  ) {
    throw new ApplicationRepositoryError(
      409,
      "Bilaget kontrolleres allerede. Prøv igen, hvis kontrollen ikke afsluttes.",
    );
  }

  return {
    ...upload,
    status: "verifying",
    storageKey: authoritativeStorageKey,
    leaseToken,
    leaseExpiresAt: lifecycle.leaseExpiresAt,
  };
}

export async function finalizeApplicationAttachmentUpload(
  actor: ServerActor,
  upload: ApplicationAttachmentVerificationLease,
  observed: Pick<DirectUploadMetadata, "size" | "contentType" | "checksum"> & {
    storageLocator: string;
    scanStatus?: AttachmentScanStatus;
  },
) {
  if (
    observed.storageLocator !== upload.storageKey ||
    !directUploadMatches(upload, observed)
  ) {
    throw new ApplicationRepositoryError(
      422,
      "Bilaget svarer ikke til den valgte fil og blev derfor afvist.",
    );
  }

  const { DB } = await getOwnedDraftForUpload(actor, upload.applicationId);
  const scanStatus = observed.scanStatus ?? "not_configured";
  await assertAttachmentScanAllowed(scanStatus);
  const now = new Date().toISOString();
  const [updated] = await DB.batch([
    DB.prepare(`
      UPDATE portal_attachments SET status = 'ready', storage_key = ?, scan_status = ?
      WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
        AND application_version_id IS NULL AND status = 'verifying'
        AND EXISTS (
          SELECT 1 FROM portal_attachment_upload_locks upload_lock
          WHERE upload_lock.attachment_id = portal_attachments.id
            AND upload_lock.lease_token = ?
            AND upload_lock.authoritative_storage_key = ?
        )
        AND EXISTS (
          SELECT 1 FROM portal_applications
          WHERE id = ? AND tenant_id = ? AND owner_user_id = ?
            AND status IN ('draft', 'changes_requested')
        )
    `).bind(
      observed.storageLocator,
      scanStatus,
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
      upload.leaseToken,
      upload.storageKey,
      upload.applicationId,
      actor.tenantId,
      actor.userId,
    ),
    DB.prepare(`
      INSERT OR IGNORE INTO portal_audit_events
        (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
         entity_type, entity_id, payload_json, ip_hash, occurred_at)
      SELECT ?, ?, ?, ?, ?, 'attachment.uploaded', 'application', ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM portal_attachments
        WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
          AND status = 'ready'
      )
    `).bind(
      `attachment-upload:${upload.id}`,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
      actor.subject,
      upload.applicationId,
      JSON.stringify({
        attachmentId: upload.id,
        kind: upload.kind,
        size: upload.size,
        checksum: upload.checksum,
        scanStatus,
      }),
      now,
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
    ),
    DB.prepare(`
      DELETE FROM portal_attachment_upload_locks
      WHERE attachment_id = ? AND lease_token = ?
        AND authoritative_storage_key = ?
        AND EXISTS (
          SELECT 1 FROM portal_attachments
          WHERE id = ? AND tenant_id = ? AND application_id = ?
            AND owner_user_id = ? AND status = 'ready'
            AND storage_key = ?
        )
    `).bind(
      upload.id,
      upload.leaseToken,
      upload.storageKey,
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
      upload.storageKey,
    ),
  ]);
  if (Number(updated.meta.changes ?? 0) !== 1) {
    const current = await DB.prepare(`
      SELECT status, storage_key FROM portal_attachments
      WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
      LIMIT 1
    `).bind(
      upload.id,
      actor.tenantId,
      upload.applicationId,
      actor.userId,
    ).first<{ status: string; storage_key: string }>();
    if (current?.status !== "ready" || current.storage_key !== upload.storageKey) {
      throw new ApplicationRepositoryError(
        409,
        "Sagen blev ændret, før bilaget var færdigt. Åbn sagen igen.",
      );
    }
  }
  return attachmentDraftFromUpload(upload);
}

export async function discardPendingApplicationAttachment(
  actor: ServerActor,
  applicationId: string,
  attachmentId: string,
): Promise<boolean> {
  assertCanCreate(actor);
  assertApplicationId(applicationId);
  const DB = await portalDb();
  const now = new Date().toISOString();
  const deleted = await DB.prepare(`
    UPDATE portal_attachments SET status = 'deleted', deleted_at = ?
    WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
      AND application_version_id IS NULL AND status = 'pending'
  `).bind(
    now,
    attachmentId,
    actor.tenantId,
    applicationId,
    actor.userId,
  ).run();
  return Number(deleted.meta.changes ?? 0) === 1;
}

export async function discardApplicationAttachmentVerification(
  actor: ServerActor,
  upload: ApplicationAttachmentVerificationLease,
  scanStatus: "failed" | "infected" = "failed",
): Promise<ApplicationAttachmentBlobDeletion | null> {
  assertCanCreate(actor);
  const DB = await portalDb();
  const now = new Date().toISOString();
  const deleted = await DB.prepare(`
    UPDATE portal_attachments
    SET status = 'deleted', deleted_at = ?, scan_status = ?
    WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
      AND application_version_id IS NULL AND status = 'verifying'
      AND storage_key = ?
      AND EXISTS (
        SELECT 1 FROM portal_attachment_upload_locks upload_lock
        WHERE upload_lock.attachment_id = portal_attachments.id
          AND upload_lock.lease_token = ?
          AND upload_lock.authoritative_storage_key = ?
      )
  `).bind(
    now,
    scanStatus,
    upload.id,
    actor.tenantId,
    upload.applicationId,
    actor.userId,
    upload.storageKey,
    upload.leaseToken,
    upload.storageKey,
  ).run();
  if (Number(deleted.meta.changes ?? 0) !== 1) return null;
  return {
    attachmentId: upload.id,
    storageKey: upload.storageKey,
    leaseToken: upload.leaseToken,
  };
}

export async function claimAbandonedApplicationUploads(
  now = Date.now(),
  limitValue?: number,
) {
  const limit = directUploadCleanupLimit(limitValue);
  const lifecycle = directUploadLifecycleTimes(now);
  const DB = await portalDb();
  const deletedAt = lifecycle.acquiredAt;
  const [pending, verifying] = await DB.batch([
    DB.prepare(`
      UPDATE portal_attachments
      SET status = 'quarantined', scan_status = 'failed'
      WHERE id IN (
        SELECT id FROM portal_attachments
        WHERE application_version_id IS NULL AND status = 'pending'
          AND created_at <= ?
        ORDER BY created_at, id
        LIMIT ?
      )
    `).bind(lifecycle.abandonedBefore, limit),
    DB.prepare(`
      UPDATE portal_attachments
      SET status = 'deleted', deleted_at = ?
      WHERE id IN (
        SELECT attachment.id
        FROM portal_attachments attachment
        INNER JOIN portal_attachment_upload_locks upload_lock
          ON upload_lock.attachment_id = attachment.id
        WHERE attachment.application_version_id IS NULL
          AND attachment.status = 'verifying'
          AND upload_lock.acquired_at <= ?
        ORDER BY upload_lock.acquired_at, attachment.id
        LIMIT ?
      )
    `).bind(deletedAt, lifecycle.abandonedBefore, limit),
  ]);

  const queued = await DB.prepare(`
    SELECT upload_lock.attachment_id, upload_lock.authoritative_storage_key,
           upload_lock.lease_token
    FROM portal_attachment_upload_locks upload_lock
    INNER JOIN portal_attachments attachment
      ON attachment.id = upload_lock.attachment_id
    WHERE attachment.application_version_id IS NULL
      AND attachment.status = 'deleted'
      AND attachment.storage_key = upload_lock.authoritative_storage_key
    ORDER BY upload_lock.acquired_at, upload_lock.attachment_id
    LIMIT ?
  `).bind(limit).all<{
    attachment_id: string;
    authoritative_storage_key: string;
    lease_token: string;
  }>();

  return {
    pendingQuarantined: Number(pending?.meta.changes ?? 0),
    verifyingDiscarded: Number(verifying?.meta.changes ?? 0),
    deletionTargets: queued.results.map((row) => ({
      attachmentId: row.attachment_id,
      storageKey: row.authoritative_storage_key,
      leaseToken: row.lease_token,
    })) satisfies ApplicationAttachmentBlobDeletion[],
  };
}

export async function acknowledgeApplicationAttachmentBlobDeletion(
  target: ApplicationAttachmentBlobDeletion,
) {
  const DB = await portalDb();
  const deleted = await DB.prepare(`
    DELETE FROM portal_attachment_upload_locks
    WHERE attachment_id = ? AND lease_token = ? AND authoritative_storage_key = ?
      AND EXISTS (
        SELECT 1 FROM portal_attachments
        WHERE id = ? AND status = 'deleted' AND storage_key = ?
      )
  `).bind(
    target.attachmentId,
    target.leaseToken,
    target.storageKey,
    target.attachmentId,
    target.storageKey,
  ).run();
  return Number(deleted.meta.changes ?? 0) === 1;
}

function attachmentDraftFromUpload(upload: PendingApplicationAttachment) {
  return {
    id: upload.id,
    kind: upload.kind,
    name: upload.name,
    size: upload.size,
    type: upload.contentType,
    status: "uploaded" as const,
  } satisfies AttachmentDraft;
}

function applicationAttachmentLogicalStorageKey(
  tenantId: string,
  applicationId: string,
  attachmentId: string,
  originalName: string,
) {
  return `tenants/${tenantId}/applications/${applicationId}/${attachmentId}/${safeAttachmentStorageName(originalName)}`;
}

export async function deleteApplicationAttachment(
  actor: ServerActor,
  applicationId: string,
  attachmentId: string,
) {
  const { DB } = await getOwnedDraftForUpload(actor, applicationId);
  const row = await DB.prepare(`
    SELECT storage_key FROM portal_attachments
    WHERE id = ? AND tenant_id = ? AND application_id = ? AND owner_user_id = ?
      AND application_version_id IS NULL AND status = 'ready'
    LIMIT 1
  `)
    .bind(attachmentId, actor.tenantId, applicationId, actor.userId)
    .first<{ storage_key: string }>();
  if (!row) return false;
  const now = new Date().toISOString();
  const deleted = await DB.prepare(`
    UPDATE portal_attachments SET status = 'deleted', deleted_at = ?
    WHERE id = ? AND tenant_id = ? AND application_id = ?
      AND application_version_id IS NULL AND status = 'ready'
      AND EXISTS (
        SELECT 1 FROM portal_applications
        WHERE id = ? AND tenant_id = ? AND owner_user_id = ?
          AND status IN ('draft', 'changes_requested')
      )
  `).bind(
    now,
    attachmentId,
    actor.tenantId,
    applicationId,
    applicationId,
    actor.tenantId,
    actor.userId,
  ).run();
  if (Number(deleted.meta.changes ?? 0) !== 1) {
    throw new ApplicationRepositoryError(
      409,
      "Bilaget kunne ikke fjernes, fordi sagen blev ændret samtidig.",
    );
  }
  const { FILES } = await getPersistenceBindings();
  await FILES.delete(row.storage_key).catch(() => undefined);
  await appendApplicationAudit(DB, actor, applicationId, "attachment.deleted", {
    attachmentId,
  });
  return true;
}

