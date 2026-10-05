import { ReceiptError, type ReceiptKind } from "./server";

export function receiptKind(value: string | null | undefined): ReceiptKind {
  const kind = value ?? "submission";
  if (kind === "submission" || kind === "approval" || kind === "final") return kind;
  throw new ReceiptError(400, "Kvitteringstypen er ugyldig.");
}

export function receiptVersion(value: string | null | undefined) {
  if (value == null) return undefined;
  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(value)) throw new ReceiptError(400, "Versions-id er ugyldigt.");
  return value;
}
