import { authErrorResponse } from "../../../../../features/auth/http";
import { requireActor } from "../../../../../features/auth/server";
import {
  getOrCreateReceipt,
  ReceiptError,
} from "../../../../../features/receipt/server";

import { receiptKind, receiptVersion } from "../../../../../features/receipt/request";

export async function GET(
  request: Request,
  context: { params: Promise<{ caseNumber: string }> },
) {
  try {
    const actor = await requireActor(request);
    const { caseNumber } = await context.params;
    const params = new URL(request.url).searchParams;
    const kind = receiptKind(params.get("kind"));
    const version = receiptVersion(params.get("version"));
    const receipt = await getOrCreateReceipt(actor, caseNumber, kind, version);
    const body = Uint8Array.from(receipt.bytes).buffer;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/pdf",
        "Content-Length": String(receipt.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${receipt.filename}"`,
        "X-Content-Type-Options": "nosniff",
        ...(receipt.checksum ? { "X-Content-SHA256": receipt.checksum } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ReceiptError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return authErrorResponse(error);
  }
}
