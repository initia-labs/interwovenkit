import type { Page } from "@playwright/test"
import { BASE_USDC, usdc } from "./constants"
import type { MockNetwork } from "./harness"
import {
  amountInput,
  connectTestWallet,
  depositButton,
  expect,
  grantAllowance,
  openWalletDeposit,
  selectSource,
  test,
} from "./harness"

/* Wallet-popup timing for the Deposit click.
 *
 * Popup wallets (Privy) call `window.open()` when asked to sign, and Safari only
 * keeps the click's user activation for the task that dispatched the click plus
 * its microtasks — any real async wait moves to a later task and the popup is
 * blocked. `examples/vite/e2e/wallet-popup.spec.ts` observes that boundary for
 * the Cosmos approval path.
 *
 * The EVM deposit path cannot reuse `?simulatePopup` as-is: the test wallet only
 * routes `personal_sign` through `signThroughSimulatedPopup`, so
 * `eth_sendTransaction` never opens a window and `__openedInClickTask` stays
 * undefined. These specs instrument the RPC traffic instead, which measures the
 * same property directly. */

declare global {
  interface Window {
    __openedInClickTask?: boolean
    __rpcTiming?: { method: string; inClickTask: boolean }[]
  }
}

const RPC_HOST_FRAGMENTS = ["publicnode.com", "base.org", "arbitrum.io"]

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fragments: string[]) => {
    let inClickTask = false
    document.addEventListener(
      "click",
      () => {
        inClickTask = true
        // A zero-delay timeout marks where Safari would drop the activation:
        // microtasks still run inside it, a later task does not.
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

    window.__rpcTiming = []
    const original = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const body = init?.body
        if (typeof body === "string" && fragments.some((fragment) => url.includes(fragment))) {
          const parsed: unknown = JSON.parse(body)
          const calls = Array.isArray(parsed) ? parsed : [parsed]
          for (const call of calls as { method?: string }[]) {
            window.__rpcTiming?.push({ method: call.method ?? "?", inClickTask })
          }
        }
      } catch {
        // Instrumentation must never change what the app does.
      }
      return original(input, init)
    }
  }, RPC_HOST_FRAGMENTS)
})

async function openReadyLifiForm(page: Page, net: MockNetwork) {
  net.rpc.state(8453).tokenBalances[BASE_USDC.toLowerCase()] = usdc("10")
  grantAllowance(net, 8453, BASE_USDC)

  await connectTestWallet(page, "?simulatePopup")
  await openWalletDeposit(page)
  await selectSource(page, "Base")
  await amountInput(page).fill("0.5")
  await expect(depositButton(page)).toBeEnabled()
}

/** Clicks until one click actually broadcasts, returning that click's traces. */
async function measureSendingClick(page: Page, net: MockNetwork) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const apiRequestsBefore = net.api.requests.length
    await page.evaluate(() => {
      window.__rpcTiming = []
    })
    await depositButton(page).click()
    try {
      await expect.poll(() => net.rpc.sent.length, { timeout: 8_000 }).toBe(1)
    } catch {
      // The click refreshed a stale quote instead of sending; measure the next.
      continue
    }
    return {
      apiRequestsDuringClick: net.api.requests.slice(apiRequestsBefore),
      timing: (await page.evaluate(() => window.__rpcTiming ?? [])).filter(
        (entry) => entry.method !== "?",
      ),
    }
  }
  throw new Error("Deposit never reached the wallet")
}

test("no Deposit API call sits between the Deposit click and the wallet request", async ({
  page,
  net,
}) => {
  await openReadyLifiForm(page, net)
  const { apiRequestsDuringClick } = await measureSendingClick(page, net)

  // The stale/changed-quote gates refresh and hand the user back the button
  // rather than awaiting a round trip inside the click, so a sending click must
  // make no pre-send Deposit API call. Tracking reads (`v1/bridges/status`,
  // `v1/deposits/...`) start after the broadcast and are not part of that path.
  const PRE_SEND_PATHS = [
    "v1/config/assets",
    "v1/deposit-address",
    "v1/quote",
    "v1/bridges/options",
    "v1/bridges/quote",
  ]
  expect(
    apiRequestsDuringClick
      .map((request) => request.path)
      .filter((path) => PRE_SEND_PATHS.includes(path)),
  ).toEqual([])
  expect(net.rpc.sent).toHaveLength(1)
})

/* Known gap, reported rather than fixed (see the agent report): the send path
 * runs through ethers' `BrowserProvider`, whose `send()` schedules every request
 * through `setTimeout` before `JsonRpcSigner.sendTransaction` additionally awaits
 * `getBlockNumber` (and `estimateGas` when the quote carries no `gas_limit`).
 * The wallet is therefore asked several tasks and two network round trips after
 * the click, which is exactly what Safari's popup rule forbids.
 *
 * Marked `fail` so the suite stays green on today's behavior and turns red the
 * moment the ordering is fixed. */
test.fail(
  "the Deposit click should reach the wallet inside the click's task",
  async ({ page, net }) => {
    await openReadyLifiForm(page, net)
    const { timing } = await measureSendingClick(page, net)

    expect(timing.length).toBeGreaterThan(0)
    const broadcastIndex = timing.findIndex((entry) => entry.method === "eth_sendRawTransaction")
    const beforeBroadcast = timing.slice(0, Math.max(broadcastIndex, 0))
    expect(
      beforeBroadcast.filter((entry) => !entry.inClickTask),
      `RPC calls left the Deposit click's task before the wallet was asked: ${JSON.stringify(timing)}`,
    ).toEqual([])
  },
)
