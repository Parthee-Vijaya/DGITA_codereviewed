export type GraphMailErrorCode =
  | "MAIL_CONFIGURATION_ERROR"
  | "MAIL_VALIDATION_ERROR"
  | "MAIL_RECIPIENT_NOT_ALLOWED"
  | "GRAPH_AUTHENTICATION_ERROR"
  | "GRAPH_SEND_ERROR"
  | "GRAPH_NETWORK_ERROR"
  | "GRAPH_TIMEOUT";

export type GraphMailStage = "configuration" | "validation" | "token" | "send";

type GraphMailErrorOptions = {
  stage: GraphMailStage;
  status?: number;
  retryable?: boolean;
  requestId?: string | null;
  providerCode?: string | null;
  retryAfterMs?: number | null;
  cause?: unknown;
};

export class GraphMailError extends Error {
  readonly code: GraphMailErrorCode;
  readonly stage: GraphMailStage;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly providerCode: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: GraphMailErrorCode,
    message: string,
    options: GraphMailErrorOptions,
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GraphMailError";
    this.code = code;
    this.stage = options.stage;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
    this.providerCode = options.providerCode ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export class GraphMailConfigurationError extends GraphMailError {
  constructor(message: string) {
    super("MAIL_CONFIGURATION_ERROR", message, { stage: "configuration" });
    this.name = "GraphMailConfigurationError";
  }
}

export class GraphMailValidationError extends GraphMailError {
  constructor(message: string) {
    super("MAIL_VALIDATION_ERROR", message, { stage: "validation" });
    this.name = "GraphMailValidationError";
  }
}

export class GraphMailDeliveryPolicyError extends GraphMailError {
  constructor() {
    super(
      "MAIL_RECIPIENT_NOT_ALLOWED",
      "Mailen blev blokeret: alle modtagere skal være eksplicit tilladt i dette miljø.",
      { stage: "validation", retryable: false },
    );
    this.name = "GraphMailDeliveryPolicyError";
  }
}

export function isGraphMailError(error: unknown): error is GraphMailError {
  return error instanceof GraphMailError;
}
