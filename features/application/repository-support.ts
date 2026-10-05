import { ensurePortalSchema, getPersistenceBindings } from "../../db/persistence";
import type { ServerActor } from "../auth/types";

export type ApplicationRow = {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  case_number: string;
  draft_state_json: string;
  status: string;
  row_version: number;
  current_version_number: number;
  current_version_id: string | null;
  updated_at: string;
};

export class ApplicationRepositoryError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApplicationRepositoryError";
  }
}

export async function portalDb() {
  await ensurePortalSchema();
  return (await getPersistenceBindings()).DB;
}

export async function findApplicationById(DB: D1Database, id: string) {
  return DB.prepare(`
    SELECT id, tenant_id, owner_user_id, case_number, draft_state_json, status,
           row_version, current_version_number, current_version_id, updated_at
    FROM portal_applications WHERE id = ? LIMIT 1
  `).bind(id).first<ApplicationRow>();
}

export async function appendApplicationAudit(
  DB: D1Database,
  actor: ServerActor,
  applicationId: string,
  eventType: string,
  payload: unknown,
) {
  await DB.prepare(`
    INSERT INTO portal_audit_events
      (id, tenant_id, application_id, actor_user_id, actor_subject, event_type,
       entity_type, entity_id, payload_json, ip_hash, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, 'application', ?, ?, NULL, ?)
  `).bind(
    crypto.randomUUID(), actor.tenantId, applicationId, actor.userId, actor.subject,
    eventType, applicationId, JSON.stringify(payload), new Date().toISOString(),
  ).run();
}

export function assertApplicationId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) && !/^demo:ITA-\d{6,8}$/u.test(id)) {
    throw new ApplicationRepositoryError(400, "Ugyldig kladde.");
  }
}

export function assertOwner(actor: ServerActor, row: ApplicationRow) {
  if (row.tenant_id !== actor.tenantId || row.owner_user_id !== actor.userId) {
    throw new ApplicationRepositoryError(403, "Kladden tilhører ikke den aktuelle bruger.");
  }
}

export function assertCanCreate(actor: ServerActor) {
  if (actor.role === "consultant") {
    throw new ApplicationRepositoryError(
      403,
      "D-GITA-konsulenter kan behandle sager, men ikke oprette ansøgninger.",
    );
  }
}

export async function sha256Bytes(value: ArrayBuffer | ArrayBufferView) {
  const source = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  const bytes = Uint8Array.from(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

