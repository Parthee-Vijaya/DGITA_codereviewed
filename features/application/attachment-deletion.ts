import { getPersistenceBindings } from "../../db/persistence";
import { directUploadCleanupLimit } from "./direct-upload-policy";
import { portalDb } from "./repository-support";

/** A queued locator is authoritative and cannot be submitted or reused. */
export async function attemptQueuedApplicationAttachmentDeletion(tenantId: string, attachmentId: string) {
  try {
    const DB = await portalDb();
    const row = await DB.prepare(`
      SELECT storage_key FROM portal_attachments
      WHERE id = ? AND tenant_id = ? AND application_version_id IS NULL
        AND immutable_at IS NULL AND status = 'deleting'
      LIMIT 1
    `).bind(attachmentId, tenantId).first<{ storage_key: string }>();
    if (!row) return "absent" as const;
    const { FILES } = await getPersistenceBindings();
    await FILES.delete(row.storage_key);
    await DB.prepare(`
      UPDATE portal_attachments SET status = 'deleted'
      WHERE id = ? AND tenant_id = ? AND storage_key = ?
        AND application_version_id IS NULL AND immutable_at IS NULL
        AND status = 'deleting'
    `).bind(attachmentId, tenantId, row.storage_key).run();
    return "deleted" as const;
  } catch {
    // A lost acknowledgement is also retried: object deletion is idempotent.
    // Never discard the durable target or expose provider error details.
    return "pending" as const;
  }
}

/** Shared scheduled/opportunistic sweep for R2 and private Blob storage. */
export async function cleanupDeletedApplicationAttachments(limitValue?: number) {
  const DB = await portalDb();
  const queued = await DB.prepare(`
    SELECT id, tenant_id FROM portal_attachments
    WHERE application_version_id IS NULL AND immutable_at IS NULL
      AND status = 'deleting'
    ORDER BY deleted_at, id LIMIT ?
  `).bind(directUploadCleanupLimit(limitValue)).all<{ id: string; tenant_id: string }>();
  let blobsDeleted = 0;
  let blobsPendingRetry = 0;
  for (const row of queued.results) {
    const result = await attemptQueuedApplicationAttachmentDeletion(row.tenant_id, row.id);
    if (result === "deleted") blobsDeleted += 1;
    if (result === "pending") blobsPendingRetry += 1;
  }
  return { blobsDeleted, blobsPendingRetry };
}
