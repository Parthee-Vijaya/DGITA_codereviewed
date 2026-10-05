import type { ServerActor } from "../auth/types";
import { preparePortalData } from "../workspace/server-repository";
import { getAccessibleReceiptSource, ReceiptError, type ReceiptKind } from "./server";
import { createReceiptView } from "./view-model";

/** Read-only projection: no PDF regeneration, Blob writes or receipt mutation. */
export async function getReceiptView(actor: ServerActor, caseNumber: string, kind: ReceiptKind, expectedVersionId?: string) {
  const DB = await preparePortalData();
  const application = await getAccessibleReceiptSource(actor, caseNumber, expectedVersionId);
  if (!application.receipt_version_id || application.receipt_version_number === null || !application.snapshot_json || !application.submitted_at) {
    throw new ReceiptError(expectedVersionId ? 404 : 409, "Den versionslåste kvittering findes ikke.");
  }
  if (kind === "approval" && !application.approval_status) throw new ReceiptError(409, "Lederbeslutningen er endnu ikke registreret.");
  if (kind === "final" && application.status !== "closed") throw new ReceiptError(409, "Sagen er endnu ikke afsluttet.");
  const metadata = await DB.prepare(`
    SELECT version.snapshot_sha256,
      (SELECT COUNT(*) FROM portal_approval_requests request
        WHERE request.application_version_id = version.id
          AND request.application_id = version.application_id AND request.tenant_id = version.tenant_id
          AND request.status IN ('approved', 'rejected')) AS committed_leader_decisions,
      CASE WHEN json_valid(approval.internal_fields_json)
        THEN json_extract(approval.internal_fields_json, '$.updatedBy') ELSE NULL END AS reviewer_snapshot
    FROM portal_application_versions version
    LEFT JOIN portal_dgita_approvals approval ON approval.application_version_id = version.id
      AND approval.application_id = version.application_id AND approval.tenant_id = version.tenant_id
    WHERE version.id = ? AND version.application_id = ? AND version.tenant_id = ? LIMIT 1
  `).bind(application.receipt_version_id, application.id, actor.tenantId)
    .first<{ snapshot_sha256: string; committed_leader_decisions: number; reviewer_snapshot: unknown }>();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(application.snapshot_json));
  const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!metadata || metadata.snapshot_sha256 !== actualHash) throw new ReceiptError(409, "Sagsversionens kontrolsum kunne ikke bekræftes.");
  if (kind === "approval" && metadata.committed_leader_decisions !== 1) {
    throw new ReceiptError(409, "Sagsversionens lederbeslutning er ikke entydig.");
  }
  try {
    return createReceiptView({
      ...application,
      receipt_version_id: application.receipt_version_id,
      receipt_version_number: application.receipt_version_number,
      snapshot_json: application.snapshot_json,
      submitted_at: application.submitted_at,
      snapshot_sha256: actualHash,
      dgita_status: application.dgita_status ?? null,
      dgita_reviewer_snapshot: typeof metadata.reviewer_snapshot === "string" ? metadata.reviewer_snapshot : null,
      dgita_comment: application.dgita_comment ?? null,
      dgita_decided_at: application.dgita_decided_at ?? null,
    }, kind);
  } catch { throw new ReceiptError(422, "Den indsendte version kan ikke læses."); }
}
