import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoApplicationState } from "../../features/application/engine";

const clientErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  clientErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.name));
});
test.afterEach(({ page }) => expect(clientErrors.get(page)).toEqual([]));

async function audit(page: Page, scope?: string) {
  // Inspect the settled state, including disabled-to-enabled color transitions.
  // Waiting for actual finite animations avoids sampling an intermediate color.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})));
  });
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (scope) builder = builder.include(scope);
  const result = await builder.analyze();
  // Report only rule IDs and selectors, never rendered case text or auth state.
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

async function openForm(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const login = await page.request.post("/api/auth/dev-login", { headers: { Origin: process.env.DGITA_E2E_BASE_URL! }, data: { role: "user" } });
  expect(login.status()).toBe(200);
  const state = structuredClone(demoApplicationState);
  Object.assign(state, { knownSystem: "nej", manualSystemName: "Syntetisk tilgængelighedstest", selectedSystem: null, approvingLeaderId: "synthetic-approver", approvingLeader: "Testgodkender", applicantName: "Testanmoder", applicantEmail: "applicant@example.invalid" });
  await page.route("**/api/approvers", (route) => route.fulfill({ json: { approvers: [{ id: "synthetic-approver", name: "Testgodkender" }] } }));
  // Accessibility fixtures isolate rendering/focus from persistence; API lifecycle has its own E2E suite.
  await page.route("**/api/drafts**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { draft: { id: "a11y-draft", caseNumber: "A11Y-001", state, rowVersion: 1 } } });
    const submitted = route.request().postDataJSON()?.status === "submitted";
    return route.fulfill({ json: { id: "a11y-draft", caseNumber: "A11Y-001", status: submitted ? "submitted" : "draft", rowVersion: 2,
      ...(submitted ? { versionNumber: 1, submittedAt: "2026-10-05T10:00:00.000Z", mode: "draft" } : {}) } });
  });
  await page.goto("/?view=application&draft=A11Y-001");
  await expect(page.getByRole("heading", { name: "Generelle oplysninger", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "1. Ved du allerede nu hvilket IT-system du vil indkøbe?", exact: true })).toBeVisible();
}

test("pilot login remains accessible and keyboard operable", async ({ page }) => {
  await page.goto("/login");
  const select = page.getByRole("combobox", { name: /Rolle/ });
  await expect(select).toBeEnabled();
  await audit(page);
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Fortsæt til portalen/ })).toBeFocused();
});

test("cost inputs, hints and invalid form steps have accessible names and focus", async ({ page }) => {
  await openForm(page);
  await page.getByRole("button", { name: "Investering", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Investering", exact: true })).toBeFocused();
  for (const label of ["34. Engangsomkostninger", "35. Årlige driftsudgifter", "36. Andre omkostninger i første år"]) await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "33.1 Eksisterende budgetbeløb", exact: true })).toBeVisible();
  await audit(page, ".application-sheet");
  await page.getByRole("textbox", { name: "34. Engangsomkostninger", exact: true }).fill("ikke et beløb");
  await page.getByRole("button", { name: /Næste|Fortsæt/ }).click();
  await expect(page.locator(".form-message.error")).toBeFocused();
  const invalid = page.getByRole("textbox", { name: "34. Engangsomkostninger", exact: true });
  await expect(invalid).toHaveAttribute("aria-invalid", "true");
  await expect(invalid).toHaveAccessibleDescription(/beløb|tal|gyldig/i);
  await audit(page, ".application-sheet");
});

test("radio arrows keep one tab stop and final validation focuses its summary", async ({ page }) => {
  await openForm(page);
  const group = page.getByRole("radiogroup", { name: "1. Ved du allerede nu hvilket IT-system du vil indkøbe?", exact: true });
  await expect(group).toHaveAccessibleDescription(/KITOS/);
  const no = group.getByRole("radio", { name: "Nej", exact: true });
  await no.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(group.getByRole("radio", { name: "Ja", exact: true })).toBeFocused();
  await expect(group.getByRole("radio", { name: "Ja", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  await expect(no).toBeFocused();
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Gennemse", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gennemse", exact: true })).toBeFocused();
  await page.getByRole("button", { name: /indsend/i }).click();
  await expect(page.locator(".form-message.error")).toBeFocused();
  await expect(page.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("checkbox")).toHaveAccessibleDescription(/kontroll|bekræft/i);
  await audit(page, ".application-sheet");
});

