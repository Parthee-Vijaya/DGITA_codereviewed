import type { KleCatalog, KlTaskCatalog } from "./domain";

/** Invented examples only. No licensed KLE records or actual KL criticality claims are bundled. */
export const SYNTHETIC_KLE_CATALOG: KleCatalog = {
  source: { id: "dgita-synthetic-kle", version: "2026-10-14.1", label: "Syntetiske KLE-eksempler til afprøvning", kind: "synthetic", status: "available", acceptedForUse: false },
  entries: [
    { uuid: "00000000-0000-4000-8000-000000000001", code: "DEMO.00", title: "Eksempelgruppe – fælles drift", level: "group", retired: false },
    { uuid: "00000000-0000-4000-8000-000000000002", code: "DEMO.00.01", title: "Eksempel – lokal driftsopgave", level: "topic", retired: false },
    { uuid: "00000000-0000-4000-8000-000000000003", code: "DEMO.00.02", title: "Eksempel – fælles adgang og integration", level: "topic", retired: false },
    { uuid: "00000000-0000-4000-8000-000000000004", code: "DEMO.00.03", title: "Eksempel – opgave uden match i eksempelkilden", level: "topic", retired: false },
    { uuid: "00000000-0000-4000-8000-000000000005", code: "DEMO.00.04", title: "Eksempel – udgået emne", level: "topic", retired: true },
  ],
};

export const SYNTHETIC_KL_TASK_CATALOG: KlTaskCatalog = {
  source: { id: "dgita-synthetic-kl-tasks", version: "2026-10-14.1", label: "Opdigtede opgavematch – ikke KL's opgaveliste", kind: "synthetic", status: "available", acceptedForUse: false },
  tasks: [
    { id: "demo-task-1", title: "Eksempelopgave A – lokal driftsstøtte", codeReferences: [{ kleUuid: "00000000-0000-4000-8000-000000000002", code: "DEMO.00.01", match: "direct" }] },
    { id: "demo-task-2", title: "Eksempelopgave B – flere opgaver ved samme kode", codeReferences: [{ kleUuid: "00000000-0000-4000-8000-000000000002", code: "DEMO.00.01", match: "direct" }] },
    { id: "demo-task-3", title: "Eksempelopgave C – mulig fælles afhængighed", codeReferences: [{ kleUuid: "00000000-0000-4000-8000-000000000003", code: "DEMO.00.02", match: "possible" }] },
  ],
};
