import { readRuntimeEnvironment } from "../../../../../features/runtime/environment";
import { handleEntraStart } from "../../../../../features/auth/oidc-server";
import { noStoreJson } from "../../../../../features/auth/http";

export async function GET(request: Request) {
  try { return await handleEntraStart(request, await readRuntimeEnvironment()); }
  catch {
    return noStoreJson({ error: "Kommunens login kunne ikke startes. Brug portalens loginside eller kontakt administratoren." }, { status: 503 });
  }
}
