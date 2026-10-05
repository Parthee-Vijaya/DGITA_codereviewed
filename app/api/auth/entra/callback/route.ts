import { readRuntimeEnvironment } from "../../../../../features/runtime/environment";
import { handleEntraCallback } from "../../../../../features/auth/oidc-server";

export async function GET(request: Request) {
  try { return await handleEntraCallback(request, await readRuntimeEnvironment()); }
  catch {
    return new Response(null, { status: 303, headers: {
      Location: "/login?entra=login-failed", "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer",
    } });
  }
}
