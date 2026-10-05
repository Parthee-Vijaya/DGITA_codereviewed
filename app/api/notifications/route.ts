import { assertSameOrigin, authErrorResponse, noStoreJson } from "../../../features/auth/http";
import { requireActor } from "../../../features/auth/server";
import {
  listNotifications,
  markNotificationsRead,
  NotificationError,
} from "../../../features/notifications/server";

export async function GET(request: Request) {
  try {
    return noStoreJson(await listNotifications(await requireActor(request, { recordActivity: false })));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request);
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new NotificationError(400, "Anmodningen kunne ikke læses.");
    }
    return noStoreJson(await markNotificationsRead(actor, input));
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof NotificationError) {
    return noStoreJson({ error: error.message }, { status: error.status });
  }
  return authErrorResponse(error);
}
