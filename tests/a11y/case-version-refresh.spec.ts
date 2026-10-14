import { test, expect } from "@playwright/test";
import { demoApplicationState } from "../../features/application/engine";
import type { CaseRecord } from "../../features/workspace/model";
import type { PortalNotification } from "../../features/notifications/use-notifications";

const headers = { Origin: process.env.DGITA_E2E_BASE_URL! };

test("a notification for the open case refreshes its version before decisions and preserves unfinished input", async ({ page, request }) => {
  const clientErrors: string[] = [];
  page.on("pageerror", (error) => clientErrors.push(error.name));
  await page.addInitScript(() => localStorage.setItem("dgita-onboarding-v1-complete", "true"));
  // A separate applicant session changes the real case while the consultant stays on its first version.
  expect((await request.post("/api/auth/dev-login", { headers, data: { role: "user" } })).status()).toBe(200);
  const [approver] = (await (await request.get("/api/approvers")).json()).approvers;
  const originalPurpose = "Version et: adgangene skal beskrives af systemejeren.";
  const revisedPurpose = "Version to: systemejeren gennemgår og dokumenterer adgangene hver måned.";
  const submitted = await request.post("/api/drafts", { headers, data: {
    id: crypto.randomUUID(), status: "submitted", draft: {
      ...structuredClone(demoApplicationState), knownSystem: "nej", selectedSystem: null,
      manualSystemName: `Syntetisk versionsopdatering ${crypto.randomUUID().slice(0, 8)}`,
      catalogQuery: "", purpose: originalPurpose, consent: true, aiUsage: "nej",
      approvingLeaderId: approver.id, approvingLeader: approver.name,
    },
  } });
  expect(submitted.status()).toBe(200);
  const item = await submitted.json() as { id: string; caseNumber: string };
  expect((await page.request.post("/api/auth/dev-login", { headers, data: { role: "consultant" } })).status()).toBe(200);
  const readCase = async () => (await (await page.request.get("/api/cases")).json()).cases
    .find((candidate: CaseRecord) => candidate.id === item.caseNumber) as CaseRecord;
  const first = await readCase();
  // Only notification delivery is simulated; both immutable versions and all permissions are real.
  let notification: PortalNotification | null = null;
  await page.route("**/api/notifications", (route) => route.fulfill({ json: {
    unreadCount: 0, notifications: notification ? [notification] : [],
  } }));
  await page.goto(`/?view=detail&case=${item.caseNumber}`);
  const tabs = page.getByRole("navigation", { name: "Sagens indhold", exact: true });
  await tabs.getByRole("button", { name: "ansøgning", exact: true }).click();
  const snapshot = page.locator(".snapshot.plain-section");
  await expect(snapshot.getByText("Version 1 · låst", { exact: true })).toBeVisible();
  await snapshot.getByRole("button", { name: /Værdi for kommunen/ }).click();
  await expect(snapshot.locator(".fact").filter({ hasText: originalPurpose })).toBeVisible();
  await tabs.getByRole("button", { name: "overblik", exact: true }).click();
  await page.getByRole("button", { name: "Afvis endeligt", exact: true }).click();
  const form = page.locator('form[aria-label="Endeligt afslag"]');
  const reason = "Denne ugemte begrundelse må ikke forsvinde, når samme sag får en ny version.";
  const reasonInput = form.locator("textarea");
  const submit = form.getByRole("button", { name: "Bekræft endeligt afslag", exact: true, includeHidden: true });
  await reasonInput.fill(reason);

  const returned = await page.request.post("/api/workspace", { headers, data: {
    action: "application.request-information", caseId: item.caseNumber,
    expectedVersionId: first.currentVersionId, expectedRowVersion: first.revision,
    reason: "Beskriv systemejerens løbende kontrol af adgangene.", dueDate: "2099-12-01",
  } });
  expect(returned.status()).toBe(200);
  const correctionResponse = await request.post("/api/drafts", { headers, data: { action: "begin-correction", caseNumber: item.caseNumber } });
  expect(correctionResponse.status()).toBe(200);
  const correction = (await correctionResponse.json()).draft;
  const resubmitted = await request.post("/api/drafts", { headers, data: {
    id: item.id, status: "submitted", expectedRowVersion: correction.rowVersion,
    draft: { ...correction.state, purpose: revisedPurpose, consent: true },
  } });
  expect(resubmitted.status()).toBe(200);
  expect((await resubmitted.json()).versionNumber).toBe(2);
  const latest = await readCase();
  expect(latest.currentVersionId).not.toBe(first.currentVersionId);
  notification = { id: crypto.randomUUID(), eventType: "application.resubmitted",
    title: `${item.caseNumber} er genindsendt`, body: "Version 2 er indsendt til D-GITA.",
    caseNumber: item.caseNumber, linkPath: `/?case=${item.caseNumber}`, status: "read", createdAt: new Date().toISOString() };
  const notificationsLoaded = page.waitForResponse((response) => response.url().endsWith("/api/notifications"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await notificationsLoaded;
  await page.getByRole("button", { name: "Notifikationer", exact: true }).click();
  const notice = page.locator(".notification-panel .notice").filter({ hasText: notification.title });
  let caseReads = 0;
  let decisionWrites = 0;
  page.on("request", (outgoing) => {
    if (outgoing.url().endsWith("/api/cases") && outgoing.method() === "GET") caseReads += 1;
    if (outgoing.url().endsWith("/api/workspace") && outgoing.method() === "POST" &&
      ["approval.reject", "application.request-information"].includes(outgoing.postDataJSON()?.action)) decisionWrites += 1;
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await notice.click();
  await expect(reasonInput).toHaveValue(reason);
  expect(caseReads).toBe(0);

  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
  let detailRequested!: () => void;
  const detailStarted = new Promise<void>((resolve) => { detailRequested = resolve; });
  await page.route(`**/api/cases/${item.caseNumber}/detail`, async (route) => {
    const response = await route.fetch();
    detailRequested();
    await detailGate;
    await route.fulfill({ response });
  });
  try {
    page.once("dialog", (dialog) => dialog.accept());
    await notice.click();
    await detailStarted;
    await expect(page.getByText("Henter de gemte formulardata…", { exact: true })).toBeVisible();
    await expect(form).toBeHidden();
    await expect(submit).toBeDisabled();
    await expect(reasonInput).toHaveValue(reason);
    expect(decisionWrites).toBe(0);
    releaseDetail();
    await expect(form).toBeVisible();
    await expect(reasonInput).toHaveValue(reason);
    await expect(form.getByRole("alert")).toContainText("Sagen er ændret");
    await expect(submit).toBeDisabled();
    await form.getByRole("button", { name: "Annuller", exact: true }).click();
    await tabs.getByRole("button", { name: "ansøgning", exact: true }).click();
    await expect(snapshot.getByText("Version 2 · låst", { exact: true })).toBeVisible();
    await snapshot.getByRole("button", { name: /Værdi for kommunen/ }).click();
    await expect(snapshot.locator(".fact").filter({ hasText: revisedPurpose })).toBeVisible();
    await expect(snapshot).not.toContainText(originalPurpose);
    expect(decisionWrites).toBe(0);
    expect(clientErrors).toEqual([]);
  } finally {
    releaseDetail();
    await page.unrouteAll({ behavior: "wait" });
  }
});
