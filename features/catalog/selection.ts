import catalogData from "./data/system-catalog.json";
import { RELATION_FIELDS, catalogEntryRevision, relationError, type RelationField } from "./relations";
import type { CatalogSystem } from "./search";
import type { ApplicationFormState, SelectedCatalogSystem } from "../application/engine";

const systems = new Map((catalogData as CatalogSystem[]).map((system) => [system.id, system]));

export function canonicalCatalogSelection(state: ApplicationFormState, options: { validateRelations?: boolean } = {}): ApplicationFormState {
  if (options.validateRelations) validateCatalogRelations(state);
  if (!state.selectedSystem) return state;
  const system = systems.get(state.selectedSystem.id);
  if (!system) throw new Error("Det valgte system findes ikke i KITOS-kataloget. Søg og vælg systemet igen.");
  const { id, name, supplier, rightsHolder, source, usedInKalundborg, localSystemId, localStatus, kitosStatus } = system;
  const selectedSystem: SelectedCatalogSystem = {
    id, name, supplier, rightsHolder, source, usedInKalundborg,
    ...(localSystemId ? { localSystemId } : {}),
    ...(localStatus ? { localStatus } : {}),
    ...(kitosStatus ? { kitosStatus } : {}),
  };
  // The local-use metadata is authoritative; the applicant's separate answer
  // about the intended procurement remains an explicit, editable answer.
  return { ...state, selectedSystem, catalogQuery: name, existsInKitos: "ja" };
}

function validateCatalogRelations(state: ApplicationFormState): void {
  for (const field of Object.keys(RELATION_FIELDS) as RelationField[]) {
    const active = field === "replacementSystem" ? state.replacesExisting === "ja" : state.acquisitionType === "tilkøb";
    if (!active) continue;
    const problem = relationError(state, field);
    const title = field === "replacementSystem" ? "Systemet, der erstattes" : "Systemet, tilkøbet vedrører";
    if (problem) throw new Error(`${title}: ${problem}`);
    const relation = state[RELATION_FIELDS[field]];
    if (relation?.kind !== "catalog") continue;
    const system = systems.get(relation.id);
    if (!system || relation.name !== system.name || relation.revision !== catalogEntryRevision(system)) {
      throw new Error(`${title}: Katalogposten er ændret eller findes ikke længere. Søg og vælg systemet igen, eller registrér det manuelt med en begrundelse.`);
    }
  }
}
