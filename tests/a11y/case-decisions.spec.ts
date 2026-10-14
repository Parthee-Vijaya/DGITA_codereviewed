import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState } from "../../features/application/engine";
import type { CaseRecord } from "../../features/workspace/model";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
const dueDate = "2099-12-01";
const clientErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  clientErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.name));
});
test.afterEach(({ page }) => expect(clientErrors.get(page)).toEqual([]));

async function login(page: Page, role: "user" | "consultant") {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const response = await page.request.post("/api/auth/dev-login", { headers, data: { role } });
  expect(response.status()).toBe(200);
}

async function createCase(page: Page, name: string) {
  await login(page, "user");
  const [approver] = (await (await page.request.get("/api/approvers")).json()).approvers;
  const response = await page.request.post("/api/drafts", { headers, data: {
    id: crypto.randomUUID(), status: "submitted", draft: {
      ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
      manualSystemName: name, catalogQuery: "", consent: true, aiUsage: "nej",
      approvingLeaderId: approver.id, approvingLeader: approver.name,
    },
  } });
  expect(response.status()).toBe(200);
  return await response.json() as { id: string; caseNumber: string; rowVersion: number };
}

async function readCase(page: Page, caseNumber: string) {
  const response = await page.request.get("/api/cases");
  expect(response.status()).toBe(200);
  return (await response.json()).cases.find((item: CaseRecord) => item.id === caseNumber) as CaseRecord;
}

async function saveReview(page: Page, caseNumber: string, internalComments: string) {
  const loaded = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber];
  const response = await page.request.post("/api/workspace", { headers, data: {
    action: "approval.save", caseId: caseNumber, expectedUpdatedAt: loaded.updatedAt ?? null, expectedRowVersion: loaded.revision,
    approval: { ...loaded, phase: "Under behandling", internalComments },
  } });
  expect(response.status()).toBe(200);
}

function actionResponse(page: Page, action: string) {
  return page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "POST" && response.request().postDataJSON()?.action === action);
}

