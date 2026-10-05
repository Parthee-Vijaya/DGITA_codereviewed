import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getActorFromHeaders } from "../../../../features/auth/server";
import { ReceiptDocument } from "../../../../features/receipt/ReceiptDocument";
import { receiptKind, receiptVersion } from "../../../../features/receipt/request";
import { ReceiptError } from "../../../../features/receipt/server";
import { getReceiptView } from "../../../../features/receipt/view-server";
import "../../../../features/receipt/receipt.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "D-GITA · Kvittering", robots: { index: false, follow: false, noarchive: true } };

export default async function ReceiptPage({ params, searchParams }: {
  params: Promise<{ caseNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActorFromHeaders(await headers());
  if (!actor) redirect("/login");
  const { caseNumber } = await params;
  const search = await searchParams;
  let receipt;
  try {
    if (Array.isArray(search.kind) || Array.isArray(search.version)) throw new ReceiptError(400, "Ugyldig kvitteringsadresse.");
    const kind = receiptKind(search.kind);
    const version = receiptVersion(search.version);
    receipt = await getReceiptView(actor, caseNumber, kind, version);
    if (!version) redirect(`/cases/${encodeURIComponent(caseNumber)}/receipt?${new URLSearchParams({ kind, version: receipt.applicationVersionId })}`);
  } catch (error) {
    if (error instanceof ReceiptError) notFound();
    throw error;
  }
  return <ReceiptDocument receipt={receipt} />;
}
