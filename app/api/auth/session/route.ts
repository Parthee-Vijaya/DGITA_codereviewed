import {
  authErrorResponse,
  getActor,
  getAuthEnvironment,
  noStoreJson,
  publicActor,
} from "../../../../features/auth";
import {
  devLoginPolicy,
  parseCookie,
  SESSION_COOKIE_NAME,
  expiredSessionCookie,
} from "../../../../features/auth/primitives";
import type { SessionResponse } from "../../../../features/auth/types";

export async function GET(request: Request) {
  try {
    const environment = await getAuthEnvironment();
    const actor = await getActor(request);
    const devPolicy = devLoginPolicy(request.url, environment);
    const devLoginAccessCodeRequired =
      devPolicy.accessCodeRequired && actor?.provider !== "dev";
    const response: SessionResponse = actor
      ? {
          authenticated: true,
          viewer: publicActor(actor),
          devLoginEnabled: devPolicy.enabled,
          devLoginAccessCodeRequired,
        }
      : {
          authenticated: false,
          devLoginEnabled: devPolicy.enabled,
          devLoginAccessCodeRequired,
        };
    const hadCookie = parseCookie(
      request.headers.get("cookie"),
      SESSION_COOKIE_NAME,
    );
    return noStoreJson(response, {
      headers:
        !actor && hadCookie
          ? { "Set-Cookie": expiredSessionCookie(request.url, environment) }
          : undefined,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
