import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState } from "../../features/application/engine";
import { relationFromSystem } from "../../features/catalog/relations";

const origin = process.env.DGITA_E2E_BASE_URL!;
const headers = { Origin: origin };

test("replacement and addon preserve catalog selections, explain legacy text and clear obsolete answers", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.name));
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const catalogResponse = await page.request.get("/api/catalog?q=Navision");
  expect(catalogResponse.status()).toBe(200);
  const catalog = await catalogResponse.json();
  const system = catalog.results[0];
  expect(system.id).toBeTruthy();
  expect(catalog.metadata.sourceUpdatedAt).toBeNull();
  const draft = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualCatalogEntry: false,
    manualSystemName: "Syntetisk relationsprøve", catalogQuery: "", replacesExisting: "ja", replacementSystem: "Tidligere fritekstsvar",
    acquisitionType: "tilkøb", relatedSystem: "Lokalt system", consent: true };
  delete draft.replacementCatalogRelation;
  delete draft.relatedCatalogRelation;
  const saved = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft, status: "draft" } });
  expect(saved.status()).toBe(200);
  const { caseNumber } = await saved.json();
  const readDraft = async () => (await (await page.request.get(`/api/drafts?caseNumber=${caseNumber}`)).json()).draft.state;
  await page.goto(`/?view=application&draft=${caseNumber}`);
  const replacement = page.getByRole("textbox", { name: "2.1 Hvilket system erstattes?", exact: true });
  await expect(replacement).toHaveValue("Tidligere fritekstsvar");
  await expect(page.getByText(/Tekst alene er ikke et katalogvalg/)).toBeVisible();
  await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
  await expect(replacement).toHaveAttribute("aria-invalid", "true");
  await expect(replacement).toHaveAccessibleDescription(/kun gemt som tekst/);
  await replacement.fill("Navision");
  await page.getByRole("button", { name: `Vælg ${system.name}`, exact: true }).click();
  await expect(replacement).toHaveValue(system.name);
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  await expect.poll(async () => (await readDraft()).replacementCatalogRelation?.id).toBe(system.id);
  await page.reload();
  await expect(replacement).toHaveValue(system.name);
  await expect(page.locator(".catalog-selection")).toContainText(system.name);
  const manualName = page.getByRole("textbox", { name: "9. IT-systemnavn", exact: true });
  await manualName.fill("");
  await manualName.pressSequentially("Nyt systemnavn");
  await expect(replacement).toHaveValue(system.name);
  await expect(page.locator(".catalog-selection")).toContainText(system.name);
  await manualName.fill("Nyt systemnavn med rettet stavning");
  await expect(replacement).toHaveValue(system.name);
  await page.getByRole("button", { name: "Anskaffelsesform", exact: true }).click();
  const relatedQuestion = page.getByRole("group", { name: "27.1 Hvilket eksisterende system vedrører tilkøbet?", exact: true });
  const related = relatedQuestion.getByRole("textbox", { name: "Systemet, tilkøbet vedrører", exact: true });
  await expect(related).toHaveValue("Lokalt system");
  await relatedQuestion.getByRole("button", { name: "Systemet kan ikke findes – registrér manuelt", exact: true }).click();
  const reason = relatedQuestion.getByRole("textbox", { name: "Hvorfor registreres systemet manuelt?", exact: true });
  await page.getByRole("button", { name: "Fortsæt", exact: true }).click();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toHaveAccessibleDescription(/Begrund/);
  await reason.fill("Dette lokale system findes ikke i kataloget.");
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  await expect.poll(async () => (await readDraft()).relatedCatalogRelation).toEqual({ kind: "manual", reason: "Dette lokale system findes ikke i kataloget." });
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
  const audit = await new AxeBuilder({ page }).include(".application-sheet").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  await page.getByRole("button", { name: "Gennemse", exact: true }).click();
  await expect(page.locator(".review-line").filter({ hasText: "Erstatter system" })).toContainText(system.name);
  await expect(page.locator(".review-line").filter({ hasText: "Tilkøb til system" })).toContainText("Lokalt system");
  await page.getByRole("button", { name: "Anskaffelsesform", exact: true }).click();
  const acquisition = page.getByRole("radiogroup", { name: "27. Nyanskaffelse / tilkøb", exact: true });
  await acquisition.getByRole("radio", { name: "Nyanskaffelse", exact: true }).click();
  await acquisition.getByRole("radio", { name: "Tilkøb", exact: true }).click();
  await expect(related).toHaveValue("");
  await expect(reason).toHaveCount(0);
  await acquisition.getByRole("radio", { name: "Nyanskaffelse", exact: true }).click();
  await page.getByRole("button", { name: "Generelle oplysninger", exact: true }).click();
  const replaces = page.getByRole("radiogroup", { name: "2. Erstatter det et allerede eksisterende IT-system?", exact: true });
  await replaces.getByRole("radio", { name: "Nej", exact: true }).click();
  await replaces.getByRole("radio", { name: "Ja", exact: true }).click();
  await expect(replacement).toHaveValue("");
  await page.getByRole("button", { name: "Gem kladde", exact: true }).click();
  await expect.poll(async () => (await readDraft()).replacementCatalogRelation).toBeNull();
  await expect.poll(async () => (await readDraft()).relatedSystem).toBe("");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(clientErrors).toEqual([]);
});

