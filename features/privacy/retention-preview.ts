/** Pure proposal calculation. No persistence, deletion, provider or wall-clock access. */
export type RetentionReason =
  | "LEGAL_HOLD_ACTIVE" | "LEGAL_HOLD_UNKNOWN" | "LEGAL_HOLD_REVIEW_STALE"
  | "INVALID_TIME" | "POLICY_UNKNOWN" | "POLICY_NOT_APPROVED"
  | "POLICY_VERSION_MISMATCH" | "POLICY_NOT_EFFECTIVE" | "POLICY_INVALID"
  | "CLOSURE_NOT_EVIDENCED" | "CLASSIFICATION_NOT_COVERED"
  | "RETENTION_WINDOW_OPEN" | "REVIEW_REQUIRED" | "INVALID_INPUT";

export type RetentionPreview = {
  action: "blocked" | "retain" | "review_proposal";
  reason: RetentionReason;
  destructive: false;
  policyVersion?: string;
  eligibleAt?: string;
};

type DataRecord = Record<string, unknown>;
function record(value: unknown): DataRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // Input must be data, not getter-driven executable configuration.
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some((item) => !("value" in item))) return null;
  return value as DataRecord;
}
function own(value: DataRecord, key: string) { return Object.getOwnPropertyDescriptor(value, key)?.value as unknown; }
function instant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(value);
}
const blocked = (reason: RetentionReason): RetentionPreview => ({ action: "blocked", reason, destructive: false });

/**
 * The caller must obtain policy, closure and hold evidence from authorised sources.
 * Structurally valid input is not proof of municipal approval or current DB state.
 */
export function previewRetention(input: unknown): RetentionPreview {
  try { return calculate(input); } catch { return blocked("INVALID_INPUT"); }
}

function calculate(input: unknown): RetentionPreview {
  const request = record(input);
  if (!request) return blocked("INVALID_INPUT");
  const hold = record(own(request, "legalHold"));
  if (hold && own(hold, "state") === "active") return blocked("LEGAL_HOLD_ACTIVE");
  if (!hold || own(hold, "state") !== "clear") return blocked("LEGAL_HOLD_UNKNOWN");
  const now = instant(own(request, "now"));
  if (now === null) return blocked("INVALID_TIME");
  const reviewedAt = instant(own(hold, "reviewedAt"));
  const validUntil = instant(own(hold, "validUntil"));
  if (reviewedAt === null || validUntil === null || reviewedAt > now || validUntil <= now || reviewedAt >= validUntil) {
    return blocked("LEGAL_HOLD_REVIEW_STALE");
  }
  const policy = record(own(request, "policy"));
  if (!policy) return blocked("POLICY_UNKNOWN");
  const approval = record(own(policy, "approval"));
  if (!approval || own(approval, "state") !== "approved") return blocked("POLICY_NOT_APPROVED");
  const version = own(policy, "version");
  if (!identifier(version) || own(approval, "policyVersion") !== version) return blocked("POLICY_VERSION_MISMATCH");
  const approvedAt = instant(own(approval, "approvedAt"));
  const effectiveFrom = instant(own(policy, "effectiveFrom"));
  const effectiveUntil = instant(own(policy, "effectiveUntil"));
  if (own(policy, "schemaVersion") !== "dgita-retention-policy-v1" ||
      own(policy, "disposition") !== "review_only" || !identifier(own(approval, "decisionReference")) ||
      approvedAt === null || approvedAt > now || effectiveFrom === null || effectiveUntil === null || effectiveFrom >= effectiveUntil) {
    return blocked("POLICY_INVALID");
  }
  if (now < effectiveFrom || now >= effectiveUntil) return blocked("POLICY_NOT_EFFECTIVE");
  const inputRules = own(policy, "rules");
  if (!Array.isArray(inputRules) || inputRules.length < 1 || inputRules.length > 100) return blocked("POLICY_INVALID");
  const rules = new Map<string, number>();
  for (const candidate of inputRules) {
    const rule = record(candidate);
    if (!rule) return blocked("POLICY_INVALID");
    const classification = own(rule, "classification");
    const days = own(rule, "retainDaysAfterClosure");
    if (!identifier(classification) || rules.has(classification) ||
        typeof days !== "number" || !Number.isSafeInteger(days) || days < 0 || days > 36_525) return blocked("POLICY_INVALID");
    rules.set(classification, days);
  }
  const caseEvidence = record(own(request, "caseEvidence"));
  if (!caseEvidence || own(caseEvidence, "status") !== "closed") return blocked("CLOSURE_NOT_EVIDENCED");
  const closedAt = instant(own(caseEvidence, "closedAt"));
  const versionNumber = own(caseEvidence, "versionNumber");
  const snapshotSha256 = own(caseEvidence, "snapshotSha256");
  if (closedAt === null || closedAt > now || typeof versionNumber !== "number" ||
      !Number.isSafeInteger(versionNumber) || versionNumber < 1 ||
      typeof snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(snapshotSha256)) return blocked("CLOSURE_NOT_EVIDENCED");
  const classification = own(caseEvidence, "classification");
  if (!identifier(classification) || !rules.has(classification)) return blocked("CLASSIFICATION_NOT_COVERED");
  const eligibleTimestamp = closedAt + rules.get(classification)! * 86_400_000;
  const eligibleAt = new Date(eligibleTimestamp).toISOString();
  return {
    action: now >= eligibleTimestamp ? "review_proposal" : "retain",
    reason: now >= eligibleTimestamp ? "REVIEW_REQUIRED" : "RETENTION_WINDOW_OPEN",
    destructive: false, policyVersion: version, eligibleAt,
  };
}
