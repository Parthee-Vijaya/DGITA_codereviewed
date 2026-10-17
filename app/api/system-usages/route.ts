import { ApplicationRepositoryError } from "../../../features/application/repository-support";
import { assertSameOrigin, authErrorResponse, noStoreJson, readJsonObject, AuthHttpError } from "../../../features/auth/http";
import { requireActor } from "../../../features/auth/server";
import { readRuntimeEnvironment } from "../../../features/runtime/environment";
import { assertKlePreview } from "../../../features/system-usage/preview-policy";
import { createSystemUsage, getSystemUsage, listSystemUsages, saveSystemUsage } from "../../../features/system-usage/repository";

async function previewActor(request: Request) {
  const environment = await readRuntimeEnvironment();
  assertKlePreview(environment, request.url);
  assertSameOrigin(request, environment);
  const actor = await requireActor(request);
  if (actor.provider !== "dev") throw new AuthHttpError(403, "PREVIEW_IDENTITY_REQUIRED", "Afprøvningen kræver en testbruger.");
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await previewActor(request);
    const id = new URL(request.url).searchParams.get("id");
    return noStoreJson(id ? { usage: await getSystemUsage(actor, id) } : { usages: await listSystemUsages(actor) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await previewActor(request);
    const body = await readJsonObject(request);
    if (Object.keys(body).some((key) => !["action", "id", "name", "review", "expectedRowVersion"].includes(key)) ||
        typeof body.name !== "string") {
      throw new AuthHttpError(400, "INVALID_USAGE", "Systemanvendelsen indeholder ugyldige oplysninger.");
    }
    if (body.action === "create" && typeof body.id === "string" && body.expectedRowVersion === undefined) {
      return noStoreJson({ usage: await createSystemUsage(actor, { id: body.id, name: body.name, review: body.review }) }, { status: 201 });
    }
    if ((body.action === "save" || body.action === "confirm") && typeof body.id === "string" &&
        Number.isSafeInteger(body.expectedRowVersion) && (body.expectedRowVersion as number) >= 1) {
      return noStoreJson({ usage: await saveSystemUsage(actor, body.id, {
        name: body.name, review: body.review, expectedRowVersion: body.expectedRowVersion as number, confirm: body.action === "confirm",
      }) });
    }
    throw new AuthHttpError(400, "INVALID_USAGE", "Vælg en gyldig handling og version.");
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof ApplicationRepositoryError) return noStoreJson({ error: error.message }, { status: error.status });
  return authErrorResponse(error);
}
