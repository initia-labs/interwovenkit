import type { Page, TestInfo } from "@playwright/test"
import { expect, test as base } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEPOSIT_API_ORIGIN, SENDER } from "./constants"
import { type ApiMock, createDepositApiMock } from "./depositApi"
import { createRpcMock, RPC_HOSTS, type RpcMock } from "./rpc"

/* Hosts that serve the production Deposit API. Reaching one would be a request
 * against real money, so they are recorded and aborted. */
const FORBIDDEN_API_HOSTS = ["deposit-api.staging.initia.xyz", "li.quest"]

/** The cash path's Onramper proxy lives on the production Deposit API host and
 * has nothing to do with this flow; both hub reads fail open. */
const ONRAMPER_HOST = "deposit-api.initia.xyz"

const DEPOSIT_API_HOST = new URL(DEPOSIT_API_ORIGIN).hostname

export interface MockNetwork {
  rpc: RpcMock
  api: ApiMock
  /** Requests that escaped every mock, as a human-readable line. Must stay empty. */
  escaped: string[]
}

export const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__screenshots__",
)

/** JSON-RPC method names in a request body (ethers batches into an array). */
function jsonRpcMethods(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body)
    const calls = Array.isArray(parsed) ? parsed : [parsed]
    return calls
      .map((call) => (call as { method?: unknown }).method)
      .filter((method): method is string => typeof method === "string")
  } catch {
    return []
  }
}

const isEvmRpc = (methods: string[]) =>
  methods.length > 0 && methods.every((method) => /^(eth|net|web3)_/.test(method))

export const test = base.extend<{ net: MockNetwork }>({
  net: async ({ page }, use) => {
    const escaped: string[] = []
    const rpc = createRpcMock(SENDER)
    const api = createDepositApiMock()

    /* One interception point for everything that leaves the page. Routing by
     * request content rather than by a list of RPC URLs is deliberate: the
     * widget's pinned endpoint comes from the Deposit API source catalog and
     * the test wallet's comes from its own defaults, so a hardcoded URL list
     * silently stops covering a chain the moment either changes. Here an EVM
     * RPC call to an unmapped host is an escape, and the test says which host. */
    await page.route(
      (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
      async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const host = url.hostname
        const body = request.postData()
        const methods = body ? jsonRpcMethods(body) : []

        const fulfillJson = (status: number, payload: unknown, headers?: Record<string, string>) =>
          route.fulfill({
            status,
            contentType: "application/json",
            headers,
            body: JSON.stringify(payload ?? {}),
          })

        if (host === DEPOSIT_API_HOST) {
          const reply = api.handle({ method: request.method(), url, body })
          await fulfillJson(reply.status, reply.body, reply.headers)
          return
        }

        if (host === ONRAMPER_HOST) {
          await fulfillJson(503, { message: "cash path disabled in the mocked suite" })
          return
        }

        const chainId = RPC_HOSTS[host]
        if (chainId !== undefined && isEvmRpc(methods)) {
          await fulfillJson(200, rpc.handle(chainId, JSON.parse(body ?? "{}")))
          return
        }

        if (isEvmRpc(methods)) {
          escaped.push(`EVM RPC to un-mocked host ${host}: ${methods.join(", ")}`)
          await route.abort("blockedbyclient")
          return
        }

        if (FORBIDDEN_API_HOSTS.includes(host)) {
          escaped.push(`${request.method()} ${request.url()}`)
          await route.abort("blockedbyclient")
          return
        }

        // Read-only public data (Router registry, chain registry, fonts, logos).
        await route.continue()
      },
    )

    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture callback, not a React hook
    await use({ rpc, api, escaped })

    expect(
      escaped,
      "a request escaped the mocks and would have reached a real RPC or Deposit API",
    ).toEqual([])
    // Nothing may be broadcast that the fake node did not record; every spec
    // asserts the contents of each recorded broadcast individually.
    for (const sent of rpc.sent) {
      expect(sent.raw.startsWith("0x")).toBe(true)
    }
  },
})

export { expect }

/**
 * Saves a state screenshot under `e2e/mock/__screenshots__/` (gitignored).
 * Waits out the page/height transitions first so the capture shows the settled
 * state rather than a frame mid-animation.
 */
