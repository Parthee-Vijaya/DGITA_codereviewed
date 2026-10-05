import {
  assertSameOrigin,
  authErrorResponse,
  getAuthEnvironment,
  noStoreJson,
  revokeSession,
} from "../../../../features/auth";
import { expiredSessionCookie } from "../../../../features/auth/primitives";

async function logout(request: Request) {
  let expiredCookie: string | null = null;
  try {
    const environment = await getAuthEnvironment();
    assertSameOrigin(request, environment);
    expiredCookie = expiredSessionCookie(request.url, environment);
    await revokeSession(request.headers.get("cookie"));
    return noStoreJson(
      { authenticated: false },
      { headers: { "Set-Cookie": expiredCookie } },
    );
  } catch (error) {
    const response = authErrorResponse(error);
    if (expiredCookie) {
      response.headers.set("Set-Cookie", expiredCookie);
    }
    return response;
  }
}

export const POST = logout;
export const DELETE = logout;
