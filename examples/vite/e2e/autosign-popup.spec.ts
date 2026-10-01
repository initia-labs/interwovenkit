import { expect, type Page, test } from "@playwright/test"

/* Enabling a tab-only autosign signer derives it from a wallet signature, so a popup wallet
 * (Privy) opens twice: once for that signature on Enable and once for the grant on Approve.
 * Each must stay within its click's task; see wallet-popup.spec.ts for how that is observed.
 *
 * Requires `INITIA_TEST_MNEMONIC` for a funded account in `examples/vite/.env`. The test
 * broadcasts the grant and its revoke and pays both fees. */

declare global {
  interface Window {
    __popups: boolean[]
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let inClickTask = false
    window.__popups = []
    document.addEventListener(
      "click",
      () => {
        inClickTask = true
        setTimeout(() => {
          inClickTask = false
        }, 0)
      },
      true,
    )
    const open = window.open.bind(window)
    window.open = (...args) => {
      window.__popups.push(inClickTask)
      return open(...args)
    }
  })
})

// On narrow viewports the example app keeps the autosign toggle in its menu.
async function openMenu(page: Page) {
  const toggle = page.getByRole("button", { name: /^(Enable|Disable) auto sign$/ })
  const menu = page.getByRole("button", { name: "Menu" })
  await expect(toggle.or(menu).first()).toBeVisible({ timeout: 30_000 })
  if (!(await toggle.isVisible())) await menu.click()
}

async function disableAutoSign(page: Page) {
  await openMenu(page)
  await page.getByRole("button", { name: "Disable auto sign" }).click()
  const approve = page.getByRole("button", { name: "Approve" })
  await approve.click()
  await expect(approve).toBeHidden({ timeout: 90_000 })
  await openMenu(page)
  await expect(page.getByRole("button", { name: "Enable auto sign" })).toBeVisible({
    timeout: 90_000,
  })
}

test("autosign wallet popups are requested within their clicks' tasks", async ({ page }) => {
  await page.goto("/?simulatePopup&tabOnly")

  // wagmi reconnects a previously used wallet on load, so the page may already be connected.
  const connect = page.getByRole("button", { name: "Connect" })
  if (await connect.isVisible()) {
    await connect.click()
    await page.getByRole("button", { name: "Test Wallet" }).click()
  }

  await openMenu(page)
  // A grant left by an earlier run would replace the tab-only signer flow with renewal.
  const enable = page.getByRole("button", { name: "Enable auto sign" })
  const disable = page.getByRole("button", { name: "Disable auto sign" })
  await expect(enable.or(disable)).toBeEnabled({ timeout: 30_000 })
  if (await disable.isVisible()) await disableAutoSign(page)
  await page.evaluate(() => (window.__popups = []))

  await enable.click()
  const ignore = page.getByRole("button", { name: "Ignore" })
  const confirm = page.getByRole("button", { name: "Enable", exact: true })
  await expect(confirm.or(ignore).first()).toBeVisible({ timeout: 30_000 })
  if (await ignore.isVisible()) await ignore.click()
  // Disabled until the signer plan is known, so the click can ask for the signature first.
  await expect(confirm).toBeEnabled({ timeout: 30_000 })
  await confirm.click()

  const approve = page.getByRole("button", { name: "Approve" })
  await expect(approve).toBeEnabled({ timeout: 60_000 })
  await approve.click()
  await expect(approve).toBeHidden({ timeout: 90_000 })
  await openMenu(page)
  await expect(disable).toBeVisible({ timeout: 90_000 })

  expect(await page.evaluate(() => window.__popups)).toEqual([true, true])

  await disableAutoSign(page)
})
