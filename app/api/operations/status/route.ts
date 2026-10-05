import { authErrorResponse, noStoreJson } from "../../../../features/auth/http";
import { getActorFromHeaders } from "../../../../features/auth/server";
import { readOperationsStatus } from "../../../../features/operations/status";
import { readRuntimeEnvironment } from "../../../../features/runtime/environment";
import { preparePortalData } from "../../../../features/workspace/server-repository";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await getActorFromHeaders(request.headers);
    if (!actor) return noStoreJson({ code: "AUTH_REQUIRED", error: "Login er påkrævet." }, { status: 401 });
    const DB = await preparePortalData();
    return noStoreJson(await readOperationsStatus(DB, actor, await readRuntimeEnvironment()));
  } catch (error) { return authErrorResponse(error); }
}
