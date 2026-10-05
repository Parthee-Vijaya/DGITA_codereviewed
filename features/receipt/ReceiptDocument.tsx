import { formatReceiptDate, type ReceiptView } from "./view-model";

export function ReceiptDocument({ receipt }: { receipt: ReceiptView }) {
  const query = new URLSearchParams({ kind: receipt.kind, version: receipt.applicationVersionId });
  const pdfHref = `/api/cases/${encodeURIComponent(receipt.caseNumber)}/receipt?${query}`;
  return (
    <main className="receipt-document" lang="da-DK">
      <nav aria-label="Kvitteringshandlinger"><a href={`/?case=${encodeURIComponent(receipt.caseNumber)}`}>Tilbage til sagen</a><a href={pdfHref}>Hent {receipt.title.toLocaleLowerCase("da-DK")} som PDF</a></nav>
      <header><p>D-GITA · Versionslåst ansøgning</p><h1>{receipt.title}</h1>
        <dl><div><dt>Sagsnummer</dt><dd>{receipt.caseNumber}</dd></div><div><dt>Version</dt><dd>{receipt.versionNumber}</dd></div><div><dt>Indsendt</dt><dd><time dateTime={receipt.submittedAt}>{formatReceiptDate(receipt.submittedAt)}</time></dd></div></dl>
      </header>
      {receipt.decision ? <section aria-labelledby="receipt-decision"><h2 id="receipt-decision">{receipt.decision.label}</h2><dl>
        <div><dt>Beslutning</dt><dd>{receipt.decision.outcome}</dd></div><div><dt>Behandlet af</dt><dd>{receipt.decision.name}</dd></div>
        <div><dt>Besluttet</dt><dd>{formatReceiptDate(receipt.decision.decidedAt)}</dd></div>
        {receipt.decision.comment ? <div><dt>Bemærkning</dt><dd>{receipt.decision.comment}</dd></div> : null}
      </dl></section> : null}
      {receipt.sections.map((section, index) => <section key={section.title} aria-labelledby={`receipt-section-${index}`}><h2 id={`receipt-section-${index}`}>{section.title}</h2><dl>{section.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Ikke oplyst"}</dd></div>)}</dl></section>)}
      <footer><h2>Versionskontrol</h2><p>Indholdet følger den indsendte sagsversion. Visningens layout kan forbedres uden at ændre sagens oplysninger. Den eksisterende PDF bevares som særskilt kvittering.</p><dl><div><dt>Versions-id</dt><dd>{receipt.applicationVersionId}</dd></div><div><dt>Kontrolsum for sagsversion (SHA-256)</dt><dd>{receipt.snapshotSha256}</dd></div></dl></footer>
    </main>
  );
}
