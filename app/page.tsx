import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getActorFromHeaders } from "../features/auth/server";
import { publicActor } from "../features/auth/types";
import { readRuntimeEnvironment } from "../features/runtime/environment";
import { permitsKlePreviewPage } from "../features/system-usage/preview-policy";
import { PortalClient } from "./PortalClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const requestHeaders = await headers();
  const [actor, environment] = await Promise.all([
    getActorFromHeaders(requestHeaders),
    readRuntimeEnvironment(),
  ]);
  if (!actor) redirect("/login");
  return <PortalClient initialViewer={publicActor(actor)}
    klePreviewEnabled={permitsKlePreviewPage(environment, requestHeaders.get("host"), actor.provider)} />;
}
