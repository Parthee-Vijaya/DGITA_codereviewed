import { assertSameOrigin, authErrorResponse, noStoreJson, readJsonObject } from "../../../../../features/auth/http";
import { getAuthEnvironment, requireActor } from "../../../../../features/auth/server";
import { expiredSessionCookie } from "../../../../../features/auth/primitives";
import { revokeUserSessions } from "../../../../../features/auth/session-administration";

export async function POST(request: Request) {
  try {
    const environment = await getAuthEnvironment();
    assertSameOrigin(request, environment);
    const actor = await requireActor(request);
    const body = await readJsonObject(request);
    if (Object.keys(body).some((key) => key !== "userId") ||
        ("userId" in body && typeof body.userId !== "string")) {
      return noStoreJson({ error: "Angiv kun brugerens id, eller send et tomt objekt for egne sessioner." }, { status: 400 });
    }
    const result = await revokeUserSessions(actor, "userId" in body ? body.userId as string : actor.userId);
    return noStoreJson(result, result.ownSessions ? { headers: { "Set-Cookie": expiredSessionCookie(request.url, environment) } } : {});
  } catch (error) { return authErrorResponse(error); }
}
