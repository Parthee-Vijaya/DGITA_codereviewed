import { authErrorResponse, noStoreJson } from "../../../features/auth/http";
import { requireActor } from "../../../features/auth/server";
import { listApproversForActor } from "../../../features/application/approver-repository";

export async function GET(request: Request) {
  try {
    return noStoreJson({ approvers: await listApproversForActor(await requireActor(request)) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
