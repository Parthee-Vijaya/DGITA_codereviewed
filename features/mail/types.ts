export type MailContentType = "Text" | "HTML";

export type MailRecipient = {
  address: string;
  name?: string;
};

export type MailAttachment = {
  name: string;
  contentType: string;
  /** Base64 uden data-URL-prefix. */
  contentBytes: string;
  isInline?: boolean;
  contentId?: string;
};

export type OutgoingMail = {
  subject: string;
  body: {
    contentType: MailContentType;
    content: string;
  };
  to: readonly MailRecipient[];
  cc?: readonly MailRecipient[];
  bcc?: readonly MailRecipient[];
  replyTo?: readonly MailRecipient[];
  attachments?: readonly MailAttachment[];
  /** Microsoft Graph gemmer som standard en kopi i Sendt post. */
  saveToSentItems?: boolean;
};

export type AcceptedMail = {
  accepted: true;
  acceptedAt: string;
  requestId: string | null;
};

export type GraphMailConfig = {
  tenantId: string;
  clientId: string;
  /** Serverhemmelighed. Må aldrig serialiseres eller logges. */
  clientSecret: string;
  sender: string;
  authorityHost: string;
  graphBaseUrl: string;
  graphScope: string;
  timeoutMs: number;
  deliveryPolicy: MailDeliveryPolicy;
};

export type MailDeliveryPolicy = {
  /** null is unrestricted production delivery; an empty list blocks every recipient. */
  allowedRecipients: readonly string[] | null;
};

export type GraphMailEnvironment = Record<string, string | undefined>;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GraphMailDependencies = {
  fetch?: FetchLike;
  now?: () => number;
};

export interface MailTransport {
  send(mail: OutgoingMail, options?: { beforeSend?: () => Promise<void> }): Promise<AcceptedMail>;
}
