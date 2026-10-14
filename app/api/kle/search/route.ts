import { assertSameOrigin, authErrorResponse, noStoreJson, readJsonObject, AuthHttpError } from "../../../../features/auth/http";
import { requireActor } from "../../../../features/auth/server";
import { previewKleProvider } from "../../../../features/kle/provider";
import { readKleSearchParameters } from "../../../../features/kle/search-request";
import { readRuntimeEnvironment } from "../../../../features/runtime/environment";
import { assertKlePreview } from "../../../../features/system-usage/preview-policy";

/** POST keeps search terms out of URLs and ordinary access logs. */
export async function POST(request: Request) {
  try {
    const environment = await readRuntimeEnvironment();
    assertKlePreview(environment, request.url);
    assertSameOrigin(request, environment);
    const actor = await requireActor(request);
    if (actor.provider !== "dev") throw new AuthHttpError(403, "PREVIEW_IDENTITY_REQUIRED", "Afprøvningen kræver en lokal testbruger.");
    const parameters = readKleSearchParameters(await readJsonObject(request));
    return noStoreJson(previewKleProvider.search(parameters));
  } catch (error) { return authErrorResponse(error); }
}
