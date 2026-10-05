import { readRuntimeEnvironment } from "../../../../../features/runtime/environment";
import { noStoreJson } from "../../../../../features/auth/http";
import { isEntraOrigin, readEntraConfig } from "../../../../../features/auth/oidc";

export async function GET(request: Request) {
  const config = readEntraConfig(await readRuntimeEnvironment());
  // No credentials, issuer details or provisioned user information leave the server.
  return noStoreJson({ enabled: Boolean(config && isEntraOrigin(request, config)) });
}
