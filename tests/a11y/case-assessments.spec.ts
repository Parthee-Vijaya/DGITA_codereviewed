import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState } from "../../features/application/engine";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
async function login(page: Page, role: string) {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role } })).status()).toBe(200);
}

test("internal assessments focus missing documentation, preserve partial work and remain private after save", async ({ page }, testInfo) => {
  await login(page, "user");
  const approver = (await (await page.request.get("/api/approvers")).json()).approvers[0];
  const state = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: "Syntetisk vurderingsprøve", catalogQuery: "", approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true };
  const submitted = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft: state, status: "submitted" } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  await login(page, "consultant");
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  const privacy = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Databeskyttelsesvurdering" }) });
  const procurement = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Indkøbs- og udbudsvurdering" }) });
  await expect(privacy).not.toHaveAttribute("open", "");
  await privacy.locator("summary").click();
  await page.getByLabel("Dokumentationsstatus for databeskyttelse", { exact: true }).selectOption("documented");
  await privacy.locator("summary").click();
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(privacy).toHaveAttribute("open", "");
  await expect(page.getByRole("alert").filter({ hasText: "Kontrollér de interne vurderinger" })).toBeFocused();
  await page.getByLabel("Dokumentationsstatus for databeskyttelse", { exact: true }).selectOption("in-progress");
  const basis = page.getByLabel("Konkret behandlingsgrundlag eller begrundet ikke-relevans", { exact: true });
  await basis.fill("Intern syntetisk vurdering kræver fortsat afklaring.");
  await procurement.locator("summary").click();
  await page.getByLabel("Dokumentationsstatus for indkøb og udbud", { exact: true }).selectOption("documented");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Kontrollér de interne vurderinger" })).toBeFocused();
  await page.getByLabel("Valgt anskaffelsesprocedure", { exact: true }).fill("Intern syntetisk procedure");
  await page.getByLabel("Begrundelse for anskaffelsesprocedure", { exact: true }).fill("Konkret syntetisk begrundelse for procedurevalget.");
  await page.getByLabel("Reference til indkøbs- og udbudsvurdering", { exact: true }).fill("INTERN-SAG-123");
  await page.getByLabel("Dato for regelkontrol", { exact: true }).fill("2026-10-09");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(page.getByText("D-GITA-godkendelsen er gemt med auditspor.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gem D-GITA-felter", exact: true })).toBeEnabled();
  const saved = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber];
  expect(saved.privacyAssessment.status).toBe("in-progress");
  expect(saved.procurementAssessment.status).toBe("documented");
  expect(saved.procurementAssessment.recordedBy).toBeTruthy();
  expect(saved.procurementAssessment.applicationVersionId).toBeTruthy();
  await expect(procurement.getByText(/Senest gemte ændring:/)).toBeVisible();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).include(".dgita-review-layout").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`assessments-${viewport.width}.png`), fullPage: true });
  }
  await page.reload();
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  await privacy.locator("summary").click();
  await expect(basis).toHaveValue("Intern syntetisk vurdering kræver fortsat afklaring.");
  await login(page, "user");
  expect(JSON.stringify(await (await page.request.get("/api/workspace")).json())).not.toMatch(/INTERN-SAG-123|Intern syntetisk|privacyAssessment|procurementAssessment/);
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await expect(page.getByRole("button", { name: "D-GITA godkendelse", exact: true })).toHaveCount(0);
});
