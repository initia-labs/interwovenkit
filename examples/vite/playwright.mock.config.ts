import { defineConfig, devices } from "@playwright/test"

/* Mocked-browser acceptance suite for the Deposit API wallet flow.
 *
 * Deliberately separate from `playwright.config.ts`: that suite drives the real
 * wallet against real chains, while every request this one makes to an EVM RPC
 * or to the Deposit API is intercepted (see `e2e/mock/network.ts`). The web
 * server is therefore started with a THROWAWAY mnemonic and an unresolvable
 * Deposit API origin, so a missed interception fails loudly instead of touching
 * real money.
 *
 * Port differs from `pnpm dev` (17303), the watch server (17305) and the real
 * e2e suite (17304). */
const PORT = 17306

export default defineConfig({
  testDir: "./e2e/mock",
  // Shared localStorage session store + one dev server; keep the suite serial.
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "./test-results/mock",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      // Chromium at the narrow width the plan's mobile references were taken at.
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never adopt a server someone else started: its env would carry the real
    // wallet and the real staging Deposit API URL.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Public junk mnemonic (`.env.example`), address 0xf39F…2266. Never funded.
      INITIA_TEST_MNEMONIC: "test test test test test test test test test test test junk",
      INITIA_NETWORK_TYPE: "mainnet",
      INITIA_ROUTER_API_URL: "",
      // Unresolvable on purpose: any Deposit API request that escapes the
      // interception cannot reach a real backend, and the network guard fails
      // the test that let it through.
      INITIA_DEPOSIT_API_URL: "https://deposit-api.mock.invalid",
    },
  },
})
