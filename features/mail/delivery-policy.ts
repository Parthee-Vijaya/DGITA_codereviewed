import { GraphMailConfigurationError, GraphMailDeliveryPolicyError } from "./errors";
import type { GraphMailEnvironment, MailDeliveryPolicy, OutgoingMail } from "./types";

/** Test environments must explicitly allow every real recipient before any network call. */
export function readMailDeliveryPolicy(environment: GraphMailEnvironment): MailDeliveryPolicy {
  const mode = environment.DGITA_ENVIRONMENT?.trim().toLowerCase() || "local";
  if (!["local", "pilot", "production"].includes(mode)) {
    throw new GraphMailConfigurationError("DGITA_ENVIRONMENT skal være local, pilot eller production.");
  }
  const raw = environment.DGITA_MAIL_ALLOWED_RECIPIENTS?.trim();
  if (!raw) return { allowedRecipients: mode === "production" ? null : [] };
  const recipients = [...new Set(raw.split(/[,;\r\n]+/u).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0 || recipients.length > 100 || recipients.some((address) => (
    address.length > 320 || /[\s*<>\u0000-\u001f\u007f]/u.test(address) || !/^[^@]+@[^@]+\.[^@]+$/u.test(address)
  ))) {
    throw new GraphMailConfigurationError("DGITA_MAIL_ALLOWED_RECIPIENTS skal indeholde højst 100 præcise mailadresser uden wildcards.");
  }
  return { allowedRecipients: recipients };
}

export function assertMailDeliveryAllowed(mail: OutgoingMail, policy?: MailDeliveryPolicy) {
  // A hand-built transport configuration without a policy must fail closed too.
  const allowed = policy?.allowedRecipients;
  if (allowed === null) return;
  const recipients = [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? []), ...(mail.replyTo ?? [])];
  if (!Array.isArray(allowed) || recipients.some((recipient) => !allowed.includes(recipient.address.trim().toLowerCase()))) {
    throw new GraphMailDeliveryPolicyError();
  }
}
