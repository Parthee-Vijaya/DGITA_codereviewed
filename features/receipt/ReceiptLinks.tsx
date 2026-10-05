import { Download, FileText } from "lucide-react";

export function ReceiptLinks({ caseNumber, submitted, approved, closed }: { caseNumber: string; submitted: boolean; approved: boolean; closed: boolean }) {
  const encoded = encodeURIComponent(caseNumber);
  const latestKind = closed ? "final" : approved ? "approval" : "submission";
  return <>
    {submitted ? <><a className="line-button" href={`/cases/${encoded}/receipt?kind=${latestKind}`}><FileText size={17} aria-hidden="true" /> Læs kvittering (HTML)</a><a className="line-button" href={`/api/cases/${encoded}/receipt?kind=submission`}><Download size={17} aria-hidden="true" /> Indsendelseskvittering</a></> : <button className="line-button" type="button" disabled title="Kvitteringen oprettes, når ansøgningen er indsendt"><Download size={17} aria-hidden="true" /> Indsendelseskvittering</button>}
    {approved ? <a className="line-button" href={`/api/cases/${encoded}/receipt?kind=approval`}><Download size={17} aria-hidden="true" /> Godkendelseskvittering</a> : null}
    {closed ? <a className="line-button" href={`/api/cases/${encoded}/receipt?kind=final`}><Download size={17} aria-hidden="true" /> Slutkvittering</a> : null}
  </>;
}
