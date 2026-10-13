import { GraphMailError, GraphMailValidationError } from "./errors";
import { assertMailDeliveryAllowed } from "./delivery-policy";
import type {
  AcceptedMail,
  FetchLike,
  GraphMailConfig,
  GraphMailDependencies,
  MailAttachment,
  MailRecipient,
  MailTransport,
  OutgoingMail,
} from "./types";

type TokenResponse = {
  token_type?: unknown;
  expires_in?: unknown;
  access_token?: unknown;
  error?: unknown;
};

type CachedToken = {
  value: string;
  usableUntil: number;
};

type ProviderErrorBody = {
  error?: {
    code?: unknown;
  };
};

const MAX_GRAPH_JSON_BYTES = 64 * 1024;

/**
 * Server-side transport for Microsoft Graph's v1.0 sendMail action.
 *
 * Adapteren foretager bevidst ingen automatiske send-forsøg. Outbox,
 * idempotens og retry-politik skal ligge i workflowlaget, der kalder den.
 */
export class MicrosoftGraphMailTransport implements MailTransport {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private cachedToken: CachedToken | null = null;
  private tokenRequest: Promise<CachedToken> | null = null;

  constructor(
    private readonly config: GraphMailConfig,
    dependencies: GraphMailDependencies = {},
  ) {
    this.fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? Date.now;
  }

  async send(mail: OutgoingMail, options?: { beforeSend?: () => Promise<void> }): Promise<AcceptedMail> {
    const payload = graphPayload(mail);
    assertMailDeliveryAllowed(mail, this.config.deliveryPolicy);
    const token = await this.accessToken();
    const endpoint = `${this.config.graphBaseUrl}/users/${encodeURIComponent(
      this.config.sender,
    )}/sendMail`;

    // Revalidate workflow authority after any asynchronous token acquisition.
    // A rejected guard is preserved for the outbox's cancellation handling.
    await options?.beforeSend?.();

    let knownResponse: Response | undefined;
    let result: { response: Response; providerCode: string | null };
    try {
      result = await fetchWithTimeout(
        this.fetch,
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        this.config.timeoutMs,
        "send",
        async (response) => {
          knownResponse = response;
          if (response.status === 401) this.cachedToken = null;
          return {
            response,
            providerCode: response.status === 202 ? null : await providerErrorCode(response),
          };
        },
      );
    } catch (error) {
      // Once Graph has rejected the request, a stalled diagnostic body must
      // not turn that known HTTP outcome into an ambiguous send timeout.
      if (knownResponse && knownResponse.status !== 202) {
        throw graphSendError(knownResponse, null, this.now());
      }
      if (error instanceof GraphMailError) throw error;
      throw networkError("send", error);
    }

    const { response, providerCode } = result;
    if (response.status !== 202) {
      throw graphSendError(response, providerCode, this.now());
    }

    return {
      accepted: true,
      acceptedAt: new Date(this.now()).toISOString(),
      requestId: response.headers.get("request-id"),
    };
  }

