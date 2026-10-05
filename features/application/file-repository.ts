import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";
import { assertAttachmentScanAllowed } from "./malware-scan";

type FileRow = {
  id: string;
  original_name: string;
  size_bytes: number;
  content_type: string;
  storage_key: string;
  kind: string;
  created_at: string;
  scan_status: string;
};

export class FileAccessError extends Error {
  constructor(readonly status: 403 | 404, message: string) {
    super(message);
    this.name = "FileAccessError";
  }
}

export async function listCaseAttachments(actor: ServerActor, caseNumber: string) {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const ownerClause = actor.role === "user" ? "AND application.owner_user_id = ?" : "";
  const statement = DB.prepare(`
    SELECT attachment.id, attachment.original_name, attachment.size_bytes,
           attachment.content_type, attachment.storage_key, attachment.kind,
           attachment.created_at, attachment.scan_status
    FROM portal_attachments attachment
    INNER JOIN portal_applications application
      ON application.id = attachment.application_id
      AND application.tenant_id = attachment.tenant_id
    WHERE attachment.tenant_id = ? AND application.case_number = ?
      AND attachment.status = 'ready'
      AND (
        (application.current_version_id IS NULL AND attachment.application_version_id IS NULL)
        OR attachment.application_version_id = application.current_version_id
      ) ${ownerClause}
    ORDER BY attachment.created_at, attachment.id
  `);
  const result = actor.role === "user"
    ? await statement.bind(actor.tenantId, caseNumber, actor.userId).all<FileRow>()
    : await statement.bind(actor.tenantId, caseNumber).all<FileRow>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.original_name,
    size: row.size_bytes,
    contentType: row.content_type,
    kind: row.kind,
    createdAt: row.created_at,
    downloadUrl: `/api/files/${encodeURIComponent(row.id)}`,
  }));
}

export async function getAttachmentDownload(actor: ServerActor, attachmentId: string) {
  const row = await authorizeAttachmentDownload(actor, attachmentId);
  const { FILES } = await getPersistenceBindings();
  const object = await FILES.get(row.storage_key);
  if (!object?.body) throw new FileAccessError(404, "Filen findes ikke i dokumentlageret.");
  return { row, object };
}

export async function authorizeAttachmentDownload(actor: ServerActor, attachmentId: string) {
  await ensurePortalSchema();
  const { DB } = await getPersistenceBindings();
  const ownerClause = actor.role === "user" ? "AND application.owner_user_id = ?" : "";
  const statement = DB.prepare(`
    SELECT attachment.id, attachment.original_name, attachment.size_bytes,
           attachment.content_type, attachment.storage_key, attachment.kind,
           attachment.created_at, attachment.scan_status
    FROM portal_attachments attachment
    INNER JOIN portal_applications application
      ON application.id = attachment.application_id
      AND application.tenant_id = attachment.tenant_id
    WHERE attachment.id = ? AND attachment.tenant_id = ?
      AND attachment.status = 'ready'
      AND (
        (application.current_version_id IS NULL AND attachment.application_version_id IS NULL)
        OR attachment.application_version_id = application.current_version_id
      ) ${ownerClause}
    LIMIT 1
  `);
  const row = actor.role === "user"
    ? await statement.bind(attachmentId, actor.tenantId, actor.userId).first<FileRow>()
    : await statement.bind(attachmentId, actor.tenantId).first<FileRow>();
  if (!row) throw new FileAccessError(404, "Filen findes ikke, eller du har ikke adgang.");
  await assertAttachmentScanAllowed(row.scan_status);
  return row;
}
