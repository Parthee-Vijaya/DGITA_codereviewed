import { test, expect, type Page, type Locator } from "@playwright/test";
import { demoApplicationState } from "../../features/application/engine";
import type { Actor } from "../../features/auth/types";
import type { CaseRecord } from "../../features/workspace/model";
import type { ResponsiblePersonOption } from "../../features/workspace/responsible-directory";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };

async function login(page: Page, role: string): Promise<Actor> {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const response = await page.request.post("/api/auth/dev-login", { headers, data: { role } });
  expect(response.status()).toBe(200);
  return (await response.json()).viewer;
}

async function visibleCaseIds(page: Page) {
  return page.locator(".consultant-records tbody tr .record-name small").allTextContents()
    .then((labels) => labels.map((label) => label.split(" · ")[0]));
}

async function expectRightColumn(page: Page, question: string, control: Locator) {
  const labelBounds = await page.getByRole("group", { name: question, exact: true }).locator(".question-copy").boundingBox();
  const controlBounds = await control.boundingBox();
  expect(labelBounds).not.toBeNull();
  expect(controlBounds).not.toBeNull();
  expect(controlBounds!.x).toBeGreaterThan(labelBounds!.x + labelBounds!.width);
}

test("combined work filters and CSV use the visible cases and match personal responsibility by identity", async ({ page }) => {
  const viewer = await login(page, "consultant");
  const base: CaseRecord = {
    id: "ITA-990001", tenantId: viewer.tenantId, ownerSubject: "synthetic-applicant",
    ownerEmail: "applicant@example.invalid", system: "Fælles test Alpha", phase: "Under behandling",
    status: "awaiting_leader", created: "09.10.2026", changed: "09.10.2026",
    consultant: viewer.displayName, assignedConsultantUserId: "synthetic-current-consultant",
    assignedConsultantSubject: viewer.subject, assignedConsultantProvider: viewer.provider,
    applicant: "Syntetisk anmoder", municipality: "Testkommune", leader: "Testleder",
    approval: "Afventer", awaitingLeader: true, receiptAvailable: true,
  };
  const cases: CaseRecord[] = [
    base,
    { ...base, id: "ITA-990002", system: "Fælles test Beta" },
    // Display-name collision must not grant Mine sager.
    { ...base, id: "ITA-990003", assignedConsultantUserId: "synthetic-other-consultant", assignedConsultantSubject: "another-subject" },
    // A subject only identifies a person within its identity provider.
    { ...base, id: "ITA-990004", assignedConsultantUserId: "synthetic-other-provider", assignedConsultantProvider: viewer.provider === "entra" ? "dev" : "entra" },
    { ...base, id: "ITA-990005", awaitingLeader: false },
    { ...base, id: "ITA-990006", status: "changes_requested", approval: "Afvist", awaitingLeader: false },
    { ...base, id: "ITA-990007", status: "changes_requested", approval: "Afvist", awaitingLeader: false,
      assignedConsultantUserId: null, assignedConsultantSubject: null, assignedConsultantProvider: null, consultant: "Ikke tildelt" },
    { ...base, id: "ITA-990008", phase: "Indsendt" },
    { ...base, id: "ITA-990009", tenantId: "synthetic-other-tenant" },
  ];
  await page.route("**/api/cases", (route) => route.fulfill({ json: { cases } }));
  await page.goto("/?view=consultant");
  await expect(page.getByRole("heading", { name: "Alle sager", exact: true })).toBeVisible();
  await expect.poll(() => visibleCaseIds(page)).toHaveLength(8);

  await page.getByRole("textbox", { name: "Søg i alle sager", exact: true }).fill("fælles");
  await page.getByRole("combobox", { name: "Filtrér på fase", exact: true }).selectOption("Under behandling");
  await page.getByRole("combobox", { name: "Filtrér efter arbejdsstatus", exact: true }).selectOption("awaiting-leader");
  await page.getByRole("combobox", { name: "Filtrér efter ansvarlig", exact: true }).selectOption("mine");
  await expect.poll(() => visibleCaseIds(page)).toEqual(["ITA-990001", "ITA-990002"]);
  await expect(page.locator(".consultant-records [role=status]")).toContainText("2 sager matcher");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksportér CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dgita-sager-\d{4}-\d{2}-\d{2}\.csv$/u);
  const stream = await download.createReadStream();
  expect(stream).toBeTruthy();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString("utf8");
  const lines = csv.replace(/^\uFEFF/u, "").trim().split(/\r?\n/u);
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('"Sagsnummer";"System";"Fase"');
  expect(lines.slice(1).map((line) => line.split(";")[0].replace(/^"|"$/gu, ""))).toEqual(await visibleCaseIds(page));
  for (const id of cases.slice(2).map((item) => item.id)) expect(csv).not.toContain(id);

  await page.getByRole("textbox", { name: "Søg i alle sager", exact: true }).fill("intet-match-424242");
  await expect(page.getByText("Ingen sager matcher", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eksportér CSV", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Nulstil filtre", exact: true }).click();
  await expect.poll(() => visibleCaseIds(page)).toHaveLength(8);
  await expect(page.getByRole("textbox", { name: "Søg i alle sager", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Filtrér på fase", exact: true })).toHaveValue("Alle faser");
  await expect(page.getByRole("combobox", { name: "Filtrér efter arbejdsstatus", exact: true })).toHaveValue("all");
  await expect(page.getByRole("combobox", { name: "Filtrér efter ansvarlig", exact: true })).toHaveValue("all");
  await expect(page.getByRole("button", { name: "Nulstil filtre", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Filtrér efter arbejdsstatus", exact: true }).selectOption("needs-information");
  await expect.poll(() => visibleCaseIds(page)).toEqual(["ITA-990006", "ITA-990007"]);
  await page.getByRole("combobox", { name: "Filtrér efter ansvarlig", exact: true }).selectOption("unassigned");
  await expect.poll(() => visibleCaseIds(page)).toEqual(["ITA-990007"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Filtrér efter ansvarlig", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("primary, multiple additional and IT responsibility persist as separate people through the real API", async ({ page }) => {
  await login(page, "user");
  const approversResponse = await page.request.get("/api/approvers");
  expect(approversResponse.status()).toBe(200);
  const [approver] = (await approversResponse.json()).approvers;
  expect(approver, "Syntetisk testdatabase skal indeholde en bemyndiget godkender.").toBeTruthy();
  const submitted = await page.request.post("/api/drafts", { headers, data: {
    id: crypto.randomUUID(), status: "submitted", draft: {
      ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
      manualCatalogEntry: false, manualSystemName: "Syntetisk prøve af ansvarstildeling", catalogQuery: "",
      approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true,
    },
  } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  // Ensure the standard synthetic staff accounts exist; no provisioned person is edited.
  await login(page, "admin");
  await login(page, "consultant");
  const directoryResponse = await page.request.get("/api/workspace/responsible-people");
  expect(directoryResponse.status()).toBe(200);
  const people: ResponsiblePersonOption[] = (await directoryResponse.json()).people;
  expect(people.length, "Prøven kræver tre separate syntetiske medarbejdere.").toBeGreaterThanOrEqual(3);
  const [primary, extraOne, extraTwo] = people;
  expect(new Set([primary.id, extraOne.id, extraTwo.id]).size).toBe(3);
  let releaseDirectory!: () => void;
  const heldDirectory = new Promise<void>((resolve) => { releaseDirectory = resolve; });
  await page.route("**/api/workspace/responsible-people", async (route) => {
    await heldDirectory;
    await route.fulfill({ status: 503, json: { error: "Syntetisk personlistefejl" } });
  });
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  const primarySelect = page.getByRole("combobox", { name: "D-GITA felt: D-GITA ansvarlig", exact: true });
  const itSelect = page.getByRole("combobox", { name: "D-GITA felt: IT-konsulent", exact: true });
  await expect(page.getByText("Henter personliste…", { exact: true })).toBeVisible();
  await expect(primarySelect).toBeDisabled();
  await expectRightColumn(page, "D-GITA felt: D-GITA ansvarlig", primarySelect);
  releaseDirectory();
  await expect(page.getByRole("button", { name: "Hent personliste igen", exact: true })).toBeVisible();
  await expect(primarySelect).toBeDisabled();
  await expectRightColumn(page, "D-GITA felt: D-GITA ansvarlig", primarySelect);
  await page.unroute("**/api/workspace/responsible-people");
  await page.getByRole("button", { name: "Hent personliste igen", exact: true }).click();
  await expect(primarySelect).toBeEnabled();
  await expect(primarySelect.locator(`option[value="${primary.id}"]`)).toHaveText(`${primary.name} · ${primary.identifier}`);
  await primarySelect.selectOption(primary.id);
  await page.getByRole("radiogroup", { name: "D-GITA felt: Er der flere D-GITA ansvarlige?", exact: true })
    .getByRole("radio", { name: "Ja", exact: true }).click();
  const additionalSelect = page.getByRole("combobox", { name: "Tilføj yderligere D-GITA-ansvarlig", exact: true });
  await expect(additionalSelect.locator(`option[value="${primary.id}"]`)).toHaveCount(0);
  await additionalSelect.selectOption(extraOne.id);
  await expect(additionalSelect.locator(`option[value="${extraOne.id}"]`)).toHaveCount(0);
  await additionalSelect.selectOption(extraTwo.id);
  await expect(page.locator(".responsible-people-list li")).toHaveCount(2);
  await expect(page.locator(".responsible-people-list li").nth(0)).toContainText(`${extraOne.name} · ${extraOne.identifier}`);
  await expect(page.locator(".responsible-people-list li").nth(1)).toContainText(`${extraTwo.name} · ${extraTwo.identifier}`);
  await expectRightColumn(page, "Hvis ja, angiv næste D-GITA ansvarlige", additionalSelect);
  await itSelect.selectOption(extraTwo.id);
  await page.getByRole("combobox", { name: "D-GITA felt: Fase", exact: true }).selectOption("Under behandling");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(page.getByText("D-GITA-godkendelsen er gemt med auditspor.", { exact: true })).toBeVisible();
  const approval = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber];
  expect(approval.responsibleUserId).toBe(primary.id);
  expect(approval.responsible).toBe(primary.name);
  expect(approval.additionalResponsibleUserIds).toEqual([extraOne.id, extraTwo.id]);
  expect(approval.itConsultantUserId).toBe(extraTwo.id);
  const savedCase = (await (await page.request.get("/api/cases")).json()).cases.find((item: CaseRecord) => item.id === caseNumber);
  expect(savedCase.assignedConsultantUserId).toBe(primary.id);

  await page.reload();
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  await expect(primarySelect).toHaveValue(primary.id);
  await expect(itSelect).toHaveValue(extraTwo.id);
  await expect(page.locator(".responsible-people-list li")).toHaveCount(2);
  await expect(page.locator(".responsible-people-list li").nth(0)).toContainText(extraOne.name);
  await expect(page.locator(".responsible-people-list li").nth(1)).toContainText(extraTwo.name);
  await page.getByRole("button", { name: "Fjern yderligere ansvarlig 1", exact: true }).click();
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber].additionalResponsibleUserIds)
    .toEqual([extraTwo.id]);
});


test("an unusable open approval request keeps review controls locked and explains the required revocation", async ({ page }) => {
  await login(page, "user");
  const [approver] = (await (await page.request.get("/api/approvers")).json()).approvers;
  const submitted = await page.request.post("/api/drafts", { headers, data: {
    id: crypto.randomUUID(), status: "submitted", draft: {
      ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
      manualSystemName: "Syntetisk prøve af udløbet lederforløb", catalogQuery: "",
      approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true,
    },
  } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  await login(page, "consultant");
  const requested = await page.request.post(`/api/cases/${caseNumber}/approval-request`, { headers, data: {} });
  expect(requested.status()).toBe(202);
  const requestId = (await requested.json()).id;
  // Repository tests cover real expiry, lost mandate, old versions and decision races.
  // Project their shared display state over a real open request, then use the real DELETE.
  await page.route("**/api/cases", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { cases: CaseRecord[] };
    await route.fulfill({ response, json: { cases: payload.cases.map((item) => item.id === caseNumber && item.leaderReviewLocked
      ? { ...item, approval: "Ikke startet", awaitingLeader: false } : item) } });
  });
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  await expect(page.locator(".review-lock-note")).toContainText("skal tilbagekaldes");
  await expect(page.locator(".review-lock-note")).toContainText("Overblik → Ledergodkendelse");
  await expect(page.getByRole("button", { name: "Gem D-GITA-felter", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "D-GITA felt: Fase", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "D-GITA felt: Bemærkninger", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "overblik", exact: true }).click();
  const revoke = page.getByRole("button", { name: "Tilbagekald godkendelseslink", exact: true });
  await expect(revoke).toBeVisible();
  let failOnce = true;
  await page.route(`**/api/cases/${caseNumber}/approval-request`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().postDataJSON()).toEqual({ requestId });
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, json: { error: "Syntetisk tilbagekaldelsesfejl. Prøv igen." } });
    } else await route.continue();
  });
  await revoke.click();
  await expect(page.getByRole("status").filter({ hasText: "Syntetisk tilbagekaldelsesfejl" })).toBeVisible();
  await expect(revoke).toBeEnabled();
  expect((await (await page.request.get("/api/cases")).json()).cases.find((item: CaseRecord) => item.id === caseNumber).leaderReviewLocked).toBe(true);
  const cancellation = page.waitForResponse((response) => response.url().endsWith(`/api/cases/${caseNumber}/approval-request`) && response.request().method() === "DELETE");
  await revoke.click();
  const cancelled = await cancellation;
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  await expect(revoke).toBeHidden();
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gem D-GITA-felter", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "D-GITA felt: Bemærkninger", exact: true }).fill("Fortsat efter tilbagekaldelse");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber].notes).toBe("Fortsat efter tilbagekaldelse");
  await login(page, "user");
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await expect(revoke).toBeHidden();
  const userCase = (await (await page.request.get("/api/cases")).json()).cases.find((item: CaseRecord) => item.id === caseNumber);
  expect(userCase).not.toHaveProperty("openLeaderApprovalRequestId");
});
