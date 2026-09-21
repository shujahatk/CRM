import { defineConfig, devices } from "@playwright/test";
const port = process.env.PORT || "3210";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || (process.env.CI ? undefined : "chrome") } }],
  webServer: { command: "node scripts/with-test-env.mjs start", url: `http://127.0.0.1:${port}/login`, reuseExistingServer: false, timeout: 60000 },
});
