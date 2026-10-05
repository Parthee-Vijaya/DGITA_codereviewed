import type { ServerActor } from "../auth/types";
import type { AttachmentDraft } from "./engine";
import { assertAttachmentScanAllowed, MalwareScanError, scanUploadBytes } from "./malware-scan";
import {
  acknowledgeApplicationAttachmentBlobDeletion,
  acquireApplicationAttachmentVerification,
  beginApplicationAttachmentUpload,
  claimAbandonedApplicationUploads,
  discardApplicationAttachmentVerification,
  discardPendingApplicationAttachment,
  finalizeApplicationAttachmentUpload,
  getApplicationAttachmentUpload,
  ApplicationRepositoryError,
  type ApplicationAttachmentBlobDeletion,
  type ApplicationAttachmentVerificationLease,
} from "./server-repository";
import {
  createPrivateBlobUploadUrl,
  deletePrivateBlob,
  inspectPrivateBlob,
  isVercelBlobTransferEnabled,
  verifyPrivateBlobReference,
  VercelBlobTransferError,
} from "./vercel-blob-transfer";
import {
  directUploadMatches,
  type DirectUploadMetadata,
} from "./direct-upload-policy";

export class DirectUploadUnavailableError extends Error {
  readonly status = 503;

  constructor(message = "Direkte dokumentupload er ikke konfigureret.") {
    super(message);
    this.name = "DirectUploadUnavailableError";
  }
}

export async function prepareDirectApplicationUpload(
  actor: ServerActor,
  applicationId: string,
  metadata: DirectUploadMetadata,
) {
  if (!isVercelBlobTransferEnabled()) throw new DirectUploadUnavailableError();
  // A small opportunistic pass keeps quotas usable even if the scheduled job
  // has been delayed. Cleanup failures must never prevent a new upload.
  await cleanupAbandonedDirectApplicationUploads(5).catch(() => undefined);
  const upload = await beginApplicationAttachmentUpload(actor, applicationId, metadata);
  try {
    const signed = await createPrivateBlobUploadUrl(upload.storageKey, upload);
    return {
      attachmentId: upload.id,
      uploadUrl: signed.uploadUrl,
      contentType: upload.contentType,
      expiresAt: new Date(signed.validUntil).toISOString(),
    };
  } catch (error) {
    await discardPendingApplicationAttachment(
      actor,
      applicationId,
      upload.id,
    ).catch(() => false);
    if (error instanceof VercelBlobTransferError) {
      throw new DirectUploadUnavailableError(error.message);
    }
    throw error;
  }
}

export async function completeDirectApplicationUpload(
  actor: ServerActor,
  applicationId: string,
  attachmentId: string,
  blobUrl: string,
): Promise<AttachmentDraft> {
  if (!isVercelBlobTransferEnabled()) throw new DirectUploadUnavailableError();
  const upload = await getApplicationAttachmentUpload(actor, applicationId, attachmentId);
  if (upload.status === "ready") {
    await assertAttachmentScanAllowed(upload.scanStatus);
    return attachmentDraft(upload);
  }

  let lease: ApplicationAttachmentVerificationLease | null = null;
  let commitAttempted = false;
  try {
    const authoritativeStorageKey = await verifyPrivateBlobReference(
      blobUrl,
      upload.logicalStorageKey,
    );
    lease = await acquireApplicationAttachmentVerification(
      actor,
      upload,
      authoritativeStorageKey,
    );
    const observed = await inspectPrivateBlob(
      lease.storageKey,
      lease.logicalStorageKey,
    );
    if (
      observed.storageLocator !== lease.storageKey ||
      !directUploadMatches(lease, observed)
    ) {
      throw new ApplicationRepositoryError(
        422,
        "Bilaget svarer ikke til den valgte fil og blev derfor afvist.",
      );
    }

    if (!observed.bytes) throw new ApplicationRepositoryError(422, "Bilagets indhold kunne ikke sikkerhedskontrolleres.");
    const scanStatus = await scanUploadBytes(observed.bytes, observed.checksum);

    // From this point a database error is ambiguous: the ready transition may
    // have committed even if its response was lost. Never delete the Blob in
    // that branch; a retained verifying lease is handled by TTL cleanup.
    commitAttempted = true;
    return await finalizeApplicationAttachmentUpload(actor, lease, { ...observed, scanStatus });
  } catch (error) {
    if (commitAttempted) {
      try {
        const current = await getApplicationAttachmentUpload(actor, applicationId, attachmentId);
        if (current.status === "ready") {
          await assertAttachmentScanAllowed(current.scanStatus);
          return attachmentDraft(current);
        }
      } catch {
        // An unavailable read cannot prove that the commit failed. Keep Blob.
      }
    } else if (lease) {
      const target = await discardApplicationAttachmentVerification(actor, lease, error instanceof MalwareScanError && error.code === "MALWARE_DETECTED" ? "infected" : "failed").catch(
        () => null,
      );
      if (target) await deleteClaimedApplicationBlob(target);
    }
    if (error instanceof VercelBlobTransferError) {
      throw new DirectUploadUnavailableError(error.message);
    }
    throw error;
  }
}

export async function cancelDirectApplicationUpload(
  actor: ServerActor,
  applicationId: string,
  attachmentId: string,
  blobUrl: string | null,
) {
  if (!isVercelBlobTransferEnabled()) throw new DirectUploadUnavailableError();
  const upload = await getApplicationAttachmentUpload(actor, applicationId, attachmentId);
  if (upload.status === "ready") return false;

  if (blobUrl) {
    try {
      const authoritativeStorageKey = await verifyPrivateBlobReference(
        blobUrl,
        upload.logicalStorageKey,
      );
      const lease = await acquireApplicationAttachmentVerification(
        actor,
        upload,
        authoritativeStorageKey,
      );
      const target = await discardApplicationAttachmentVerification(actor, lease);
      if (!target) return false;
      await deleteClaimedApplicationBlob(target);
      return true;
    } catch {
      // No client-provided URL is ever deleted. Without a verified exact Blob
      // URL the reservation remains quota-bound to prevent orphan abuse.
    }
  }
  return false;
}

export async function cleanupAbandonedDirectApplicationUploads(limit?: number) {
  if (!isVercelBlobTransferEnabled()) {
    return {
      pendingQuarantined: 0,
      verifyingDiscarded: 0,
      blobsDeleted: 0,
      blobsPendingRetry: 0,
    };
  }

  const claimed = await claimAbandonedApplicationUploads(Date.now(), limit);
  let blobsDeleted = 0;
  for (const target of claimed.deletionTargets) {
    if (await deleteClaimedApplicationBlob(target)) blobsDeleted += 1;
  }
  return {
    pendingQuarantined: claimed.pendingQuarantined,
    verifyingDiscarded: claimed.verifyingDiscarded,
    blobsDeleted,
    blobsPendingRetry: claimed.deletionTargets.length - blobsDeleted,
  };
}

async function deleteClaimedApplicationBlob(
  target: ApplicationAttachmentBlobDeletion,
) {
  try {
    await deletePrivateBlob(target.storageKey);
    return await acknowledgeApplicationAttachmentBlobDeletion(target);
  } catch {
    // The durable lock is intentionally kept so cron can retry idempotently.
    return false;
  }
}

function attachmentDraft(
  upload: Pick<
    Awaited<ReturnType<typeof getApplicationAttachmentUpload>>,
    "id" | "kind" | "name" | "size" | "contentType"
  >,
): AttachmentDraft {
  return {
    id: upload.id,
    kind: upload.kind,
    name: upload.name,
    size: upload.size,
    type: upload.contentType,
    status: "uploaded",
  };
}
