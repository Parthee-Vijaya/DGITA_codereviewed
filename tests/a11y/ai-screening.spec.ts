import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState, type ApplicationFormState } from "../../features/application/engine";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
const question = "Indeholder anskaffelsen AI?";
const purposeLabel = "Hvad skal AI bruges til?";
const referenceLabel = "Link til kommunens aktuelle AI-vurdering";

test("legacy drafts gain manual AI screening, accessible validation, save/resume and hidden-answer clearing", async ({ page }, testInfo) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.name));
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const draft: ApplicationFormState = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: "Syntetisk AI-screening", catalogQuery: "", consent: true };
  delete draft.aiUsage;
  delete draft.aiPurpose;
  delete draft.aiAssessmentUrl;
  const saved = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft, status: "draft" } });
  expect(saved.status()).toBe(200);
  const { caseNumber } = await saved.json();
  const readDraft = async () => (await (await page.request.get(`/api/drafts?caseNumber=${caseNumber}`)).json()).draft.state;
  await page.goto(`/?view=application&draft=${caseNumber}`);
  await page.getByRole("button", { name: "Risiko & data", exact: true }).click();
  const usage = page.getByRole("radiogroup", { name: question, exact: true });
  const purpose = page.getByRole("textbox", { name: purposeLabel, exact: true });
  const reference = page.getByRole("textbox", { name: referenceLabel, exact: true });
  await expect(usage.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(purpose).toHaveCount(0);
  await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
  await expect(usage).toHaveAttribute("aria-invalid", "true");
  await expect(usage).toHaveAccessibleDescription(/Ja, Nej eller Ved ikke/);
  await expect(page.locator(".form-message.error")).toBeFocused();
  await usage.getByRole("radio", { name: "Ja", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(usage.getByRole("radio", { name: "Ved ikke", exact: true })).toBeFocused();
  await expect(usage.getByRole("radio", { name: "Ved ikke", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Kontakt kommunens digitaliserings- eller AI-ansvarlige/)).toBeVisible();
  await expect(purpose).toHaveValue("");
  await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
  await expect(purpose).toHaveAttribute("aria-invalid", "true");
  await expect(purpose).toHaveAccessibleDescription(/Beskriv, hvad AI skal bruges til/);
  const text = "Afklare, om tekstforslag bruger AI, inden medarbejdere bruger dem til vejledningsudkast.";
  await purpose.fill(text);
  await reference.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
  await expect(reference).toHaveAttribute("aria-invalid", "true");
  await expect(reference).toHaveAccessibleDescription(/gyldigt link/);
  await reference.fill("https://municipality.example.invalid/assessment/123");
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  await expect.poll(async () => (await readDraft()).aiPurpose).toBe(text);
  await expect.poll(async () => (await readDraft()).aiUsage).toBe("ved-ikke");
  await page.reload();
  await page.getByRole("button", { name: "Risiko & data", exact: true }).click();
  await expect(purpose).toHaveValue(text);
  await expect(reference).toHaveValue("https://municipality.example.invalid/assessment/123");
  await expect(usage.getByRole("radio", { name: "Ved ikke", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
  const audit = await new AxeBuilder({ page }).include(".application-sheet").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ai-screening-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Gennemse", exact: true }).click();
  await expect(page.locator(".review-line").filter({ hasText: "AI i anskaffelsen" })).toContainText("Ved ikke");
  await expect(page.locator(".review-line").filter({ hasText: "AI-formål" })).toContainText(text);
  await page.getByRole("button", { name: "Risiko & data", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await usage.getByRole("radio", { name: "Ja", exact: true }).click();
  await expect(purpose).toHaveValue(text);
  await usage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ai-screening-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await usage.getByRole("radio", { name: "Nej", exact: true }).click();
  await expect(purpose).toHaveCount(0);
  await expect(reference).toHaveCount(0);
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  await expect.poll(async () => (await readDraft()).aiUsage).toBe("nej");
  await expect.poll(async () => (await readDraft()).aiPurpose).toBe("");
  await expect.poll(async () => (await readDraft()).aiAssessmentUrl).toBe("");
  await usage.getByRole("radio", { name: "Ja", exact: true }).click();
  await expect(purpose).toHaveValue("");
  await expect(reference).toHaveValue("");
  expect(clientErrors).toEqual([]);
});

test("AI submission preserves a manual assessment reference while keeping the normal approval flow", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const approver = (await (await page.request.get("/api/approvers")).json()).approvers[0];
  const id = crypto.randomUUID();
  const systemPrefix = `Syntetisk AI-overblik ${id.slice(0, 8)}`;
  const draft: ApplicationFormState = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: `${systemPrefix} Ja`, catalogQuery: "", consent: true, approvingLeaderId: approver.id, approvingLeader: approver.name,
    aiUsage: "ja", aiPurpose: "Medarbejdere laver vejledningsudkast, som kontrolleres manuelt før brug.",
    aiAssessmentUrl: "https://municipality.example.invalid/assessment/manual" };
  const savedResponse = await page.request.post("/api/drafts", { headers, data: { id, draft, status: "draft" } });
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  await page.goto(`/?view=application&draft=${saved.caseNumber}`);
  await page.getByRole("button", { name: "Gennemse", exact: true }).click();
  await expect(page.locator(".review-line").filter({ hasText: "AI-formål" })).toContainText(draft.aiPurpose!);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/drafts") && response.request().postDataJSON()?.status === "submitted");
  await page.getByRole("button", { name: "Gem og indsend", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const submitted = await response.json();
  expect(submitted.status).toBe("submitted");
  const detailPath = `/api/cases/${submitted.caseNumber}/detail`;
  const firstRead = await (await page.request.get(detailPath)).json();
  expect(firstRead.snapshot.aiUsage).toBe("ja");
  expect(firstRead.snapshot.aiPurpose).toBe(draft.aiPurpose);
  expect(firstRead.snapshot.aiAssessmentUrl).toBe(draft.aiAssessmentUrl);
  expect(firstRead.case.status).not.toBe("approved");
  expect((await (await page.request.get(detailPath)).json()).snapshot).toEqual(firstRead.snapshot);

  await page.goto(`/?view=detail&case=${submitted.caseNumber}`);
  await page.getByRole("navigation", { name: "Sagens indhold", exact: true }).getByRole("button", { name: "ansøgning", exact: true }).click();
  const snapshotView = page.locator(".snapshot.plain-section");
  await snapshotView.getByRole("button", { name: /Risikovurdering/ }).click();
  await expect(snapshotView.locator(".fact").filter({ has: page.getByText("AI-anvendelse", { exact: true }) })).toContainText("Ja");
  await expect(snapshotView.locator(".fact").filter({ has: page.getByText("Formål med AI", { exact: true }) })).toContainText(draft.aiPurpose!);
  await expect(snapshotView.getByRole("link", { name: "Åbn AI-vurdering", exact: true })).toHaveAttribute("href", draft.aiAssessmentUrl!);

  const caseNumbers = new Map([["ja", submitted.caseNumber]]);
  for (const aiUsage of ["ved-ikke", "nej", ""] as const) {
    const candidate: ApplicationFormState = { ...draft, manualSystemName: `${systemPrefix} ${aiUsage || "Historisk"}`, aiUsage };
    if (!aiUsage) {
      delete candidate.aiUsage;
      delete candidate.aiPurpose;
      delete candidate.aiAssessmentUrl;
    }
    const result = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft: candidate, status: aiUsage ? "submitted" : "draft" } });
    expect(result.status()).toBe(200);
    caseNumbers.set(aiUsage || "unanswered", (await result.json()).caseNumber);
  }
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "consultant" } })).status()).toBe(200);
  await page.goto("/?view=consultant");
  await page.getByRole("textbox", { name: "Søg i alle sager", exact: true }).fill(systemPrefix);
  const aiFilter = page.getByRole("combobox", { name: "Filtrér efter AI-anvendelse", exact: true });
  const visibleIds = () => page.locator(".consultant-records tbody tr .record-name small").allTextContents().then((labels) => labels.map((label) => label.split(" · ")[0]));
  await expect.poll(visibleIds).toHaveLength(4);
  for (const value of ["ja", "ved-ikke", "nej", "unanswered"]) {
    await aiFilter.selectOption(value);
    await expect.poll(visibleIds).toEqual([caseNumbers.get(value)]);
  }
  await aiFilter.selectOption("ved-ikke");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksportér CSV", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  expect(stream).toBeTruthy();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString("utf8");
  expect(csv).toContain('"AI-anvendelse"');
  expect(csv).toContain('"Ved ikke"');
  expect(csv).toContain(caseNumbers.get("ved-ikke"));
  expect(csv).not.toContain(caseNumbers.get("ja"));
  await aiFilter.selectOption("all");
  await expect.poll(visibleIds).toHaveLength(4);
});
