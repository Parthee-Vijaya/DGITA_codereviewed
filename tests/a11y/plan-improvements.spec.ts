import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState } from "../../features/application/engine";
import type { ContentEntry } from "../../features/workspace/model";

const origin = process.env.DGITA_E2E_BASE_URL!;
const headers = { Origin: origin };
async function login(page: Page, role: string) {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role } })).status()).toBe(200);
}

async function contentEntries(page: Page): Promise<ContentEntry[]> {
  const response = await page.request.get("/api/workspace");
  expect(response.status()).toBe(200);
  return (await response.json()).workspace.content;
}
async function saveContent(page: Page, entry: ContentEntry) {
  expect((await page.request.post("/api/workspace", { headers, data: { action: "content.upsert", entry } })).status()).toBe(200);
}
async function restoreContent(page: Page, original: ContentEntry[], ids: string[]) {
  await login(page, "admin");
  for (const id of ids) {
    const entry = original.find((item) => item.id === id);
    if (entry) await saveContent(page, entry);
    else expect((await page.request.post("/api/workspace", { headers, data: { action: "content.delete", id } })).status()).toBe(200);
  }
}
const contactFixture: ContentEntry = {
  id: "contact.local.email", category: "portal_text", title: "Kontakt · e-mail",
  body: "contact-before@example.invalid", location: "Forside · Kontakt", published: true,
};

test("CMS loading and failure never reveal defaults; unpublished shortcuts stay hidden after reload", async ({ page }) => {
  await login(page, "admin");
  const original = await contentEntries(page);
  const fixtures: ContentEntry[] = [
    { id: "home.hero.note", category: "portal_text", title: "Syntetisk forsidebemærkning", body: "Syntetisk note til publiceringstest.", location: "Forside", published: true },
    { id: "home.resources.about.title", category: "portal_text", title: "Syntetisk genvej", body: "Om D-GITA", location: "Forside", published: true },
    contactFixture,
  ];
  const ids = fixtures.map((entry) => entry.id);
  try {
    for (const entry of fixtures) await saveContent(page, entry);
    for (const entry of fixtures) await saveContent(page, { ...entry, published: false });
    await login(page, "user");
    const payload = await (await page.request.get("/api/workspace")).json();
    for (const id of ids) {
      const item = payload.workspace.content.find((entry: { id: string }) => entry.id === id);
      expect(item.published).toBe(false);
      expect(item.body).toBe("");
      expect(item.url).toBeUndefined();
    }
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/workspace", async (route) => { await held; await route.continue(); });
    await page.goto("/?view=home");
    await expect(page.getByText("Henter portalindhold…", { exact: true })).toBeVisible();
    await expect(page.locator(".home-page")).toHaveCount(0);
    release();
    await expect(page.locator(".home-page")).toBeVisible();
    await page.unroute("**/api/workspace");
    for (let reload = 0; reload < 2; reload++) {
      await page.reload();
      await expect(page.locator(".home-page")).toBeVisible();
      await expect(page.locator(".hero-note")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Om D-GITA/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Book et formøde/ })).toHaveCount(0);
      await expect(page.locator('a[href="mailto:"]')).toHaveCount(0);
    }
    await page.goto("/?view=knowledge");
    await expect(page.locator(".knowledge-page")).toBeVisible();
    await expect(page.getByRole("link", { name: /Book et formøde|Kontakt D-GITA/ })).toHaveCount(0);
    await page.route("**/api/workspace", (route) => route.fulfill({ status: 503, json: { error: "Syntetisk indlæsningsfejl" } }));
    await page.reload();
    await expect(page.getByText("Portalindholdet kunne ikke hentes", { exact: true })).toBeVisible();
    await expect(page.locator(".knowledge-page")).toHaveCount(0);
    await page.unroute("**/api/workspace");
    await login(page, "admin");
    for (const entry of fixtures) await saveContent(page, entry);
    await login(page, "user");
    await page.goto("/?view=home");
    await expect(page.locator(".hero-note")).toBeVisible();
    await expect(page.getByRole("button", { name: /Om D-GITA/ })).toBeVisible();
  } finally {
    await restoreContent(page, original, ids);
  }
});