  private async accessToken() {
    if (this.cachedToken && this.cachedToken.usableUntil > this.now()) {
      return this.cachedToken.value;
    }

    if (!this.tokenRequest) {
      this.tokenRequest = this.requestToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    this.cachedToken = await this.tokenRequest;
    return this.cachedToken.value;
  }

  private async requestToken(): Promise<CachedToken> {
    const endpoint = `${this.config.authorityHost}/${encodeURIComponent(
      this.config.tenantId,
    )}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
      scope: this.config.graphScope,
    });

    let tokenResult: { response: Response; result: TokenResponse | null };
    try {
      tokenResult = await fetchWithTimeout(
        this.fetch,
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
        this.config.timeoutMs,
        "token",
        async (response) => ({ response, result: await safeJson<TokenResponse>(response) }),
      );
    } catch (error) {
      if (error instanceof GraphMailError) throw error;
      throw networkError("token", error);
    }

    const { response, result } = tokenResult;
    if (!response.ok) {
      throw new GraphMailError(
        "GRAPH_AUTHENTICATION_ERROR",
        "Entra afviste Graph-legitimationsoplysningerne.",
        {
          stage: "token",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          requestId: response.headers.get("request-id"),
          providerCode: typeof result?.error === "string" ? result.error : null,
        },
      );
    }

    if (
      typeof result?.access_token !== "string" ||
      result.access_token.length === 0 ||
      typeof result.expires_in !== "number" ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0 ||
      (result.token_type !== undefined &&
        String(result.token_type).toLowerCase() !== "bearer")
    ) {
      throw new GraphMailError(
        "GRAPH_AUTHENTICATION_ERROR",
        "Entra returnerede et ugyldigt adgangstoken.",
        { stage: "token" },
      );
    }

    const lifetimeMs = result.expires_in * 1_000;
    const skewMs = Math.min(60_000, Math.max(1_000, lifetimeMs * 0.1));
    return {
      value: result.access_token,
      usableUntil: this.now() + Math.max(0, lifetimeMs - skewMs),
    };
  }
}

export function graphPayload(mail: OutgoingMail) {
  validateMail(mail);
  const message: Record<string, unknown> = {
    subject: mail.subject.trim(),
    body: {
      contentType: mail.body.contentType,
      content: mail.body.content,
    },
    toRecipients: recipients(mail.to),
  };

  if (mail.cc?.length) message.ccRecipients = recipients(mail.cc);
  if (mail.bcc?.length) message.bccRecipients = recipients(mail.bcc);
  if (mail.replyTo?.length) message.replyTo = recipients(mail.replyTo);
  if (mail.attachments?.length) {
    message.attachments = mail.attachments.map(graphAttachment);
  }

  return {
    message,
    ...(mail.saveToSentItems === false ? { saveToSentItems: false } : {}),
  };
}

async function fetchWithTimeout<T>(
  fetcher: FetchLike,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  stage: "token" | "send",
  consume: (response: Response) => Promise<T>,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(
        new GraphMailError("GRAPH_TIMEOUT", "Microsoft Graph svarede ikke i tide.", {
          stage,
          retryable: true,
        }),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }).then(consume),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof GraphMailError) throw error;
    throw networkError(stage, error);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function validateMail(mail: OutgoingMail) {
  if (!mail.subject?.trim()) {
    throw new GraphMailValidationError("Mailen skal have et emne.");
  }
  if (!mail.body || !["Text", "HTML"].includes(mail.body.contentType)) {
    throw new GraphMailValidationError("Mailen har en ugyldig indholdstype.");
  }
  if (typeof mail.body.content !== "string") {
    throw new GraphMailValidationError("Mailens indhold mangler.");
  }

  if (
    !Array.isArray(mail.to) ||
    (mail.cc !== undefined && !Array.isArray(mail.cc)) ||
    (mail.bcc !== undefined && !Array.isArray(mail.bcc)) ||
    (mail.replyTo !== undefined && !Array.isArray(mail.replyTo)) ||
    (mail.attachments !== undefined && !Array.isArray(mail.attachments))
  ) {
    throw new GraphMailValidationError("Mailens modtager- eller bilagsliste er ugyldig.");
  }

  const allRecipients = [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])];
  if (allRecipients.length === 0) {
    throw new GraphMailValidationError("Mailen skal have mindst én modtager.");
  }
  for (const recipient of [
    ...allRecipients,
    ...(mail.replyTo ?? []),
  ]) {
    validateRecipient(recipient);
  }
  for (const attachment of mail.attachments ?? []) validateAttachment(attachment);
}

function validateRecipient(recipient: MailRecipient) {
  const address = recipient.address?.trim();
  if (
    !address ||
    address.length > 320 ||
    /[\u0000-\u001f\u007f\s]/u.test(address) ||
    !/^[^@]+@[^@]+$/u.test(address)
  ) {
    throw new GraphMailValidationError("Mailen indeholder en ugyldig modtager.");
  }
}

function validateAttachment(attachment: MailAttachment) {
  if (!attachment.name?.trim() || !attachment.contentType?.trim()) {
    throw new GraphMailValidationError("Et bilag mangler navn eller indholdstype.");
  }
  if (
    !attachment.contentBytes ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(attachment.contentBytes) ||
    attachment.contentBytes.length % 4 !== 0
  ) {
    throw new GraphMailValidationError("Et bilag har ugyldigt base64-indhold.");
  }
}

function recipients(values: readonly MailRecipient[]) {
  return values.map((recipient) => ({
    emailAddress: {
      address: recipient.address.trim(),
      ...(recipient.name?.trim() ? { name: recipient.name.trim() } : {}),
    },
  }));
}

function graphAttachment(attachment: MailAttachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.name.trim(),
    contentType: attachment.contentType.trim(),
    contentBytes: attachment.contentBytes,
    ...(attachment.isInline === undefined
      ? {}
      : { isInline: attachment.isInline }),
    ...(attachment.contentId?.trim()
      ? { contentId: attachment.contentId.trim() }
      : {}),
  };
}

function networkError(stage: "token" | "send", cause: unknown) {
  return new GraphMailError(
    "GRAPH_NETWORK_ERROR",
    "Der kunne ikke oprettes forbindelse til Microsofts mailtjenester.",
    { stage, retryable: true, cause },
  );
}

async function safeJson<T>(response: Response): Promise<T | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GRAPH_JSON_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function providerErrorCode(response: Response) {
  const result = await safeJson<ProviderErrorBody>(response);
  return typeof result?.error?.code === "string" ? result.error.code : null;
}

function graphSendError(response: Response, providerCode: string | null, now: number) {
  return new GraphMailError("GRAPH_SEND_ERROR", "Microsoft Graph afviste mailen.", {
    stage: "send",
    status: response.status,
    retryable: isRetryableStatus(response.status),
    requestId: response.headers.get("request-id"),
    providerCode,
    retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after"), now),
  });
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMilliseconds(value: string | null, now: number) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(24 * 60 * 60_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(24 * 60 * 60_000, Math.max(0, date - now));
}
