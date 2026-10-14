import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getActorFromHeaders } from "../../../features/auth/server";
import { readRuntimeEnvironment } from "../../../features/runtime/environment";
import { permitsKlePreview } from "../../../features/system-usage/preview-policy";
import { listSystemUsages } from "../../../features/system-usage/repository";
import { KleUsagePreview } from "../../../features/system-usage/KleUsagePreview";

export const dynamic = "force-dynamic";
export const metadata = { title: "KLE og systemanvendelse · D-GITA", robots: { index: false, follow: false } };

export default async function KlePreviewPage() {
  const environment = await readRuntimeEnvironment();
  const requestHeaders = await headers();
  if (!permitsKlePreview(environment, environment.DGITA_APP_ORIGIN ?? "") ||
      requestHeaders.get("host") !== new URL(environment.DGITA_APP_ORIGIN!).host) notFound();
  const actor = await getActorFromHeaders(requestHeaders);
  if (!actor) redirect("/login");
  if (actor.provider !== "dev") notFound();
  return <KleUsagePreview initialUsages={await listSystemUsages(actor)} />;
}
