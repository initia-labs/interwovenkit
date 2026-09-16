import type { Locator, Page } from "@playwright/test"
import { parseTransaction } from "viem"
import { BASE_USDC, RECIPIENT, usdc } from "./constants"
import type { RequestContext } from "./depositApi"
import { coded, makeDeposit, ok, sequence } from "./depositApi"
import type { MockNetwork } from "./harness"
import {
  amountInput,
  approveButton,
  connectTestWallet,
  depositButton,
  expect,
  grantAllowance,
  openTxDetails,
  openWalletDeposit,
  selectSource,
  shot,
  submitDeposit,
  test,
  trackingTitle,
} from "./harness"
import { decodeErc20Approve } from "./rpc"

/* Base → Ethereum → iUSD through the Deposit API's LI.FI leg: options, the
 * ranked default, the picker, approval, the verbatim bridge transaction, and
 * the whole bridge-status pipeline.
 * Cases S03, Q01, Q03, Q12, X03, X04, T01, T02, T05, T06, T08, T09, T11, T04. */

const AMOUNT = "0.5"
const BASE_UNITS = usdc(AMOUNT)
const ETHEREUM_DELIVERY_HASH = `0x${"cd".repeat(32)}`

async function openLifiForm(page: Page, net: MockNetwork) {
  net.rpc.state(8453).tokenBalances[BASE_USDC.toLowerCase()] = usdc("10")
  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Base")
  await amountInput(page).fill(AMOUNT)
}

/** bridge_not_found → bridge_pending → deposit_pending → deposit_indexed. */
function bridgePipeline(net: MockNetwork, states?: string[]) {
  const script = states ?? [
    "bridge_not_found",
    "bridge_pending",
    "deposit_pending",
    "deposit_indexed",
  ]
  return (ctx: RequestContext) => {
    const state = script[Math.min(ctx.index, script.length - 1)]
    const srcTxHash = ctx.url.searchParams.get("src_tx_hash") ?? ""
    const srcChainId = Number(ctx.url.searchParams.get("src_chain_id") ?? "8453")
    const hasDelivery = state === "deposit_pending" || state === "deposit_indexed"
    return ok({
      state,
      // The wire sends this as a JSON integer.
      src_chain_id: srcChainId,
      src_tx_hash: srcTxHash,
      src_tx_link: `https://basescan.org/tx/${srcTxHash}`,
      ...(hasDelivery
        ? {
            dst_tx_hash: ETHEREUM_DELIVERY_HASH,
            dst_tx_link: `https://etherscan.io/tx/${ETHEREUM_DELIVERY_HASH}`,
          }
        : {}),
      bridge: "across",
      deposit:
        state === "deposit_indexed"
          ? makeDeposit({
              // The nested Deposit describes the *Ethereum* receiving leg.
              src_chain_id: "1",
              src_tx_hash: ETHEREUM_DELIVERY_HASH,
              amount: "497500",
              amount_out: "497500",
              deposit_address: net.api.state.depositAddress,
              wallet_address: RECIPIENT,
              bucket: "waiting",
            })
          : null,
    })
  }
}

test("opens the picker, chooses an alternate route, and keeps it on back @mobile", async ({
  page,
  net,
}, info) => {
  grantAllowance(net, 8453, BASE_USDC)
  await openLifiForm(page, net)

  await expect(depositButton(page)).toBeEnabled()
  await openTxDetails(page)
  await providerRow(page, "AcrossV4").click()

  await expect(page.getByRole("heading", { name: "Select provider" })).toBeVisible()
  await expect(pickerRow(page, "AcrossV4")).toBeVisible()
  await expect(pickerRow(page, "StargateV2 (Fast mode)")).toBeVisible()
  // Ineligible routes stay visible with their reason, and cannot be chosen.
  const ineligible = pickerRow(page, "Symbiosis")
  await expect(ineligible).toBeDisabled()
  await expect(page.getByText(/Below the .* minimum/)).toBeVisible()
  await shot(page, info, "route-picker")

  await pickerRow(page, "StargateV2 (Fast mode)").click()

  // Choosing returns straight to the form; there is no extra "use route" step.
  await expect(page.getByRole("region", { name: "Transfer form" })).toBeVisible()
  await openTxDetails(page)
  await expect(providerRow(page, "StargateV2 (Fast mode)")).toBeVisible()
  await expect(depositButton(page)).toBeEnabled()

  // The new quote is requested for the chosen key only.
  await expect
    .poll(() =>
      net.api.requests.some(
        (request) => request.path === "v1/bridges/quote" && request.json.bridge === "stargateV2",
      ),
    )
    .toBe(true)

  // Back from the picker changes nothing.
  await providerRow(page, "StargateV2 (Fast mode)").click()
  await expect(page.getByRole("heading", { name: "Select provider" })).toBeVisible()
  // The page transition keeps the outgoing page mounted; wait for it to settle
  // so only the picker's back arrow is present.
  await expect(page.getByRole("button", { name: "Go back" })).toHaveCount(1)
  await page.getByRole("button", { name: "Go back" }).click()
  await openTxDetails(page)
  await expect(providerRow(page, "StargateV2 (Fast mode)")).toBeVisible()
})

