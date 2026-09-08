import { expect, type Page, test } from "@playwright/test"

/* Popup-based wallets (Privy) call `window.open()` when asked to sign. Safari allows that
 * only while the click's user activation is alive, and it keeps the activation for the task
 * that dispatched the click plus its microtasks. Any real async wait (a network round trip,
 * a timer) moves on to a later task and the popup is blocked.
 *
 * Playwright's browsers allow popups unconditionally, so instead of relying on a popup
 * blocker this spec observes the task boundary directly: a zero-delay timeout scheduled by
 * the click marks where Safari would have lost the activation, and `window.open` records
 * whether it ran before that. The test wallet's `simulatePopup` mode calls `window.open`
 * exactly where Privy would.
 *
 * Requires `INITIA_TEST_MNEMONIC` for a funded account in `examples/vite/.env`. The
 * positive case broadcasts a 1 uinit self-transfer and pays its fee. */

declare global {
  interface Window {
    __openedInClickTask?: boolean
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let inClickTask = false
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
      window.__openedInClickTask = inClickTask
      return open(...args)
    }
  })
})

async function openApproval(page: Page) {
  await expect(page.getByRole("heading", { name: "Send" })).toBeVisible()

  // wagmi reconnects a previously used wallet on load, so the page may already be connected.
  const connect = page.getByRole("button", { name: "Connect" })
  if (await connect.isVisible()) {
    await connect.click()
    await page.getByRole("button", { name: "Test Wallet" }).click()
  }

  // Send form: the approval drawer path (requestTxBlock) rather than direct signing.
  const form = page.locator("form", { hasText: "Send" })
  await form.getByLabel("Use direct signing").uncheck()
  await form.getByLabel("Amount").fill("1")
  await form.getByRole("button", { name: "Submit" }).click()

  const approve = page.getByRole("button", { name: "Approve" })
  // Disabled until the account sequence is prefetched.
  await expect(approve).toBeEnabled({ timeout: 30_000 })
  return { form, approve }
}

const openedInClickTask = (page: Page) => page.evaluate(() => window.__openedInClickTask)

test("wallet popup is requested within the Approve click's task", async ({ page }) => {
  await page.goto("/?simulatePopup")
  const { form, approve } = await openApproval(page)

  await approve.click()

  // Signing continued past the popup and the transaction went through.
  await expect(form.locator("pre")).toHaveText(/^[0-9A-F]{64}$/, { timeout: 90_000 })
  expect(await openedInClickTask(page)).toBe(true)
})

test("a wait before the wallet request leaves the click's task (negative control)", async ({
  page,
}) => {
  await page.goto("/?simulatePopup&popupDelayMs=1500")
  const { form, approve } = await openApproval(page)

  await approve.click()

  await expect(form.locator("pre")).toHaveText(/^[0-9A-F]{64}$/, { timeout: 90_000 })
  expect(await openedInClickTask(page)).toBe(false)
})
