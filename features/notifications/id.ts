const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NAMESPACED_ID_PATTERN =
  /^[a-z][a-z0-9._-]{0,47}:[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/u;
const UUID_RECIPIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/iu;

export function isSafeNotificationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    (UUID_PATTERN.test(value) || NAMESPACED_ID_PATTERN.test(value) || UUID_RECIPIENT_ID_PATTERN.test(value))
  );
}
