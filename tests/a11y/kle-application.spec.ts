import { test, expect, type Page, type Response } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState, type ApplicationFormState } from "../../features/application/engine";
import { SYNTHETIC_KLE_CATALOG } from "../../features/kle/synthetic";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
const searchLabel = "Søg efter KLE-emner";
const legacyLabel = "KLE-oplysninger med egne ord";
const source = SYNTHETIC_KLE_CATALOG.source;
const localTask = SYNTHETIC_KLE_CATALOG.entries.find((entry) => entry.code === "DEMO.00.01")!;
const loginTask = SYNTHETIC_KLE_CATALOG.entries.find((entry) => entry.code === "DEMO.00.02")!;

async function createLegacyDraft(page: Page, kleTopics: string[]) {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const approversResponse = await page.request.get("/api/approvers");
  expect(approversResponse.status()).toBe(200);
  const approver = (await approversResponse.json()).approvers[0];
  const draft: ApplicationFormState = {
    ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
    manualSystemName: `Syntetisk KLE-ansøgning ${crypto.randomUUID().slice(0, 8)}`,
    catalogQuery: "", consent: true, approvingLeaderId: approver.id, approvingLeader: approver.name,
    kleTopics,
  };
  // Simulate a real older draft that predates the optional structured field.
  delete draft.kleSelection;
  const savedResponse = await page.request.post("/api/drafts", {
    headers, data: { id: crypto.randomUUID(), draft, status: "draft" },
  });
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  const readDraft = async (): Promise<ApplicationFormState> => {
    const response = await page.request.get(`/api/drafts?caseNumber=${encodeURIComponent(saved.caseNumber)}`);
    expect(response.status()).toBe(200);
    return (await response.json()).draft.state;
  };
  await page.goto(`/?view=application&draft=${encodeURIComponent(saved.caseNumber)}`);
  await page.getByRole("button", { name: "Værdi for kommunen", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: searchLabel, exact: true })).toBeVisible();
  return { saved, draft, readDraft };
}

function waitForDraftWrite(page: Page, status: "draft" | "submitted"): Promise<Response> {
  return page.waitForResponse((response) => new URL(response.url()).pathname === "/api/drafts" &&
    response.request().method() === "POST" && response.request().postDataJSON()?.status === status);
}