test("saved case detail shows the catalog reference and manual reason after repeated reloads", async ({ page }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.name));
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const system = (await (await page.request.get("/api/catalog?q=Navision")).json()).results[0];
  const approver = (await (await page.request.get("/api/approvers")).json()).approvers[0];
  expect(system.id).toBeTruthy();
  expect(approver.id).toBeTruthy();
  const reason = "Det lokale analysesystem er ikke registreret i katalogudtrækket.";
  const draft = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualCatalogEntry: false,
    manualSystemName: "Syntetisk relationsvisning", catalogQuery: "", consent: true,
    approvingLeaderId: approver.id, approvingLeader: approver.name,
    replacesExisting: "ja", replacementSystem: system.name, replacementCatalogRelation: relationFromSystem(system),
    acquisitionType: "tilkøb", relatedSystem: "Lokalt analysesystem", relatedCatalogRelation: { kind: "manual", reason } };
  const id = crypto.randomUUID();
  const savedResponse = await page.request.post("/api/drafts", { headers, data: { id, draft, status: "draft" } });
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  const submittedResponse = await page.request.post("/api/drafts", { headers, data: { id, draft, status: "submitted", expectedRowVersion: saved.rowVersion } });
  expect(submittedResponse.status()).toBe(200);
  const submitted = await submittedResponse.json();
  const detailPath = `/api/cases/${encodeURIComponent(submitted.caseNumber)}/detail`;
  const firstDetail = await (await page.request.get(detailPath)).json();
  const expectedSnapshot = firstDetail.snapshot;
  expect(expectedSnapshot.replacementCatalogRelation).toEqual(relationFromSystem(system));
  expect(expectedSnapshot.relatedCatalogRelation).toEqual({ kind: "manual", reason });

  await page.goto(`/?view=detail&case=${submitted.caseNumber}`);
  for (let reload = 0; reload < 2; reload += 1) {
    if (reload) await page.reload();
    await page.getByRole("navigation", { name: "Sagens indhold", exact: true }).getByRole("button", { name: "ansøgning", exact: true }).click();
    const snapshot = page.locator(".snapshot.plain-section");
    await expect(snapshot.getByText("Version 1 · låst", { exact: true })).toBeVisible();
    await snapshot.getByRole("button", { name: /Generelle oplysninger/ }).click();
    const replacement = snapshot.locator(".fact").filter({ has: page.getByText("System, der erstattes", { exact: true }) });
    const catalogBasis = snapshot.locator(".fact").filter({ has: page.getByText("System, der erstattes · grundlag", { exact: true }) });
    await expect(replacement.locator("strong")).toHaveText(system.name);
    await expect(catalogBasis.locator("strong")).toHaveText("Valgt i systemkataloget");
    await snapshot.getByRole("button", { name: /System og anskaffelsesform/ }).click();
    const related = snapshot.locator(".fact").filter({ has: page.getByText("System, tilkøbet vedrører", { exact: true }) });
    const manualBasis = snapshot.locator(".fact").filter({ has: page.getByText("System, tilkøbet vedrører · grundlag", { exact: true }) });
    await expect(related.locator("strong")).toHaveText("Lokalt analysesystem");
    await expect(manualBasis.locator("strong")).toHaveText(`Manuel registrering: ${reason}`);
    expect((await (await page.request.get(detailPath)).json()).snapshot).toEqual(expectedSnapshot);
  }
  expect(clientErrors).toEqual([]);
});
