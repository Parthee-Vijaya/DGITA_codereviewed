import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getActorFromHeaders } from "../../../features/auth/server";
import { readRuntimeEnvironment } from "../../../features/runtime/environment";
import { permitsKlePreviewPage } from "../../../features/system-usage/preview-policy";
import { listSystemUsages } from "../../../features/system-usage/repository";
import { KleUsagePreview } from "../../../features/system-usage/KleUsagePreview";

export const dynamic = "force-dynamic";
export const metadata = { title: "KLE og systemanvendelse · D-GITA", robots: { index: false, follow: false } };

export default async function KlePreviewPage() {
  const environment = await readRuntimeEnvironment();
  const requestHeaders = await headers();
  if (!permitsKlePreviewPage(environment, requestHeaders.get("host"), "dev")) notFound();
  const actor = await getActorFromHeaders(requestHeaders);
  if (!actor) redirect("/login");
  if (!permitsKlePreviewPage(environment, requestHeaders.get("host"), actor.provider)) notFound();
  return <KleUsagePreview initialUsages={await listSystemUsages(actor)} />;
}
