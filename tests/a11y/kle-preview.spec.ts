import { test, expect, type Page, type Response } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createEmptyKleReview } from "../../features/kle/domain";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
const TASK_LABEL = "Hvilken lokal arbejdsopgave understøttes?";
const LEVEL_LABEL = "Lokal kritikalitet i afprøvningen";
const CONFIRMED_LABEL = "Registreringen er bekræftet af dig for disse oplysninger";
const UNCONFIRMED_LABEL = "Registreringen er endnu ikke bekræftet for disse oplysninger";

async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const response = await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } });
  expect(response.status()).toBe(200);
  await page.goto("/afproevning/kle");
  await expect(page.getByRole("heading", { name: "Arbejdsopgaver og kritikalitet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gem registrering", exact: true })).toBeEnabled();
}

function waitForSave(page: Page, action: "create" | "save" | "confirm"): Promise<Response> {
  return page.waitForResponse((response) => new URL(response.url()).pathname === "/api/system-usages" &&
    response.request().method() === "POST" && response.request().postDataJSON()?.action === action);
}

test.describe("Local synthetic KLE preview", () => {
  test.skip(process.env.DGITA_E2E_KLE_PREVIEW !== "true", "Requires the explicitly enabled isolated KLE preview server.");

  test("@kle-preview manual task review survives reload and requires renewed confirmation after input changes", async ({ page }) => {
    const clientErrors: string[] = [];
    page.on("pageerror", (error) => clientErrors.push(error.message));
    await login(page);
    const name = `Syntetisk systemanvendelse ${crypto.randomUUID().slice(0, 8)}`;
    const task = "En fiktiv afdeling bruger løsningen til lokal drift og er afhængig af fælles login.";
    const rationale = "En driftsafbrydelse stopper den fiktive opgave; fælles login skal indgå i vurderingen.";
    const legacy = "Digital drift\nSystemadministration";
    const confirm = page.getByRole("button", { name: "Bekræft min gennemgang", exact: true });

    await page.getByRole("textbox", { name: "Navn på systemanvendelsen", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "Tidligere fritekst om arbejdsopgaver", exact: true }).fill(legacy);
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(page.getByText(/Tidligere fritekst er bevaret som ubekræftet grundlag:/)).toContainText("Digital drift, Systemadministration");
    await page.getByLabel("Vælg KLE-emner fra eksemplerne", { exact: true }).fill("DEMO.00.01");
    await page.getByRole("checkbox", { name: /DEMO\.00\.01/ }).check();
    await page.getByLabel(TASK_LABEL, { exact: true }).fill(task);
    await expect(page.getByRole("status").filter({ hasText: /^Direkte eksempelmatch$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Se kildegrundlag for Eksempelopgave/ })).toHaveCount(2);
    await page.getByLabel(LEVEL_LABEL, { exact: true }).selectOption("high");
    await page.getByLabel("Begrund vurderingen", { exact: true }).fill(rationale);
    await expect(confirm).toHaveCount(0);
    await expect(page.getByText("Gem kladden, før du bekræfter din gennemgang.", { exact: true })).toBeVisible();

    const createdResponse = waitForSave(page, "create");
    await page.getByRole("button", { name: "Gem registrering", exact: true }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const { usage } = await created.json();
    expect(usage.name).toBe(name);
    expect(usage.source).toBe("synthetic");
    expect(usage.review.legacyTopics).toEqual(["Digital drift", "Systemadministration"]);
    expect(usage.review.selectedCodes.map((selection: { code: string }) => selection.code)).toEqual(["DEMO.00.01"]);
    expect(usage.review.confirmation).toBeUndefined();
    await expect(confirm).toBeEnabled();

    await page.reload();
    await page.getByRole("combobox", { name: "Dine eksempelregistreringer", exact: true }).selectOption(usage.id);
    await expect(page.getByLabel(TASK_LABEL, { exact: true })).toHaveValue(task);
    await expect(page.getByRole("textbox", { name: "Tidligere fritekst om arbejdsopgaver", exact: true })).toHaveValue(legacy);
    await expect(page.getByLabel(LEVEL_LABEL, { exact: true })).toHaveValue("high");
    await expect(page.getByLabel("Begrund vurderingen", { exact: true })).toHaveValue(rationale);
    await expect(page.getByRole("checkbox", { name: /DEMO\.00\.01/ })).toBeChecked();

    const beforeConfirm = Date.now();
    const confirmedResponse = waitForSave(page, "confirm");
    await confirm.click();
    const confirmed = await confirmedResponse;
    expect(confirmed.status()).toBe(200);
    expect(confirmed.request().postDataJSON().review.confirmation).toBeUndefined();
    const { usage: confirmedUsage } = await confirmed.json();
    expect(confirmedUsage.rowVersion).toBe(usage.rowVersion + 1);
    expect(confirmedUsage.review.confirmation.confirmedBy).toBeTruthy();
    expect(Date.parse(confirmedUsage.review.confirmation.confirmedAt)).toBeGreaterThanOrEqual(beforeConfirm);
    await expect(page.getByText(CONFIRMED_LABEL, { exact: true })).toBeVisible();
    await expect(page.locator(`time[datetime="${confirmedUsage.review.confirmation.confirmedAt}"]`)).toBeVisible();
    const persistedResponse = await page.request.get(`/api/system-usages?id=${usage.id}`, { headers });
    expect(persistedResponse.status()).toBe(200);
    expect((await persistedResponse.json()).usage.review.confirmation).toEqual(confirmedUsage.review.confirmation);

    await page.getByLabel(TASK_LABEL, { exact: true }).fill(`${task} En ny integration tilføjes.`);
    await expect(page.getByText(UNCONFIRMED_LABEL, { exact: true })).toBeVisible();
    await expect(page.getByText(CONFIRMED_LABEL, { exact: true })).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await page.getByRole("button", { name: "Vurderingen er genlæst og passer stadig", exact: true }).click();
    await expect(confirm).toBeEnabled();

    const changedResponse = waitForSave(page, "save");
    await page.getByRole("button", { name: "Gem registrering", exact: true }).click();
    const changed = await changedResponse;
    expect(changed.status()).toBe(200);
    expect((await changed.json()).usage.review.confirmation).toBeUndefined();
    await page.reload();
    await page.getByRole("combobox", { name: "Dine eksempelregistreringer", exact: true }).selectOption(usage.id);
    await expect(page.getByText(UNCONFIRMED_LABEL, { exact: true })).toBeVisible();
    await expect(page.getByLabel(TASK_LABEL, { exact: true })).toHaveValue(`${task} En ny integration tilføjes.`);
    await expect(confirm).toBeEnabled();
    expect(clientErrors).toEqual([]);
  });

  test("@kle-preview manual selection is keyboard accessible and preserves readable desktop and mobile layouts", async ({ page }, testInfo) => {
    await login(page);
    const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Arbejdsopgaver og lokal kritikalitet" }) });
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");

    const search = page.getByLabel("Vælg KLE-emner fra eksemplerne", { exact: true });
    await expect(search).toHaveAccessibleDescription(/Valg af en gruppe tilføjer ikke automatisk dens underemner/);
    await search.focus();
    await page.keyboard.press("Tab");
    const group = page.getByRole("checkbox", { name: /DEMO\.00 Eksempelgruppe/ });
    await expect(group).toBeFocused();
    await page.keyboard.press("Space");
    await expect(group).toBeChecked();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: /DEMO\.00\.01/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /udgået emne/ })).toHaveCount(0);
    await page.getByLabel(TASK_LABEL, { exact: true }).fill("Fiktiv afhængighed til login for flere arbejdsopgaver.");
    await expect(page.getByRole("status").filter({ hasText: /^Ingen match i eksemplerne$/ })).toBeVisible();

    const possible = page.getByRole("checkbox", { name: /DEMO\.00\.02/ });
    await possible.focus();
    await page.keyboard.press("Space");
    await expect(possible).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: /^Muligt eksempelmatch$/ })).toBeVisible();
    await expect(page.getByText(/Manglende match fritager ikke et system fra sikkerhedskrav/)).toBeVisible();
    await page.getByRole("link", { name: /Se kildegrundlag for Eksempelopgave C/ }).click();
    await expect(page.getByRole("heading", { name: "Kildegrundlag for afprøvningen", exact: true })).toBeInViewport();
    await page.getByLabel(LEVEL_LABEL, { exact: true }).selectOption("needs-clarification");
    await page.getByLabel("Begrund vurderingen", { exact: true }).fill("Konsekvenserne for de øvrige arbejdsopgaver skal afklares i den fiktive organisation.");

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})));
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const audit = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`kle-preview-${viewport.width}.png`), fullPage: true });
    }
  });

  test("@kle-preview retry after a lost create response preserves the draft without creating a duplicate usage", async ({ page }) => {
    await login(page);
    const name = `Syntetisk genforsøg ${crypto.randomUUID().slice(0, 8)}`;
    const requestIds: string[] = [];
    let createdId = "";
    await page.route("**/api/system-usages", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || request.postDataJSON()?.action !== "create") {
        await route.continue();
        return;
      }
      requestIds.push(request.postDataJSON().id);
      if (requestIds.length !== 1) {
        await route.continue();
        return;
      }
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      createdId = (await committed.json()).usage.id;
      await route.abort("failed");
    });
    await page.getByRole("textbox", { name: "Navn på systemanvendelsen", exact: true }).fill(name);
    await page.getByLabel(TASK_LABEL, { exact: true }).fill("Fiktiv kladde til afprøvning af en afbrudt forbindelse.");
    await page.getByRole("button", { name: "Gem registrering", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Registreringen kunne ikke gemmes");
    await expect(page.getByRole("textbox", { name: "Navn på systemanvendelsen", exact: true })).toHaveValue(name);
    await expect(page.getByLabel(TASK_LABEL, { exact: true })).toHaveValue("Fiktiv kladde til afprøvning af en afbrudt forbindelse.");
    expect(createdId).toBeTruthy();
    const firstRead = await page.request.get("/api/system-usages", { headers });
    expect(firstRead.status()).toBe(200);
    expect((await firstRead.json()).usages.filter((usage: { name: string }) => usage.name === name)).toHaveLength(1);

    const retryResponse = waitForSave(page, "create");
    await page.getByRole("button", { name: "Gem registrering", exact: true }).click();
    const retried = await retryResponse;
    expect(retried.status()).toBe(201);
    const { usage } = await retried.json();
    expect(usage.id).toBe(createdId);
    expect(usage.rowVersion).toBe(1);
    expect(requestIds).toEqual([createdId, createdId]);
    const finalRead = await page.request.get("/api/system-usages", { headers });
    expect(finalRead.status()).toBe(200);
    expect((await finalRead.json()).usages.filter((candidate: { name: string }) => candidate.name === name)).toHaveLength(1);
    await expect(page.getByRole("combobox", { name: "Dine eksempelregistreringer", exact: true })).toHaveValue(createdId);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("@kle-preview API protects personal drafts, rejects stale or malformed writes and ignores forged confirmation", async ({ page, browser }) => {
    await login(page);
    const anonymous = await browser.newContext({ baseURL: process.env.DGITA_E2E_BASE_URL });
    const administrator = await browser.newContext({ baseURL: process.env.DGITA_E2E_BASE_URL });
    try {
      const id = crypto.randomUUID();
      const name = `Syntetisk adgangsprøve ${id.slice(0, 8)}`;
      const review = createEmptyKleReview();
      const createdResponse = await page.request.post("/api/system-usages", { headers, data: {
        action: "create", id, name,
        review: { ...review, confirmation: { inputBinding: "forged-client-binding", confirmedBy: "forged-administrator", confirmedAt: "2000-01-01T00:00:00.000Z" } },
      } });
      expect(createdResponse.status()).toBe(201);
      const { usage: created } = await createdResponse.json();
      expect(created.review).toEqual(review);
      expect(created.review.confirmation).toBeUndefined();
      expect(created.rowVersion).toBe(1);
      const read = async () => {
        const response = await page.request.get(`/api/system-usages?id=${id}`, { headers });
        expect(response.status()).toBe(200);
        return (await response.json()).usage;
      };

      const anonymousRead = await anonymous.request.get(`/api/system-usages?id=${id}`, { headers });
      expect(anonymousRead.status()).toBe(401);
      const foreignOrigin = await page.request.post("/api/system-usages", {
        headers: { Origin: "https://foreign.example.invalid" },
        data: { action: "save", id, name: "Uønsket ændring", review, expectedRowVersion: 1 },
      });
      expect(foreignOrigin.status()).toBe(403);
      expect(await read()).toEqual(created);

      const malformed = await page.request.post("/api/system-usages", { headers, data: {
        action: "save", id, name, review, expectedRowVersion: 1, recordedBy: "forged-owner",
      } });
      expect(malformed.status()).toBe(400);
      expect(await read()).toEqual(created);

      const adminLogin = await administrator.request.post("/api/auth/dev-login", { headers, data: { role: "admin" } });
      expect(adminLogin.status()).toBe(200);
      expect((await administrator.request.get(`/api/system-usages?id=${id}`, { headers })).status()).toBe(404);
      const adminList = await administrator.request.get("/api/system-usages", { headers });
      expect(adminList.status()).toBe(200);
      expect((await adminList.json()).usages.some((usage: { id: string }) => usage.id === id)).toBe(false);
      const otherUserWrite = await administrator.request.post("/api/system-usages", { headers, data: {
        action: "save", id, name: "Anden brugers ændring", review, expectedRowVersion: 1,
      } });
      expect(otherUserWrite.status()).toBe(404);
      expect(await read()).toEqual(created);

      const updatedReview = { ...review, localTaskDescription: "En opdateret fiktiv arbejdsopgave." };
      const updateResponse = await page.request.post("/api/system-usages", { headers, data: {
        action: "save", id, name, review: updatedReview, expectedRowVersion: 1,
      } });
      expect(updateResponse.status()).toBe(200);
      const { usage: updated } = await updateResponse.json();
      expect(updated.rowVersion).toBe(2);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.review).toEqual(updatedReview);
      const staleWrite = await page.request.post("/api/system-usages", { headers, data: {
        action: "save", id, name: "Forældet kladde", review, expectedRowVersion: 1,
      } });
      expect(staleWrite.status()).toBe(409);
      expect(await read()).toEqual(updated);
    } finally {
      await anonymous.close();
      await administrator.close();
    }
  });
});