async function saveDraft(page: Page) {
  const response = waitForDraftWrite(page, "draft");
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function submit(page: Page) {
  const response = waitForDraftWrite(page, "submitted");
  await page.getByRole("button", { name: "Gem og indsend", exact: true }).click();
  const submittedResponse = await response;
  expect(submittedResponse.status()).toBe(200);
  const submitted = await submittedResponse.json();
  expect(submitted.status).toBe("submitted");
  return submitted;
}

test.describe("KLE selection in the normal application", () => {
  test.skip(process.env.DGITA_E2E_KLE_PREVIEW !== "true", "Requires the explicitly enabled local KLE preview server.");

  test("@kle-preview application selections and legacy text survive save, resume, submission and versioned receipt", async ({ page }) => {
    test.setTimeout(75_000);
    const clientErrors: string[] = [];
    page.on("pageerror", (error) => clientErrors.push(error.message));
    const legacy = ["Eksisterende opgavebeskrivelse", "Lokal drift uden kode"];
    const { saved, readDraft } = await createLegacyDraft(page, legacy);
    await expect(page.getByRole("textbox", { name: legacyLabel, exact: true })).toHaveValue(legacy.join(", "));
    const search = page.getByRole("searchbox", { name: searchLabel, exact: true });
    await search.fill(localTask.code);
    await page.getByRole("checkbox", { name: /DEMO\.00\.01/ }).check();
    await search.fill("login");
    await page.getByRole("checkbox", { name: /DEMO\.00\.02/ }).check();
    const selected = page.getByRole("group", { name: "Valgte KLE-emner", exact: true });
    await expect(selected).toContainText(localTask.code);
    await expect(selected).toContainText(loginTask.code);
    await saveDraft(page);

    const selection = {
      schemaVersion: 1,
      source: { id: source.id, version: source.version, label: source.label, kind: source.kind },
      entries: [localTask, loginTask].map(({ uuid, code, title }) => ({ uuid, code, title })),
    };
    await expect.poll(async () => (await readDraft()).kleSelection).toEqual(selection);
    expect((await readDraft()).kleTopics).toEqual(legacy);
    await page.reload();
    await page.getByRole("button", { name: "Værdi for kommunen", exact: true }).click();
    await expect(selected).toContainText(localTask.code);
    await expect(selected).toContainText(loginTask.code);
    await expect(page.getByRole("textbox", { name: legacyLabel, exact: true })).toHaveValue(legacy.join(", "));
    await expect(page.locator(".application-sheet")).toContainText(source.version);
    await page.getByRole("button", { name: "Gennemse", exact: true }).click();
    const review = page.locator(".application-sheet");
    await expect(review).toContainText(localTask.code);
    await expect(review).toContainText(loginTask.title);
    await expect(review).toContainText(source.version);
    await expect(review).toContainText(legacy[0]);
    const submitted = await submit(page);
    expect(submitted.caseNumber).toBe(saved.caseNumber);

    const detailPath = `/api/cases/${encodeURIComponent(submitted.caseNumber)}/detail`;
    const detailResponse = await page.request.get(detailPath);
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json();
    expect(detail.snapshot.kleSelection).toEqual(selection);
    expect(detail.snapshot.kleTopics).toEqual(legacy);
    expect(detail.case.status).not.toBe("approved");
    await page.goto(`/?view=detail&case=${encodeURIComponent(submitted.caseNumber)}`);
    await page.getByRole("navigation", { name: "Sagens indhold", exact: true }).getByRole("button", { name: "ansøgning", exact: true }).click();
    const snapshot = page.locator(".snapshot.plain-section");
    await snapshot.getByRole("button", { name: /Værdi for kommunen/ }).click();
    await expect(snapshot).toContainText(localTask.code);
    await expect(snapshot).toContainText(loginTask.title);
    await expect(snapshot).toContainText(source.version);
    await expect(snapshot).toContainText(legacy[1]);

    await page.getByRole("link", { name: "Læs kvittering (HTML)", exact: true }).click();
    const receipt = page.locator(".receipt-document");
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText(localTask.code);
    await expect(receipt).toContainText(loginTask.title);
    await expect(receipt).toContainText(source.version);
    await expect(receipt).toContainText(legacy[0]);
    const pdfHref = await receipt.getByRole("link", { name: /som PDF$/ }).getAttribute("href");
    expect(pdfHref).toContain("version=");
    const firstPdf = await page.request.get(pdfHref!);
    expect(firstPdf.status()).toBe(200);
    expect(firstPdf.headers()["content-type"]).toMatch(/^application\/pdf/);
    const repeatedPdf = await page.request.get(pdfHref!);
    expect(repeatedPdf.status()).toBe(200);
    expect(await repeatedPdf.body()).toEqual(await firstPdf.body());
    expect((await (await page.request.get(detailPath)).json()).snapshot).toEqual(detail.snapshot);
    expect(clientErrors).toEqual([]);
  });

  test("@kle-preview an empty KLE answer does not block saving, continuing or submitting the application", async ({ page }) => {
    const { readDraft } = await createLegacyDraft(page, []);
    await expect(page.getByRole("textbox", { name: legacyLabel, exact: true })).toHaveValue("");
    await expect(page.getByRole("group", { name: "Valgte KLE-emner", exact: true })).toHaveCount(0);
    await saveDraft(page);
    expect((await readDraft()).kleSelection).toBeNull();
    expect((await readDraft()).kleTopics).toEqual([]);
    await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Investering", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Gennemse", exact: true }).click();
    const submitted = await submit(page);
    const response = await page.request.get(`/api/cases/${encodeURIComponent(submitted.caseNumber)}/detail`);
    expect(response.status()).toBe(200);
    const detail = await response.json();
    expect(detail.snapshot.kleSelection).toBeNull();
    expect(detail.snapshot.kleTopics).toEqual([]);
    expect(detail.case.status).not.toBe("approved");
  });

  test("@kle-preview search failures preserve selections and allow normal progress with accessible keyboard and mobile controls", async ({ page }, testInfo) => {
    test.setTimeout(75_000);
    const { draft, readDraft } = await createLegacyDraft(page, ["Tidligere fri beskrivelse"]);
    const search = page.getByRole("searchbox", { name: searchLabel, exact: true });
    await search.fill("login");
    const option = page.getByRole("checkbox", { name: /DEMO\.00\.02/ });
    await expect(option).toBeVisible();
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(option).toBeFocused();
    await page.keyboard.press("Space");
    await expect(option).toBeChecked();
    const selected = page.getByRole("group", { name: "Valgte KLE-emner", exact: true });
    await expect(selected).toContainText(loginTask.code);

    let unavailable = true;
    await page.route("**/api/kle/search", async (route) => {
      if (unavailable) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic search outage" }) });
      else await route.continue();
    });
    await search.fill("drift");
    await expect(page.getByRole("alert").filter({ hasText: "Søgningen kunne ikke hentes" })).toBeVisible();
    await expect(selected).toContainText(loginTask.code);
    const amendedPurpose = `${draft.purpose} En yderligere fiktiv opgave beskrives uden KLE-søgning.`;
    await page.getByRole("textbox", { name: "28. Formålsbeskrivelse", exact: true }).fill(amendedPurpose);
    await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Investering", exact: true })).toBeVisible();
    await saveDraft(page);
    const persisted = await readDraft();
    expect(persisted.purpose).toBe(amendedPurpose);
    expect(persisted.kleSelection?.entries.map((entry) => entry.code)).toEqual([loginTask.code]);
    expect(persisted.kleTopics).toEqual(["Tidligere fri beskrivelse"]);

    await page.getByRole("button", { name: "Værdi for kommunen", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Søgningen kunne ikke hentes" })).toBeVisible();
    unavailable = false;
    await page.getByRole("button", { name: "Prøv søgningen igen", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Søgningen kunne ikke hentes" })).toHaveCount(0);
    await expect(selected).toContainText(loginTask.code);
    const closeMessage = page.getByRole("button", { name: "Luk besked", exact: true });
    if (await closeMessage.isVisible()) await closeMessage.click();
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
    expect((await new AxeBuilder({ page }).include(".application-sheet").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("kle-application-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await search.scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include(".application-sheet").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("kle-application-mobile.png"), fullPage: true });
    const remove = page.getByRole("button", { name: `Fjern ${loginTask.code}: ${loginTask.title}`, exact: true });
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(selected).toHaveCount(0);
    await saveDraft(page);
    expect((await readDraft()).kleSelection).toBeNull();
    expect((await readDraft()).kleTopics).toEqual(["Tidligere fri beskrivelse"]);
  });
});