test("upload has specific name, requirements and persistent live failure feedback", async ({ page }) => {
  await openForm(page);
  await page.getByRole("button", { name: "Risiko & data", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Har du allerede en kontrakt?", exact: true }).getByRole("radio", { name: "Ja", exact: true }).click();
  const upload = page.getByLabel("Vælg fil til Upload kontrakt", { exact: true });
  await expect(upload).toHaveAccessibleDescription(/25 MB/);
  const group = page.locator(".upload-group").filter({ has: upload });
  await expect(group.locator('[aria-live="polite"]')).toBeAttached();
  await upload.setInputFiles({ name: "synthetic-invalid.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic") });
  await expect(group.locator('[aria-live="polite"]')).toContainText(/Vælg en fil af typen.*PDF.*DOCX.*XLSX/);
  await audit(page, ".application-sheet");
});


test("tutorial dialog traps keyboard focus and restores the profile trigger", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const response = await page.request.post("/api/auth/dev-login", { headers: { Origin: process.env.DGITA_E2E_BASE_URL! }, data: { role: "user" } });
  expect(response.status()).toBe(200);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/workspace")), page.goto("/")]);
  const profile = page.locator('[data-tour="profile"]');
  await profile.click();
  await page.getByRole("button", { name: "Tutorial", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeFocused();
  await audit(page, '[role="dialog"]');
  const last = dialog.getByRole("button").last();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(profile).toBeFocused();
});


test("all ten application steps can be opened by keyboard without axe findings", async ({ page }) => {
  await openForm(page);
  for (const label of ["Generelle oplysninger", "Systemoplysninger", "Anskaffelsesform", "Værdi for kommunen", "Investering", "Risiko & data", "Implementering", "IT-krav", "Øvrige", "Gennemse"]) {
    const step = page.getByRole("button", { name: label, exact: true });
    await step.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeFocused();
    await audit(page, ".application-sheet");
  }
});

test("leader approval and version-bound HTML receipt preserve focus, access and PDF bytes", async ({ page, browser }) => {
  const origin = process.env.DGITA_E2E_BASE_URL!;
  const headers = { Origin: origin };
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const approvers = await (await page.request.get("/api/approvers")).json();
  const approver = approvers.approvers[0];
  expect(approver).toBeTruthy();
  const state = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualCatalogEntry: false, manualSystemName: "Syntetisk tastaturgodkendelse", catalogQuery: "", approvingLeaderId: approver.id, approvingLeader: approver.name, consent: true };
  const submitted = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft: state, status: "submitted" } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "consultant" } })).status()).toBe(200);
  const issued = await page.request.post(`/api/cases/${encodeURIComponent(caseNumber)}/approval-request`, { headers });
  expect(issued.status()).toBe(202);
  const { approvalTokenForRequest } = await import("../../features/approval/token-service");
  const token = await approvalTokenForRequest((await issued.json()).id, origin);
  await page.goto(`/approve/${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: /^Hej / })).toBeVisible();
  // Native keyboard activation must survive hydration and update the accessible outcome.
  const reject = page.getByRole("button", { name: "Afvis", exact: true });
  await expect(reject).toBeEnabled();
  await reject.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("textbox")).toHaveAccessibleDescription(/begrundelse/);
  await audit(page);
  await page.getByRole("textbox").fill("Syntetisk test af beslutning");
  await page.getByRole("button", { name: "Godkend version", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Godkendelsen er registreret", exact: true })).toBeFocused();
  await audit(page);
  const pdfBefore = await page.request.get(`/api/cases/${caseNumber}/receipt?kind=approval`);
  expect(pdfBefore.status()).toBe(200);
  const beforeHash = pdfBefore.headers()["x-content-sha256"];
  const html = await page.goto(`/cases/${caseNumber}/receipt?kind=approval`);
  expect(html?.status()).toBe(200);
  expect(html?.headers()["cache-control"]).toContain("no-store");
  expect(html?.headers()["x-robots-tag"]).toContain("noindex");
  const version = new URL(page.url()).searchParams.get("version");
  expect(version).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Godkendelseskvittering", exact: true })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("lang", "da-DK");
  await expect(page.getByText("Syntetisk test af beslutning", { exact: true })).toBeVisible();
  await audit(page);
  const pdfAfter = await page.request.get(`/api/cases/${caseNumber}/receipt?kind=approval&version=${version}`);
  expect(pdfAfter.status()).toBe(200);
  expect(pdfAfter.headers()["x-content-sha256"]).toBe(beforeHash);
  expect(await pdfAfter.body()).toEqual(await pdfBefore.body());
  const anonymous = await browser.newContext();
  try {
    const denied = await anonymous.request.get(page.url(), { maxRedirects: 0 });
    expect(denied.status()).toBe(307);
    expect(denied.headers().location).toContain("/login");
  } finally { await anonymous.close(); }
});


async function expectReflow(page: Page, info: TestInfo, scope: string, label: string) {
  const measured = await page.evaluate((selector) => {
    const viewport = document.documentElement.clientWidth;
    const root = document.querySelector(selector)!;
    const overflow = [root, ...root.querySelectorAll("*")].flatMap((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden") return [];
      if (box.left >= -1 && box.right <= viewport + 1) return [];
      return [{ tag: element.tagName, class: element.className, left: Math.round(box.left), right: Math.round(box.right) }];
    });
    return { viewport, documentWidth: document.documentElement.scrollWidth, overflow };
  }, scope);
  if (measured.documentWidth > measured.viewport + 1 || measured.overflow.length) {
    await info.attach(`reflow-${label}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
  expect(measured, `No horizontal page/content overflow at ${label}`).toEqual({ viewport: 320, documentWidth: 320, overflow: [] });
}

