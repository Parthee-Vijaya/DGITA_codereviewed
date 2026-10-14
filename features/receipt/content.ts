import type { ApplicationFormState } from "../application/engine";
import { personalDataCategoryLabels } from "../application/procurement";
import { procurementSummaryRows } from "../cases/procurement-summary";
import { aiUsageLabel, hasAiScreeningDetails, isSafeAiAssessmentUrl } from "../application/ai-screening";

export function receiptSections(state: ApplicationFormState) {
  return [
    {
      title: "System og ansvar",
      rows: [
        ["System", displaySystem(state)],
        ["Forretningsområde", state.businessType],
        ["Beskrivelse", state.systemDescription],
        ["Leverandør", state.supplier],
        ["Rettighedshaver", state.rightsHolder],
        ["Kontaktperson", state.contactPerson],
        ["Afdeling", state.department],
        ["Dataejer", state.dataOwner],
        ["Systemejer", state.systemOwner],
      ],
    },
    {
      title: "Anskaffelse og formål",
      rows: [
        ["Anskaffelsesmetode", state.acquisitionMethod],
        ["Anskaffelsestype", state.acquisitionType === "tilkøb" ? "Tilkøb" : "Nyanskaffelse"],
        ["Formål", state.purpose],
        ["Funktionalitet", state.functionDescription],
        ["Tværgående", yesNo(state.crossCutting)],
        ["Berørte enheder", state.crossDepartments.join(", ")],
        ["Gevinster", state.benefits],
      ],
    },
    {
      title: "Økonomi og implementering",
      rows: [
        ["Budget til rådighed", yesNo(state.hasBudget)],
        ["Budgetbeløb for første år", money(state.budgetAmount)],
        ["Engangsomkostning", money(state.oneTimeCost)],
        ["Årlig omkostning", money(state.yearlyCost)],
        ["Øvrige omkostninger", money(state.otherCost)],
        ...procurementSummaryRows(state),
        ["Startdato", state.startDate],
        ["Slutdato", state.endDate],
        ["Antal brugere", state.implementationUsers],
        ["Ressourcer", state.implementationResources],
      ],
    },
    {
      title: "Data, risiko og dokumentation",
      rows: [
        ["Personoplysninger", yesNo(state.personalData)],
        ["Dataklassifikation", state.dataClassification],
        ["Personoplysningskategorier", state.personalData === "ja" ? personalDataCategoryLabels(state.personalDataCategories).join(", ") || "Ikke besvaret" : "Ingen personoplysninger oplyst"],
        ["AI-anvendelse", aiUsageLabel(state.aiUsage)],
        ...(hasAiScreeningDetails(state.aiUsage) ? [
          ["Formål med AI", state.aiPurpose || "Ikke oplyst"],
          ["Reference til AI-vurdering", isSafeAiAssessmentUrl(state.aiAssessmentUrl) ? state.aiAssessmentUrl.trim() : "Ingen gyldig reference angivet"],
        ] as Array<[string, string]> : []),
        ["Risikovurdering", yesNo(state.hasRiskAssessment)],
        ["Databehandleraftale", yesNo(state.hasDpa)],
        ["Kontrakt", yesNo(state.hasContract)],
        ["Leverandørtjekliste", yesNo(state.hasSupplierChecklist)],
        ["Arkitekturbeskrivelse", yesNo(state.hasArchitecture)],
        ["Bilag", attachmentSummary(state)],
      ],
    },
    {
      title: "Godkendelse",
      rows: [
        ["Godkendende chef", state.approvingLeader],
        ["Bemærkninger", state.remarks],
        ["Bekræftelse af oplysninger", state.consent ? "Ja" : "Nej"],
      ],
    },
  ] satisfies Array<{ title: string; rows: Array<[string, string]> }>;
}

export function displaySystem(state: ApplicationFormState) {
  return state.selectedSystem?.name || state.manualSystemName || state.catalogQuery || "Ikke navngivet";
}

function attachmentSummary(state: ApplicationFormState) {
  const names = Object.values(state.attachments)
    .flat()
    .filter((attachment) => attachment.status === "uploaded")
    .map((attachment) => attachment.name);
  return names.length ? names.join(", ") : "Ingen bilag";
}

function yesNo(value: "ja" | "nej") {
  return value === "ja" ? "Ja" : "Nej";
}

function money(value: string) {
  return value.trim() ? `${value.trim()} kr.` : "Ikke oplyst";
}
