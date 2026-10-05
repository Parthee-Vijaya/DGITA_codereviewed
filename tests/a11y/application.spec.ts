import { test, expect, type Page } from "@playwright/test";
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
    return route.fulfill({ json: { id: "a11y-draft", caseNumber: "A11Y-001", status: "draft", rowVersion: 2 } });
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
  for (const label of ["34. Engangsomkostninger", "35. Årlige driftsudgifter", "36. Andre omkostninger"]) await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
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
  await expect(group.locator('[aria-live="polite"]')).toContainText(/tilladt|filtype|understøtt|mislykkedes/i);
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