test("requires approval, then sends the quote's transaction verbatim", async ({
  page,
  net,
}, info) => {
  await openLifiForm(page, net)
  net.api.scenario.bridgeStatus = bridgePipeline(net)
  net.api.scenario.deposit = sequence([
    ok(makeDeposit({ bucket: "waiting" })),
    ok(makeDeposit({ bucket: "processing", advance_status: "none" })),
    ok(
      makeDeposit({
        bucket: "completed",
        status: "completed",
        amount: "497500",
        amount_out: "497500",
      }),
    ),
  ])

  // --- approval -------------------------------------------------------------
  await expect(approveButton(page)).toBeEnabled()
  await expect(depositButton(page)).toHaveCount(0)
  await shot(page, info, "approval-required")

  await approveButton(page).click()
  await expect.poll(() => net.rpc.sent.length, { timeout: 30_000 }).toBe(1)
  const [approval] = net.rpc.sent
  expect(approval.chainId).toBe(8453)
  expect(approval.to.toLowerCase()).toBe(BASE_USDC.toLowerCase())
  const approved = decodeErc20Approve(approval)
  expect(approved.spender.toLowerCase()).toBe(net.api.state.approvalSpender.toLowerCase())
  expect(approved.amount).toBe(BigInt(BASE_UNITS))

  // The raised allowance turns the single action into Deposit — a separate,
  // deliberate second click.
  await expect(depositButton(page)).toBeEnabled({ timeout: 60_000 })
  await shot(page, info, "approved-ready")

  // --- deposit --------------------------------------------------------------
  await submitDeposit(page, net)
  expect(net.rpc.sent).toHaveLength(2)
  const bridgeTx = net.rpc.sent[1]
  const parsed = parseTransaction(bridgeTx.raw)
  expect(parsed.chainId).toBe(8453)
  expect(parsed.to?.toLowerCase()).toBe(net.api.state.bridgeTx.to.toLowerCase())
  expect(parsed.data).toBe(net.api.state.bridgeTx.data)
  // The nonzero native protocol fee must survive verbatim.
  expect(parsed.value).toBe(BigInt(net.api.state.bridgeTx.value))
  // `gas` is deliberately not asserted: `createTestWalletConnector` drops the
  // `gas` field of `eth_sendTransaction` and lets viem re-estimate, so the
  // quote's `gas_limit` cannot be observed on the wire through this wallet.

  // --- tracking -------------------------------------------------------------
  await expect(trackingTitle(page, "Deposit in progress")).toBeVisible()
  await expect(
    page.getByText("Your transaction was sent. We're waiting for the bridge to pick it up."),
  ).toBeVisible({ timeout: 60_000 })
  await shot(page, info, "progress-bridge-not-found")

  await expect(page.getByText("Your USDC is being bridged to Ethereum.")).toBeVisible({
    timeout: 60_000,
  })
  await shot(page, info, "progress-bridge-pending")

  await expect(
    page.getByText("Your USDC reached Ethereum. We're waiting for the deposit to be detected."),
  ).toBeVisible({ timeout: 60_000 })
  await shot(page, info, "progress-deposit-pending")

  await expect(page.getByText("Your deposit is confirming on Ethereum.")).toBeVisible({
    timeout: 60_000,
  })
  await expect(trackingTitle(page, "Transfer complete")).toBeVisible({ timeout: 90_000 })
  await shot(page, info, "progress-lifi-completed")

  // The saved tool stays display context: the status request never hints it.
  const statusRequests = net.api.requests.filter((r) => r.path === "v1/bridges/status")
  expect(statusRequests.length).toBeGreaterThan(0)
  for (const request of statusRequests) {
    expect(request.search).not.toContain("bridge=")
    expect(request.search).toContain("deposit_address=")
  }
  expect(net.rpc.sent).toHaveLength(2)
})

