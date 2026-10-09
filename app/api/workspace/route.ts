import {
  assertSameOrigin,
  authErrorResponse,
  noStoreJson,
} from "../../../features/auth/http";
import { requireActor } from "../../../features/auth/server";
import {
  PortalAccessError,
  addFieldCommentForActor,
  deleteContentForActor,
  getWorkspaceForActor,
  resetWorkspaceContentForActor,
  resetWorkspaceImagesForActor,
  saveApprovalForActor,
  rejectApplicationForActor,
  requestApplicationInformationForActor,
  upsertContentForActor,
  upsertImageForActor,
} from "../../../features/workspace/server-repository";
import type {
  ContentEntry,
  DgitaApproval,
  FieldComment,
  ImageEntry,
} from "../../../features/workspace/model";
import { WorkspaceInputError } from "../../../features/workspace/validation";

type WorkspaceMutation =
  | { action: "application.request-information"; caseId: string; reason: string; dueDate: string; expectedRowVersion: number; expectedVersionId: string }
  | { action: "approval.reject"; caseId: string; reason: string; expectedVersionId: string; expectedRowVersion: number; expectedUpdatedAt: string | null }
  | { action: "content.upsert"; entry: ContentEntry }
  | { action: "content.delete"; id: string }
  | { action: "image.upsert"; entry: ImageEntry }
  | { action: "content.reset" }
  | { action: "image.reset" }
  | { action: "approval.save"; caseId: string; approval: DgitaApproval; expectedUpdatedAt: string | null; expectedRowVersion: number }
  | {
      action: "field-comment.add";
      comment: Pick<FieldComment, "id" | "caseId" | "fieldId" | "fieldLabel" | "body" | "visibility">;
    };

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    return noStoreJson({ workspace: await getWorkspaceForActor(actor) });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request);
    const body = await readWorkspaceMutation(request);
    switch (body.action) {
      case "content.upsert":
        return noStoreJson({ entry: await upsertContentForActor(actor, body.entry) });
      case "content.delete":
        return noStoreJson({ deleted: await deleteContentForActor(actor, body.id) });
      case "image.upsert":
        return noStoreJson({ entry: await upsertImageForActor(actor, body.entry) });
      case "content.reset":
        await resetWorkspaceContentForActor(actor);
        return noStoreJson({ ok: true });
      case "image.reset":
        await resetWorkspaceImagesForActor(actor);
        return noStoreJson({ ok: true });
      case "application.request-information":
        return noStoreJson({ request: await requestApplicationInformationForActor(actor, body.caseId, body) });
      case "approval.reject":
        return noStoreJson({ approval: await rejectApplicationForActor(actor, body.caseId, body) });
      case "approval.save":
        return noStoreJson({ approval: await saveApprovalForActor(actor, body.caseId, body.approval, body.expectedUpdatedAt, body.expectedRowVersion) });
      case "field-comment.add":
        return noStoreJson({ comment: await addFieldCommentForActor(actor, body.comment) }, { status: 201 });
      default:
        return noStoreJson({ error: "Ukendt handling." }, { status: 400 });
    }
  } catch (error) {
    return workspaceError(error);
  }
}

function workspaceError(error: unknown) {
  if (error instanceof WorkspaceInputError) {
    return noStoreJson({ error: error.message }, { status: error.status });
  }
  if (error instanceof PortalAccessError) {
    return noStoreJson({ error: error.message }, { status: error.status });
  }
  return authErrorResponse(error);
}

async function readWorkspaceMutation(request: Request): Promise<WorkspaceMutation> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new WorkspaceInputError(400, "Anmodningen kunne ikke læses.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceInputError(400, "Anmodningen er ugyldig.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.action !== "string") {
    throw new WorkspaceInputError(400, "Handlingen mangler.");
  }
  if (
    (input.action === "content.upsert" || input.action === "image.upsert") &&
    (!input.entry || typeof input.entry !== "object" || Array.isArray(input.entry))
  ) {
    throw new WorkspaceInputError(400, "Indholdet mangler eller er ugyldigt.");
  }
  if (input.action === "content.delete" && typeof input.id !== "string") {
    throw new WorkspaceInputError(400, "Indholds-id'et mangler.");
  }
  if (
    input.action === "approval.save" &&
    (typeof input.caseId !== "string" || !input.approval ||
      typeof input.approval !== "object" || Array.isArray(input.approval))
  ) {
    throw new WorkspaceInputError(400, "D-GITA-beslutningen mangler eller er ugyldig.");
  }
  if (
    input.action === "field-comment.add" &&
    (!input.comment || typeof input.comment !== "object" || Array.isArray(input.comment))
  ) {
    throw new WorkspaceInputError(400, "Feltkommentaren mangler eller er ugyldig.");
  }
  return value as WorkspaceMutation;
}
