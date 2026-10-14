/** No source export date was supplied with the imported catalog. */
export const CATALOG_METADATA: { sourceUpdatedAt: string | null } = {
  sourceUpdatedAt: null,
};

export function catalogFreshnessLabel(metadata = CATALOG_METADATA): string {
  if (!metadata.sourceUpdatedAt) return "Katalogets opdateringsdato er ikke oplyst.";
  const date = new Date(metadata.sourceUpdatedAt);
  if (!Number.isFinite(date.getTime())) return "Katalogets opdateringsdato er ikke oplyst.";
  return `Katalogets kildedata er opdateret ${date.toLocaleDateString("da-DK", { timeZone: "UTC" })}.`;
}
