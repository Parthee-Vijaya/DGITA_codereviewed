import type { ApplicationFormState } from "../application/engine";
import { contractCoverageLabel, contractValueStatusLabel, parseContractValue } from "../application/procurement";

/** Public application facts only; the separate internal assessments are never projected here. */
export function procurementSummaryRows(state: ApplicationFormState): Array<[string, string]> {
  const value = state.contractValueStatus === "estimated" ? parseContractValue(state.estimatedContractValueExVat ?? "") : null;
  const rows: Array<[string, string]> = [
    ["Kontraktværdi · afklaring", contractValueStatusLabel(state.contractValueStatus)],
    ["Aftaleform", contractCoverageLabel(state.contractCoverage)],
  ];
  if (state.contractValueStatus === "estimated") {
    rows.push(
      ["Anslået kontraktværdi ekskl. moms", value === null ? "Ikke oplyst" : `${new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} kr.`],
      ["Aftaleperiode", state.contractDurationMonths ? `${state.contractDurationMonths} måneder` : "Ikke oplyst"],
      ["Optioner og forlængelser", state.contractOptionsDescription || "Ikke oplyst"],
      ["Grundlag for værdianslaget", state.contractValueNote || "Ikke oplyst"],
    );
  }
  if (state.contractCoverage === "existing-agreement") rows.push(["Reference til eksisterende aftale", state.agreementReference || "Ikke oplyst"]);
  return rows;
}
