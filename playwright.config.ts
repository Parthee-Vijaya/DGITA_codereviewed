import { defineConfig } from "@playwright/test";

// This suite runs against the isolated synthetic server managed by ci-server.
const baseURL = process.env.DGITA_E2E_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error("Accessibility tests require an isolated local DGITA_E2E_BASE_URL.");
}
export default defineConfig({
  testDir: "./tests/a11y",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  outputDir: "work/ci/a11y/browser",
  reporter: [["list"], ["json", { outputFile: "work/ci/a11y/browser-results.json" }]],
  use: { baseURL, timezoneId: "Europe/Copenhagen", browserName: "chromium", viewport: { width: 1280, height: 900 }, trace: "off", screenshot: "off", video: "off" },
});