test("a stale quote that changed requires another deliberate click", async ({
  page,
  net,
}, info) => {
  grantAllowance(net, 8453, BASE_USDC)
  await openLifiForm(page, net)
  await expect(depositButton(page)).toBeEnabled()

  // Options and quotes are not polled; the quote refreshes when the user clicks
  // on one that has aged past the 10 s freshness window. Change what the next
  // refresh returns, then wait for the current quote to go stale.
  net.api.state.quoteRevision = 1500
  await page.waitForTimeout(11_000)

  // Click 1: refreshes the stale quote. It never reaches the wallet, and no
  // awaited network call sits between the click and a prompt.
  await depositButton(page).click()
  await expect(page.getByText("Quote updated. Review and confirm again.")).toBeVisible({
    timeout: 30_000,
  })
  expect(net.rpc.sent).toHaveLength(0)
  await shot(page, info, "quote-updated")

  // Click 2, on the fresh quote the notice describes, is the confirmation and
  // sends exactly those numbers. A separate acknowledge-only click would push
  // a slow reader past the freshness window and into another refresh.
  await submitDeposit(page, net)
  expect(net.rpc.sent).toHaveLength(1)
  await expect(page.getByText("Quote updated. Review and confirm again.")).toHaveCount(0)
})

test("no eligible route blocks review with the server minimum", async ({ page, net }, info) => {
  grantAllowance(net, 8453, BASE_USDC)
  net.api.state.options = [
    {
      bridge: "across",
      amount_out: "90000",
      min_received: "80000",
      eligible: false,
      execution_duration_seconds: 60,
    },
  ]
  await openLifiForm(page, net)

  await expect(
    page.getByText(/No route can bring at least 0\.1 USDC to Ethereum after fees/),
  ).toBeVisible()
  await expect(depositButton(page)).toBeDisabled()
  await expect(approveButton(page)).toHaveCount(0)
  await shot(page, info, "no-eligible-route")
  expect(net.rpc.sent).toHaveLength(0)
})

test("an upstream_conflict on status is a hard recovery state", async ({ page, net }, info) => {
  grantAllowance(net, 8453, BASE_USDC)
  await openLifiForm(page, net)
  net.api.scenario.bridgeStatus = () =>
    coded(502, "upstream_conflict", "provider evidence conflicts with the request")

  await submitDeposit(page, net)

  await expect(page.getByText("Couldn't verify this transfer")).toBeVisible({ timeout: 90_000 })
  await expect(
    page.getByText(/We've stopped automatic tracking so nothing is inferred/),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible()
  await shot(page, info, "upstream-conflict")

  // Nothing about delivery is inferred, and nothing is ever resent.
  await expect(page.getByText("Transfer complete")).toHaveCount(0)
  expect(net.rpc.sent).toHaveLength(1)

  // Polling stopped: a manual refresh is the only further read.
  const before = net.api.counts["v1/bridges/status"] ?? 0
  await page.waitForTimeout(10_000)
  expect((net.api.counts["v1/bridges/status"] ?? 0) - before).toBeLessThanOrEqual(1)
})

test("a nested deposit that fails identity validation never completes", async ({ page, net }) => {
  grantAllowance(net, 8453, BASE_USDC)
  await openLifiForm(page, net)
  net.api.scenario.bridgeStatus = (ctx) => {
    const srcTxHash = ctx.url.searchParams.get("src_tx_hash") ?? ""
    return ok({
      state: "deposit_indexed",
      src_chain_id: Number(ctx.url.searchParams.get("src_chain_id") ?? "8453"),
      src_tx_hash: srcTxHash,
      src_tx_link: "",
      dst_tx_hash: ETHEREUM_DELIVERY_HASH,
      deposit: makeDeposit({
        src_chain_id: "1",
        src_tx_hash: ETHEREUM_DELIVERY_HASH,
        deposit_address: net.api.state.depositAddress,
        // Someone else's recipient at the same reused address.
        wallet_address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfmgxjw",
        bucket: "completed",
      }),
    })
  }

  await submitDeposit(page, net)

  await expect(page.getByText("Couldn't verify this transfer")).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText("Transfer complete")).toHaveCount(0)
})

/** The provider control inside Transaction details (icon + name → doubled name). */
function providerRow(page: Page, name: string): Locator {
  return page.getByRole("region", { name: "Transfer form" }).getByRole("button", { name })
}

/** A row in the Select provider list; named by its `aria-label`. */
function pickerRow(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true })
}
