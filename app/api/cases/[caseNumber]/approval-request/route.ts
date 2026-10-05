import { applicationOrigin, assertSameOrigin, authErrorResponse, noStoreJson, readJsonObject } from "../../../../../features/auth/http";
import { requireActor } from "../../../../../features/auth/server";
import {
  ApprovalWorkflowError,
  createLeaderApprovalRequest,
} from "../../../../../features/approval/server";
import { revokeLeaderApprovalRequest } from "../../../../../features/approval/revocation";

export async function POST(
  request: Request,
  context: { params: Promise<{ caseNumber: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request);
    const { caseNumber } = await context.params;
    return noStoreJson(
      await createLeaderApprovalRequest(actor, caseNumber, applicationOrigin(request)),
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) {
      return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ caseNumber: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request);
    const body = await readJsonObject(request);
    if (typeof body.requestId !== "string" || Object.keys(body).some((key) => key !== "requestId")) {
      return noStoreJson({ error: "Angiv id på det godkendelseslink, der skal tilbagekaldes." }, { status: 400 });
    }
    const { caseNumber } = await context.params;
    return noStoreJson(await revokeLeaderApprovalRequest(actor, caseNumber, body.requestId));
  } catch (error) {
    if (error instanceof ApprovalWorkflowError) return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
    return authErrorResponse(error);
  }
}
