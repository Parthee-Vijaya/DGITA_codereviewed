import { Check } from "lucide-react";
import type { CatalogSystem } from "./search";
import type { SelectedCatalogSystem } from "../application/engine";

export function CatalogResult({ system, onChoose }: { system: CatalogSystem; onChoose: () => void }) {
  const status = catalogStatus(system);
  return <div className="lookup-card catalog-result"><span>{initials(system.name)}</span><div><strong>{system.name}</strong><small>{system.supplier || system.rightsHolder || "Leverandør ikke angivet"}</small><em className={status.local ? "local" : "kitos"}>{status.label}</em></div><button type="button" onClick={onChoose} aria-label={`Vælg ${system.name}`}>Vælg</button></div>;
}

export function CatalogSelection({ system }: { system: SelectedCatalogSystem }) {
  const status = catalogStatus(system);
  return <div className="lookup-card catalog-selection"><span>{initials(system.name)}</span><div><strong>{system.name}</strong><small>{system.supplier || system.rightsHolder || "Leverandør ikke angivet"}</small><em className={status.local ? "local" : "kitos"}><Check size={12} /> Valgt · {status.label.toLocaleLowerCase("da-DK")}</em></div></div>;
}

function catalogStatus(system: Pick<CatalogSystem, "usedInKalundborg" | "localStatus" | "kitosStatus">) {
  if (system.usedInKalundborg && system.localStatus === "Ikke aktivt") {
    return { local: true, label: "Registreret i Kalundborg · ikke aktivt" };
  }
  if (system.usedInKalundborg && system.kitosStatus === "Ikke tilgængelig") {
    return { local: true, label: "Bruges i Kalundborg · KITOS ikke tilgængelig" };
  }
  if (system.usedInKalundborg) return { local: true, label: "Bruges i Kalundborg" };
  if (system.kitosStatus === "Ikke tilgængelig") {
    return { local: false, label: "Kun i KITOS · ikke tilgængelig" };
  }
  return { local: false, label: "Kun i KITOS" };
}

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