test("infrastructure explanation follows the existing review UI, focuses errors and remains internal", async ({ page }) => {
  await login(page, "user");
  const approver = (await (await page.request.get("/api/approvers")).json()).approvers[0];
  // Isolated CI dev-login enables its existing synthetic fixture seed unless explicitly disabled.
  expect(approver, "Integrationstesten kræver en syntetisk godkender med reelt mandat i testdatabasen.").toBeTruthy();
  const state = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualCatalogEntry: false,
    manualSystemName: "Syntetisk infrastrukturprøve", catalogQuery: "", approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true };
  const submitted = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft: state, status: "submitted" } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  await login(page, "consultant");
  await page.goto(`/?view=detail&case=${caseNumber}`);
  await page.getByRole("button", { name: "D-GITA godkendelse", exact: true }).click();
  const changes = page.getByRole("radiogroup", { name: "D-GITA felt: Medfører systemet ændringer i den eksisterende infrastruktur?", exact: true });
  await changes.getByRole("radio", { name: "Ja", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Beskriv ændringerne i infrastrukturen", exact: true });
  await expect(description).toBeVisible();
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute("aria-invalid", "true");
  await expect(description).toHaveAccessibleDescription(/Beskriv ændringerne/);
  await description.fill("Syntetisk intern netværksændring");
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect(page.getByText("D-GITA-godkendelsen er gemt med auditspor.", { exact: true })).toBeVisible();
  let saved = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber];
  expect(saved.infrastructureDescription).toBe("Syntetisk intern netværksændring");
  await changes.getByRole("radio", { name: "Nej", exact: true }).click();
  await expect(description).toHaveCount(0);
  await page.getByRole("button", { name: "Gem D-GITA-felter", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber].infrastructureDescription).toBe("");
  saved = (await (await page.request.get("/api/workspace")).json()).workspace.approvals[caseNumber];
  expect(saved.infrastructureChanges).toBe("Nej");
  // A stored response precedes the case/workspace refresh. Audit the ready UI,
  // after the save button has left its disabled state and its transitions settle.
  await expect(page.getByRole("button", { name: "Gem D-GITA-felter", exact: true })).toBeEnabled();
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
  const audit = await new AxeBuilder({ page }).include(".dgita-review-layout").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  await login(page, "user");
  expect(JSON.stringify(await (await page.request.get("/api/workspace")).json())).not.toContain("Syntetisk intern netværksændring");
});


test("contact editors explain the shared email and a saved change updates every contact link", async ({ page }) => {
  await login(page, "admin");
  const original = await contentEntries(page);
  const contactLink: ContentEntry = {
    id: "link.contact", category: "link", title: "Kontakt D-GITA", body: "Syntetisk kontaktvejledning.",
    url: "mailto:stale-link@example.invalid", location: "Links for testkommunen", published: true,
  };
  const explanation = "Kontaktlinket bruger den fælles e-mailadresse. Ret den under Portaltekster → Kontakt · e-mail.";
  const updatedEmail = "contact-after@example.invalid";
  try {
    await saveContent(page, contactFixture);
    await saveContent(page, contactLink);
    await page.goto("/?view=admin");
    await page.getByRole("navigation", { name: "Adminområder" }).getByRole("button", { name: "Links", exact: true }).click();
    const linkCard = page.locator(".content-editor-card").filter({ has: page.getByText("link.contact", { exact: true }) });
    await expect(linkCard.getByText(explanation, { exact: true })).toBeVisible();
    await expect(linkCard.getByRole("textbox", { name: "Linkadresse", exact: true })).toHaveCount(0);

    await page.goto("/?view=knowledge");
    await expect(page.getByRole("link", { name: /Kontakt D-GITA/ })).toHaveAttribute("href", `mailto:${contactFixture.body}`);
    await page.getByRole("button", { name: "Start editor", exact: true }).click();
    await page.getByRole("button", { name: "Redigér Kontakt D-GITA", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Redigér tekst", exact: true });
    await expect(drawer.getByText(explanation, { exact: true })).toBeVisible();
    await expect(drawer.getByRole("textbox", { name: "Linkadresse", exact: true })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Luk editor", exact: true }).click();

    await page.goto("/?view=admin");
    const emailCard = page.locator(".content-editor-card").filter({ has: page.getByText("contact.local.email", { exact: true }) });
    await emailCard.getByRole("textbox", { name: "Tekst", exact: true }).fill(updatedEmail);
    await emailCard.getByRole("button", { name: "Gem", exact: true }).click();
    await expect.poll(async () => (await contentEntries(page)).find((entry) => entry.id === "contact.local.email")?.body).toBe(updatedEmail);

    await login(page, "user");
    await page.goto("/?view=home");
    await expect(page.getByRole("link", { name: updatedEmail, exact: true })).toHaveAttribute("href", `mailto:${updatedEmail}`);
    await expect(page.getByRole("link", { name: /Book et formøde/ })).toHaveAttribute("href", `mailto:${updatedEmail}?subject=Ønske%20om%20D-GITA-formøde`);
    await page.goto("/?view=knowledge");
    await expect(page.getByRole("link", { name: /Kontakt D-GITA/ })).toHaveAttribute("href", `mailto:${updatedEmail}`);
    await expect(page.getByRole("link", { name: /Book et formøde/ })).toHaveAttribute("href", `mailto:${updatedEmail}?subject=Ønske%20om%20D-GITA-formøde`);
    await expect(page.locator('a[href^="mailto:stale-link@example.invalid"]')).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:contact-before@example.invalid"]')).toHaveCount(0);
  } finally {
    await restoreContent(page, original, [contactFixture.id, contactLink.id]);
  }
});
