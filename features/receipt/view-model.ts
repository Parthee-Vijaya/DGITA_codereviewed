import type { ReceiptKind } from "./server";
import type { ApplicationFormState } from "../application/engine";
import { receiptSections } from "./content";

export type ReceiptView = {
  formatVersion: "receipt-html-v1";
  caseNumber: string;
  kind: ReceiptKind;
  title: string;
  applicationVersionId: string;
  versionNumber: number;
  snapshotSha256: string;
  submittedAt: string;
  decision: null | { label: string; outcome: string; name: string; comment: string; decidedAt: string };
  sections: Array<{ title: string; rows: Array<[string, string]> }>;
};

export type ReceiptViewSource = {
  case_number: string;
  receipt_version_id: string;
  receipt_version_number: number;
  snapshot_json: string;
  snapshot_sha256: string;
  submitted_at: string;
  approval_status: "approved" | "rejected" | null;
  approver_name: string | null;
  decision_comment: string | null;
  decided_at: string | null;
  dgita_status: string | null;
  dgita_reviewer_snapshot: string | null;
  dgita_comment: string | null;
  dgita_decided_at: string | null;
};

/** Projects only the immutable version and committed decision. No mutable
 * profile name, internal reviewer fields, session or storage key is exposed. */
export function createReceiptView(source: ReceiptViewSource, kind: ReceiptKind): ReceiptView {
  const state = JSON.parse(source.snapshot_json) as ApplicationFormState;
  if (state.schemaVersion !== "dgita-v1") throw new Error("Unsupported receipt schema");
  const title = kind === "final" ? "Afsluttende kvittering" : kind === "approval" ? "Godkendelseskvittering" : "Indsendelseskvittering";
  const status = kind === "approval" ? source.approval_status : source.dgita_status;
  if (kind !== "submission" && !["approved", "rejected"].includes(status ?? "")) throw new Error("Receipt decision is not final");
  return {
    formatVersion: "receipt-html-v1", caseNumber: source.case_number, kind, title,
    applicationVersionId: source.receipt_version_id, versionNumber: source.receipt_version_number,
    snapshotSha256: source.snapshot_sha256, submittedAt: source.submitted_at,
    decision: kind === "submission" ? null : {
      label: kind === "approval" ? "Leders beslutning" : "Endelig D-GITA-beslutning",
      outcome: status === "approved" ? "Godkendt" : "Afvist",
      name: (kind === "approval" ? source.approver_name : source.dgita_reviewer_snapshot) || "Ikke registreret i beslutningen",
      comment: (kind === "approval" ? source.decision_comment : source.dgita_comment) || "",
      decidedAt: (kind === "approval" ? source.decided_at : source.dgita_decided_at) || "",
    },
    sections: receiptSections(state),
  };
}

export function formatReceiptDate(value: string) {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? "Ikke registreret" : new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(date);
}
