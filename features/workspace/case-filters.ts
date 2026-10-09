import { canViewCase, type CaseRecord, type WorkspaceViewer } from "./model";
import { csvCell } from "./csv";

export type CaseWorkStatus = "all" | "awaiting-leader" | "needs-information";
export type CaseAssignment = "all" | "unassigned" | "mine";
export type CaseFilters = { query: string; phase: string; workStatus: CaseWorkStatus; assignment: CaseAssignment };
type FilterViewer = WorkspaceViewer & { provider?: string };

export const EMPTY_CASE_FILTERS: CaseFilters = { query: "", phase: "Alle faser", workStatus: "all", assignment: "all" };

export function filterConsultantCases(items: CaseRecord[], viewer: FilterViewer, filters: CaseFilters) {
  const query = filters.query.trim().toLocaleLowerCase("da-DK");
  return items.filter((item) => {
    if (!canViewCase(viewer, item)) return false;
    if (query && !`${item.id} ${item.system} ${item.applicant}`.toLocaleLowerCase("da-DK").includes(query)) return false;
    if (filters.phase !== "Alle faser" && item.phase !== filters.phase) return false;
    if (filters.workStatus === "awaiting-leader" && item.awaitingLeader !== true) return false;
    if (filters.workStatus === "needs-information" && item.status !== "changes_requested") return false;
    if (filters.assignment === "unassigned" && item.assignedConsultantUserId !== null) return false;
    if (filters.assignment === "mine" && (!viewer.provider || item.assignedConsultantSubject !== viewer.subject || item.assignedConsultantProvider !== viewer.provider)) return false;
    return true;
  });
}

/** Export exactly the same filtered rows that the table receives. */
export function caseRowsCsv(rows: CaseRecord[]) {
  const header = ["Sagsnummer", "System", "Fase", "Anmoder", "Kommune", "Konsulent", "Ledergodkendelse", "Oprettet", "Ændret"];
  const data = rows.map((item) => [item.id, item.system, item.phase, item.applicant, item.municipality, item.consultant, item.approval, item.created, item.changed]);
  return `\uFEFF${[header, ...data].map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
}