async function requestInformation(page: Page, reason: string) {
  await page.getByRole("button", { name: "Bed om oplysninger", exact: true }).click();
  const form = page.getByRole("form", { name: "Bed om oplysninger", exact: true });
  await form.getByRole("textbox", { name: "Begrundelse til anmoderen", exact: true }).fill(reason);
  await form.getByLabel("Frist for oplysninger", { exact: true }).fill(dueDate);
  const pending = actionResponse(page, "application.request-information");
  await form.getByRole("button", { name: "Send anmodning om oplysninger", exact: true }).click();
  expect((await pending).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Oplysninger efterspurgt", exact: true })).toContainText(reason);
}

test("public return reason and deadline survive correction and resubmission as version two", async ({ page }, testInfo) => {
  const item = await createCase(page, "Syntetisk retur og version to");
  const versionOne = await readCase(page, item.caseNumber);
  expect(versionOne.currentVersionId).toBeTruthy();
  const historicalReceipt = `/cases/${item.caseNumber}/receipt?kind=submission&version=${versionOne.currentVersionId}`;
  await page.goto(historicalReceipt);
  const originalReceiptText = await page.locator("main").innerText();
  const privateCanary = `PRIVATE_RETURN_${crypto.randomUUID()}`;
  const reason = "Beskriv hvem der får adgang, og hvordan systemejeren følger op på adgangene.";
  await login(page, "consultant");
  await saveReview(page, item.caseNumber, privateCanary);
  await page.goto(`/?view=detail&case=${item.caseNumber}`);
  await requestInformation(page, reason);
  const returned = await readCase(page, item.caseNumber);
  expect(returned.status).toBe("changes_requested");
  expect(returned.currentVersionId).toBe(versionOne.currentVersionId);
  expect(returned.informationRequest).toMatchObject({ reason, dueDate });

  await login(page, "user");
  await page.goto(`/?view=detail&case=${item.caseNumber}`);
  const notice = page.getByRole("region", { name: "Oplysninger efterspurgt", exact: true });
  await expect(notice).toContainText(reason);
  await expect(notice.locator("time")).toHaveAttribute("datetime", dueDate);
  await expect(notice).toContainText("01.12.2099");
  await expect(page.locator("body")).not.toContainText(privateCanary);
  expect(JSON.stringify(await readCase(page, item.caseNumber))).not.toContain(privateCanary);
  const correctionRequest = page.waitForResponse((response) => response.url().endsWith("/api/drafts") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "begin-correction");
  await page.getByRole("button", { name: "Ret og genindsend", exact: true }).click();
  const correctionResponse = await correctionRequest;
  expect(correctionResponse.status()).toBe(200);
  const correction = (await correctionResponse.json()).draft;
  expect(correction.informationRequest).toMatchObject({ reason, dueDate });
  expect(correction.rejection).toBeNull();
  await expect(page.getByRole("heading", { name: "Ret og genindsend ansøgning", exact: true })).toBeVisible();
  await expect(page.locator(".application-title")).toContainText("Version 1 forbliver låst");
  await expect(page.locator(".application-title")).toContainText(reason);
  await expect(page.locator(".application-title")).toContainText("Svarfrist: 1. december 2099");
  await expect(page.locator("body")).not.toContainText(privateCanary);
  await page.screenshot({ path: testInfo.outputPath("return-correction-intro.png"), fullPage: true });
  await page.getByRole("button", { name: "Værdi for kommunen", exact: true }).click();
  const revisedPurpose = "Systemejeren gennemgår medarbejdernes adgang månedligt og dokumenterer ændringerne.";
  await page.getByRole("textbox", { name: "28. Formålsbeskrivelse", exact: true }).fill(revisedPurpose);
  const savedCorrection = page.waitForResponse((response) => response.url().endsWith("/api/drafts") && response.request().method() === "POST" && response.request().postDataJSON()?.status === "draft");
  await page.getByRole("button", { name: "Gem rettelser", exact: true }).click();
  expect((await savedCorrection).status()).toBe(200);
  await expect(page.getByText("Rettelserne er gemt sikkert", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".application-title")).toContainText(reason);
  await page.getByRole("button", { name: "Værdi for kommunen", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "28. Formålsbeskrivelse", exact: true })).toHaveValue(revisedPurpose);
  await page.getByRole("button", { name: "Gennemse", exact: true }).click();
  await page.getByRole("checkbox").check();
  const submitPromise = page.waitForResponse((response) => response.url().endsWith("/api/drafts") && response.request().postDataJSON()?.status === "submitted");
  await page.getByRole("button", { name: "Genindsend version 2", exact: true }).click();
  const submission = await submitPromise;
  expect(submission.status()).toBe(200);
  expect(await submission.json()).toMatchObject({ status: "submitted", versionNumber: 2, mode: "correction" });
  const latest = await readCase(page, item.caseNumber);
  expect(latest.currentVersionId).not.toBe(versionOne.currentVersionId);
  expect(latest.informationRequest).toBeNull();
  expect(latest.hasCurrentLeaderApproval).toBe(false);
  const detail = await (await page.request.get(`/api/cases/${item.caseNumber}/detail`)).json();
  expect(detail.case.versionNumber).toBe(2);
  expect(detail.snapshot.purpose).toBe(revisedPurpose);
  await page.getByRole("navigation", { name: "Sagens indhold", exact: true }).getByRole("button", { name: "ansøgning", exact: true }).click();
  const snapshotView = page.locator(".snapshot.plain-section");
  await expect(snapshotView.getByText("Version 2 · låst", { exact: true })).toBeVisible();
  await snapshotView.getByRole("button", { name: /Værdi for kommunen/ }).click();
  await expect(snapshotView.locator(".fact").filter({ has: page.getByText("Formål", { exact: true }) })).toContainText(revisedPurpose);
  await page.goto(historicalReceipt);
  await expect(page.locator("main")).toHaveText(originalReceiptText, { useInnerText: true });
});