async function expectFocusUncovered(page: Page, info: TestInfo, label: string) {
  try {
    await expect.poll(async () => page.evaluate(() => {
      const target = document.activeElement!.getBoundingClientRect();
      const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
      return { belowHeader: target.top >= Math.max(0, headerBottom) - 1, aboveBottom: target.bottom <= innerHeight + 1 };
    }), { message: "Focused item must remain visible below the sticky header" }).toEqual({ belowHeader: true, aboveBottom: true });
  } catch (error) {
    await info.attach(`focus-${label}`, { body: await page.screenshot(), contentType: "image/png" });
    throw error;
  }
}

test("320 CSS-pixel form reflows through all steps and submits with keyboard", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openForm(page);
  await page.getByRole("button", { name: "Generelle oplysninger", exact: true }).focus();
  await page.keyboard.press("Enter");
  const steps = ["Generelle oplysninger", "Systemoplysninger", "Anskaffelsesform", "Værdi for kommunen", "Investering", "Risiko & data", "Implementering", "IT-krav", "Øvrige", "Gennemse"];
  for (const [index, step] of steps.entries()) {
    await expect(page.getByRole("heading", { name: step, exact: true })).toBeFocused();
    await expectReflow(page, info, ".application-page", `step-${index + 1}`);
    await expectFocusUncovered(page, info, `step-${index + 1}`);
    await audit(page, ".application-sheet");
    if (index < steps.length - 1) {
      await page.getByRole("button", { name: "Fortsæt", exact: true }).focus();
      await page.keyboard.press("Enter");
    }
  }
  const submit = page.getByRole("button", { name: "Gem og indsend", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".form-message.error")).toBeFocused();
  await expectReflow(page, info, ".application-page", "final-validation");
  await expectFocusUncovered(page, info, "final-validation");
  const consent = page.getByRole("checkbox");
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  // Walk the native tab order to the final action instead of clicking it.
  for (let index = 0; index < 5 && !(await submit.evaluate((element) => element === document.activeElement)); index++) await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await expectFocusUncovered(page, info, "action");
  const sent = page.waitForRequest((request) => request.url().includes("/api/drafts") && request.method() === "POST" && request.postDataJSON()?.status === "submitted");
  await page.keyboard.press("Enter");
  expect((await sent).postDataJSON().draft.consent).toBe(true);
  await expect(page.getByText("Ansøgningen er versionslåst og indsendt sikkert.", { exact: true })).toBeVisible();
});

test("320 CSS-pixel HTML receipt reflows and its actions work in native keyboard order", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const { approvers } = await (await page.request.get("/api/approvers")).json();
  const state = { ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null, manualCatalogEntry: false,
    manualSystemName: "Syntetisk kvittering ved smal visning", catalogQuery: "", approvingLeaderId: approvers[0].id, approvingLeader: approvers[0].name,
    remarks: "Lang ubrudt syntetisk reference: " + "REFERENCE".repeat(18), consent: true };
  const submitted = await page.request.post("/api/drafts", { headers, data: { id: crypto.randomUUID(), draft: state, status: "submitted" } });
  expect(submitted.status()).toBe(200);
  const { caseNumber } = await submitted.json();
  await page.goto(`/cases/${caseNumber}/receipt?kind=submission`);
  await expect(page.getByRole("heading", { name: "Indsendelseskvittering", exact: true })).toBeVisible();
  await expectReflow(page, info, ".receipt-document", "receipt");
  await audit(page);
  const back = page.getByRole("link", { name: "Tilbage til sagen", exact: true });
  const pdf = page.getByRole("link", { name: "Hent indsendelseskvittering som PDF", exact: true });
  await page.keyboard.press("Tab"); await expect(back).toBeFocused(); await expectFocusUncovered(page, info, "action");
  await page.keyboard.press("Tab"); await expect(pdf).toBeFocused(); await expectFocusUncovered(page, info, "action");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await page.keyboard.press("Shift+Tab"); await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: state.manualSystemName, exact: true })).toBeVisible();
});
