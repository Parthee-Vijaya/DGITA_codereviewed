import { authErrorResponse, noStoreJson } from "../../../../features/auth/http";
import { requireActor } from "../../../../features/auth/server";
import { listResponsiblePeopleForActor, PortalAccessError } from "../../../../features/workspace/server-repository";

export async function GET(request: Request) {
  try {
    return noStoreJson({ people: await listResponsiblePeopleForActor(await requireActor(request)) });
  } catch (error) {
    if (error instanceof PortalAccessError) return noStoreJson({ error: error.message }, { status: error.status });
    return authErrorResponse(error);
  }
}