export async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(600)
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${info.project.name}-${name}.png`),
    fullPage: false,
  })
}

/** Opens the example app and connects the in-memory test wallet. */
export async function connectTestWallet(page: Page, search = "") {
  await page.goto(`/${search}`)
  await expect(page.getByRole("heading", { name: "Send" })).toBeVisible()

  const connect = page.getByRole("button", { name: "Connect", exact: true })
  if (await connect.isVisible()) {
    await connect.click()
    await page.getByRole("button", { name: "Test Wallet" }).click()
  }
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeHidden()
}

/** Clicks a header action, opening the mobile menu first when it is collapsed. */
async function headerAction(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true })
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "Menu" }).click()
  }
  await button.click()
}

/** Opens the deposit hub for iUSD and enters "Deposit via wallet". */
export async function openWalletDeposit(page: Page) {
  await headerAction(page, "Deposit iUSD")
  await expect(page.getByRole("button", { name: /Deposit via wallet/ })).toBeVisible()
  await page.getByRole("button", { name: /Deposit via wallet/ }).click()
}

/** Opens the deposit hub for iUSD without choosing a method. */
export async function openDepositHub(page: Page) {
  await headerAction(page, "Deposit iUSD")
  await expect(page.getByRole("button", { name: /Deposit via wallet/ })).toBeVisible()
}

/** Opens the withdraw flow (Router-owned; must be unaffected by the Deposit API). */
export async function openWithdraw(page: Page) {
  await headerAction(page, "Withdraw")
}

export const sourceRow = (page: Page, chainName: string) =>
  page.getByRole("button", { name: new RegExp(`USDC\\s+on ${chainName}`) })

/** Picks a source from the list and lands on the transfer form. */
export async function selectSource(page: Page, chainName: string) {
  await expect(sourceRow(page, chainName)).toBeVisible()
  await sourceRow(page, chainName).click()
  await expect(page.getByRole("region", { name: "Transfer form" })).toBeVisible()
}

/** The transfer form itself; scoping matters because the demo page has its own
 * "Amount" field for the Send form. */
export const transferForm = (page: Page) => page.getByRole("region", { name: "Transfer form" })

export const amountInput = (page: Page) => transferForm(page).getByLabel("Amount")

/** The Deposit/Approve button in the form footer. */
export const depositButton = (page: Page) =>
  page.getByRole("button", { name: "Deposit", exact: true })

export const approveButton = (page: Page) =>
  page.getByRole("button", { name: "Approve USDC", exact: true })

/** Expands the collapsed "Transaction details" disclosure (closed by default). */
export async function openTxDetails(page: Page) {
  const toggle = page.getByRole("button", { name: /Transaction details/ })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
}

/** Pre-grants the quote's approval allowance so the footer's action is Deposit. */
export function grantAllowance(
  net: MockNetwork,
  chainId: number,
  token: string,
  amount = "1000000000000",
) {
  const spender = net.api.state.approvalSpender.toLowerCase()
  net.rpc.state(chainId).allowances[`${token.toLowerCase()}:${spender}`] = amount
}

/**
 * The tracking screen's title. Matched by name because `DepositPageTransition`
 * keeps the outgoing page mounted while it animates, so two subpage headings
 * exist for a moment after every navigation.
 */
export const trackingTitle = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true })

/**
 * Clicks Deposit until the wallet actually broadcasts.
 *
 * The form deliberately spends a click on a stale refresh or on acknowledging a
 * changed quote rather than putting an awaited network call between the click
 * and the wallet prompt, so a single click is not guaranteed to send. Tests that
 * are *about* that gate assert the copy directly instead of using this helper.
 */
export async function submitDeposit(page: Page, net: MockNetwork) {
  const before = net.rpc.sent.length
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(depositButton(page)).toBeEnabled()
    await depositButton(page).click()
    try {
      await expect.poll(() => net.rpc.sent.length, { timeout: 8_000 }).toBeGreaterThan(before)
      return
    } catch {
      // The click refreshed a stale quote (or acknowledged an updated one);
      // the next one sends it.
    }
  }
  throw new Error("Deposit never reached the wallet")
}
