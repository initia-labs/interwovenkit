import { defineConfig, devices } from "@playwright/test"

// Port differs from `pnpm dev` (17303) so the suite can run next to a dev server.
const PORT = 17304

export default defineConfig({
  testDir: "./e2e",
  // Transactions on a shared account must not race for the sequence.
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Chromium only. Neither Playwright's Chromium nor its WebKit blocks popups, so the spec
  // asserts the task boundary itself rather than relying on a browser's popup blocker.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