test("explicit rejection after a return publishes only its public reason and closes correction and receipt consistently", async ({ page }, testInfo) => {
  const item = await createCase(page, "Syntetisk endeligt afslag efter retur");
  const privateCanary = `PRIVATE_FINAL_${crypto.randomUUID()}`;
  await login(page, "consultant");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "GET"),
    page.goto(`/?view=detail&case=${item.caseNumber}`),
  ]);
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  await page.getByRole("textbox", { name: "D-GITA felt: Interne kommentarer", exact: true }).fill(privateCanary);
  await page.getByRole("combobox", { name: "D-GITA felt: Fase", exact: true }).selectOption("Under behandling");
  const savedReview = actionResponse(page, "approval.save");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  expect((await savedReview).status()).toBe(200);
  await page.getByRole("button", { name: "overblik", exact: true }).click();
  await requestInformation(page, "Beskriv først, hvordan den nødvendige dokumentation kan leveres.");
  await expect(page.getByRole("button", { name: "Bed om oplysninger", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Afvis endeligt", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Afvis endeligt", exact: true }).click();
  const form = page.getByRole("form", { name: "Endeligt afslag", exact: true });
  const publicReason = "Anskaffelsen afslås, fordi den nødvendige dokumentation ikke kan leveres for den beskrevne løsning.";
  await form.getByRole("textbox", { name: "Begrundelse til anmoderen", exact: true }).fill(publicReason);
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
  const audit = await new AxeBuilder({ page }).include(".case-decision-actions").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  const pending = actionResponse(page, "approval.reject");
  await form.getByRole("button", { name: "Bekræft endeligt afslag", exact: true }).click();
  expect((await pending).status()).toBe(200);
  const decision = page.getByRole("region", { name: "Endelig D-GITA-beslutning", exact: true });
  await expect(decision).toContainText(publicReason);
  await expect(page.getByRole("heading", { name: "Endeligt afslag fra D-GITA", exact: true })).toBeVisible();
  const closed = await readCase(page, item.caseNumber);
  expect(closed.status).toBe("closed");
  expect(closed.phase).toBe("Afsluttet");
  expect(closed.finalDecision).toMatchObject({ outcome: "rejected", reason: publicReason });
  const internalApproval = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[item.caseNumber];
  expect(internalApproval.internalComments).toBe(privateCanary);
  await expect(page.getByRole("button", { name: "Afvis endeligt", exact: true })).toHaveCount(0);

  await login(page, "user");
  await page.goto(`/?view=detail&case=${item.caseNumber}`);
  await expect(decision).toContainText(publicReason);
  await expect(page.locator("body")).not.toContainText(privateCanary);
  await expect(page.locator("body")).not.toContainText("et afvist beslutningsgrundlag kan rettes og indsendes som en ny version");
  await expect(page.getByRole("button", { name: "Ret og genindsend", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fortsæt kladde", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "D-GITA godkendelse", exact: true })).toHaveCount(0);
  expect(JSON.stringify(await readCase(page, item.caseNumber))).not.toContain(privateCanary);
  expect(await (await page.request.get("/api/workspace")).text()).not.toContain(privateCanary);
  const forbiddenCorrection = await page.request.post("/api/drafts", { headers, data: { action: "begin-correction", caseNumber: item.caseNumber } });
  expect(forbiddenCorrection.status()).toBe(409);
  await page.screenshot({ path: testInfo.outputPath("final-rejection-user.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(decision).toContainText(publicReason);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("final-rejection-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/cases/${item.caseNumber}/receipt?kind=final`);
  await expect(page).toHaveURL(new RegExp(`kind=final&version=${closed.currentVersionId}`));
  await expect(page.locator("main")).toContainText(publicReason);
  await expect(page.locator("main")).toContainText("Afvist");
  await expect(page.locator("body")).not.toContainText(privateCanary);
  await page.screenshot({ path: testInfo.outputPath("final-rejection-receipt.png"), fullPage: true });
  const pdf = await page.request.get(`/api/cases/${item.caseNumber}/receipt?kind=final`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
});

for (const kind of ["information", "reject"] as const) {
  test(`stale ${kind} revision returns 409 and preserves the consultant's unsaved explanation`, async ({ page }, testInfo) => {
    const item = await createCase(page, `Syntetisk samtidighed ${kind}`);
    await login(page, "consultant");
    await page.goto(`/?view=detail&case=${item.caseNumber}`);
    await page.getByRole("button", { name: kind === "information" ? "Bed om oplysninger" : "Afvis endeligt", exact: true }).click();
    const form = page.getByRole("form", { name: kind === "information" ? "Bed om oplysninger" : "Endeligt afslag", exact: true });
    const reason = "Denne forklaring er stadig mit uafsluttede arbejde, selv om en kollega opdaterer sagen.";
    const reasonInput = form.getByRole("textbox", { name: "Begrundelse til anmoderen", exact: true });
    await reasonInput.fill(reason);
    if (kind === "information") await form.getByLabel("Frist for oplysninger", { exact: true }).fill(dueDate);
    await saveReview(page, item.caseNumber, "Syntetisk samtidig ændring fra en anden arbejdsgang.");
    const current = await readCase(page, item.caseNumber);
    const pending = actionResponse(page, kind === "information" ? "application.request-information" : "approval.reject");
    await form.getByRole("button", { name: kind === "information" ? "Send anmodning om oplysninger" : "Bekræft endeligt afslag", exact: true }).click();
    expect((await pending).status()).toBe(409);
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(reasonInput).toHaveValue(reason);
    await expect(reasonInput).toBeEnabled();
    if (kind === "information") await expect(form.getByLabel("Frist for oplysninger", { exact: true })).toHaveValue(dueDate);
    const after = await readCase(page, item.caseNumber);
    expect(after.status).toBe(current.status);
    expect(after.revision).toBe(current.revision);
    expect(after.informationRequest).toBeNull();
    expect(after.finalDecision).toBeNull();
    await page.screenshot({ path: testInfo.outputPath(`${kind}-stale-input-preserved.png`), fullPage: true });
  });
}
