import type { ApplicationFormState } from "../application/engine";
import type { CatalogSystem } from "./search";

/** Additive fields: old snapshots retain their original free-text answers. */
export type CatalogRelation =
  | { kind: "catalog"; id: string; name: string; revision: string }
  | { kind: "manual"; reason: string };

export type RelationField = "replacementSystem" | "relatedSystem";
export const RELATION_FIELDS = {
  replacementSystem: "replacementCatalogRelation",
  relatedSystem: "relatedCatalogRelation",
} as const;

/** Change detection only, never an authorization token or a publication date. */
export function catalogEntryRevision(system: CatalogSystem): string {
  const input = JSON.stringify([
    system.id, system.name, system.supplier, system.rightsHolder, system.source,
    system.usedInKalundborg, system.localSystemId ?? "", system.localStatus ?? "", system.kitosStatus ?? "",
  ]);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return `entry-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function relationFromSystem(system: CatalogSystem): CatalogRelation {
  return { kind: "catalog", id: system.id, name: system.name, revision: catalogEntryRevision(system) };
}

export function clearCatalogRelations(state: ApplicationFormState): ApplicationFormState {
  return { ...state, replacementSystem: "", replacementCatalogRelation: null, relatedSystem: "", relatedCatalogRelation: null };
}

/** Changing a controlling choice must not resurrect an obsolete answer later. */
export function normalizeRelationChanges(previous: ApplicationFormState, next: ApplicationFormState): ApplicationFormState {
  let result = next;
  if (
    previous.knownSystem !== next.knownSystem ||
    previous.manualCatalogEntry !== next.manualCatalogEntry ||
    (Boolean(previous.selectedSystem) && previous.selectedSystem?.id !== next.selectedSystem?.id)
  ) result = clearCatalogRelations(result);
  if (next.replacesExisting !== "ja") result = { ...result, replacementSystem: "", replacementCatalogRelation: null };
  if (previous.acquisitionType !== next.acquisitionType || next.acquisitionType !== "tilkøb") {
    result = { ...result, relatedSystem: "", relatedCatalogRelation: null };
  }
  return result;
}

export function relationError(state: ApplicationFormState, field: RelationField): string | null {
  const relation = state[RELATION_FIELDS[field]];
  if (!state[field].trim()) return "Angiv systemet ved at vælge i kataloget eller registrere det manuelt.";
  if (!relation) return "Dette svar er kun gemt som tekst. Vælg systemet i kataloget, eller vælg manuel registrering og begrund, hvorfor det ikke kan findes.";
  if (relation.kind === "manual") return relation.reason.trim() ? null : "Begrund, hvorfor systemet registreres manuelt.";
  if (!relation.id || !relation.revision || relation.name !== state[field]) return "Katalogvalget og systemnavnet stemmer ikke overens. Søg og vælg systemet igen.";
  return null;
}
