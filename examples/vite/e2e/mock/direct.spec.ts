import type { Page } from "@playwright/test"
import { parseTransaction } from "viem"
import { ETHEREUM_USDC, RECIPIENT, usdc } from "./constants"
import type { RequestContext } from "./depositApi"
import { makeDeposit, notFound, ok, sequence } from "./depositApi"
import type { MockNetwork } from "./harness"
import {
  amountInput,
  connectTestWallet,
  depositButton,
  expect,
  openWalletDeposit,
  selectSource,
  shot,
  submitDeposit,
  test,
  trackingTitle,
} from "./harness"
import { decodeErc20Transfer } from "./rpc"

/* Direct Ethereum USDC: address issuance, the minimum gate, the estimate, the
 * exact ERC-20 transfer, and correlation by exact source hash.
 * Cases S02, Q09, X09, X13, X14, T07, T08, T09, T11, T12, T13. */

const AMOUNT = "0.5"
const BASE_UNITS = usdc(AMOUNT)

/** Correlates by the hash the wallet actually broadcast; 404 first (indexing delay). */
function bySourceTx(net: MockNetwork, overrides: Record<string, unknown> = {}) {
  return (ctx: RequestContext) => {
    if (ctx.index === 0) return notFound()
    const hash = ctx.url.pathname.split("/").pop() ?? ""
    return ok(
      makeDeposit({
        src_tx_hash: hash,
        amount: BASE_UNITS,
        amount_out: BASE_UNITS,
        deposit_address: net.api.state.depositAddress,
        wallet_address: RECIPIENT,
        ...overrides,
      }),
    )
  }
}

async function openDirectForm(page: Page, net: MockNetwork) {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")
  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")
}

test("blocks a direct amount below the Ethereum route minimum", async ({ page, net }, info) => {
  await openDirectForm(page, net)

  // Catalog min_deposit_amount is 100000 (0.1 USDC).
  await amountInput(page).fill("0.05")
  await expect(page.getByRole("button", { name: /Enter at least 0\.1 USDC/ })).toBeVisible()
  await expect(depositButton(page)).toHaveCount(0)
  await shot(page, info, "below-minimum-gate")

  // No address is issued for an amount the backend would reject outright.
  await amountInput(page).fill(AMOUNT)
  await expect(depositButton(page)).toBeEnabled()
})

test("blocks a direct amount above the pinned balance", async ({ page, net }) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("0.2")
  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")

  await amountInput(page).fill("5")
  await expect(page.getByRole("button", { name: "Insufficient balance" })).toBeVisible()
  expect(net.rpc.sent).toHaveLength(0)
})

test("sends the exact ERC-20 transfer and tracks it to completion @mobile", async ({
  page,
  net,
}, info) => {
  await openDirectForm(page, net)
  // One pending receipt read so the source-pending screen is observable.
  net.rpc.state(1).receiptPendingReads = 1
  net.api.scenario.bySourceTx = bySourceTx(net)
  net.api.scenario.deposit = sequence([
    ok(makeDeposit({ bucket: "waiting", status: "detected" })),
    ok(makeDeposit({ bucket: "waiting", status: "detected" })),
    ok(
      makeDeposit({
        bucket: "processing",
        status: "funding_submitting",
        advance_status: "pending",
      }),
    ),
    ok(
      makeDeposit({
        bucket: "processing",
        status: "funding_submitting",
        advance_status: "pending",
      }),
    ),
    ok(
      makeDeposit({
        bucket: "completed",
        status: "completed",
        advance_status: "completed",
        amount: BASE_UNITS,
        amount_out: BASE_UNITS,
      }),
    ),
  ])

  await amountInput(page).fill(AMOUNT)
  await expect(depositButton(page)).toBeEnabled()

  // The issued address is bound to the resolved recipient, not to the sender.
  const addressRequest = net.api.requests.find((r) => r.path === "v1/deposit-address")
  expect(addressRequest?.json.wallet_address).toBe(RECIPIENT)

  await submitDeposit(page, net)

  // --- the broadcast itself -------------------------------------------------
  expect(net.rpc.sent).toHaveLength(1)
  const [sent] = net.rpc.sent
  expect(sent.chainId).toBe(1)
  const parsed = parseTransaction(sent.raw)
  expect(parsed.to?.toLowerCase()).toBe(ETHEREUM_USDC.toLowerCase())
  expect(parsed.value ?? 0n).toBe(0n)
  const transfer = decodeErc20Transfer(sent)
  expect(transfer.to.toLowerCase()).toBe(net.api.state.depositAddress.toLowerCase())
  expect(transfer.amount).toBe(BigInt(BASE_UNITS))

  // --- progress -------------------------------------------------------------
  await expect(trackingTitle(page, "Deposit in progress")).toBeVisible()
  await expect(page.getByText("Waiting for your Ethereum transaction to confirm.")).toBeVisible()
  await shot(page, info, "progress-source-pending")

  await expect(
    page.getByText("Your USDC reached Ethereum. We're waiting for the deposit to be detected."),
  ).toBeVisible({ timeout: 60_000 })
  await shot(page, info, "progress-correlating")

  // A 404 is an indexing delay, never a failure.
  expect(net.api.counts["v1/deposits/by-source-tx"]).toBeGreaterThan(0)

  await expect(page.getByText("Your deposit is confirming on Ethereum.")).toBeVisible({
    timeout: 60_000,
  })
  await shot(page, info, "progress-waiting")

  await expect(page.getByText("Your deposit is being delivered to Initia.")).toBeVisible({
    timeout: 60_000,
  })
  // advance_status=pending is a heading only; it never changes terminal judgment.
  await expect(page.getByText("Fast delivery is processing")).toBeVisible()
  await shot(page, info, "progress-processing")

  await expect(trackingTitle(page, "Transfer complete")).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByText("0.500000 iUSD was delivered to your wallet on Initia.", { exact: false }),
  ).toBeVisible()
  await shot(page, info, "progress-completed")

  // Correlation used the exact hash, never address/cursor discovery.
  const correlation = net.api.requests.filter((r) => r.path.startsWith("v1/deposits/by-source-tx/"))
  expect(correlation.length).toBeGreaterThan(0)
  for (const request of correlation) {
    expect(request.path.toLowerCase()).toContain(sent.hash.toLowerCase())
    expect(request.search).toContain("src_chain_id=1")
  }
  expect(net.rpc.sent).toHaveLength(1)
})

test("a below_minimum deposit is terminal and shows the required minimum", async ({
  page,
  net,
}, info) => {
  await openDirectForm(page, net)
  net.api.scenario.bySourceTx = bySourceTx(net)
  net.api.scenario.deposit = () =>
    ok(
      makeDeposit({
        bucket: "below_minimum",
        status: "below_minimum",
        status_reason: "below_minimum",
        required_min_amount: "100000",
        amount: BASE_UNITS,
      }),
    )

  await amountInput(page).fill(AMOUNT)
  await submitDeposit(page, net)

  await expect(page.getByText("Amount below minimum")).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/Deposits below 0\.1.*USDC can.t be processed/)).toBeVisible()
  await expect(
    page.getByText("Your funds remain at the deposit address with no automatic refund."),
  ).toBeVisible()
  await shot(page, info, "below-minimum")
})

test("an unknown bucket is a tracking problem, not a failure", async ({ page, net }, info) => {
  await openDirectForm(page, net)
  net.api.scenario.bySourceTx = bySourceTx(net)
  net.api.scenario.deposit = () =>
    ok(makeDeposit({ bucket: "quantum_superposition", status: "who_knows" }))

  await amountInput(page).fill(AMOUNT)
  await submitDeposit(page, net)

  await expect(page.getByText("Status unavailable")).toBeVisible({ timeout: 90_000 })
  await expect(
    page.getByText("We couldn't read the latest deposit status. Your transfer details are saved."),
  ).toBeVisible()
  // Never labelled a financial failure, and automatic reads stop in favour of
  // a manual refresh.
  await expect(page.getByText("Deposit failed")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible()
  await shot(page, info, "unknown-bucket")
})

test("a conflicting correlated record stops tracking instead of completing", async ({
  page,
  net,
}, info) => {
  await openDirectForm(page, net)
  // Right hash, wrong recipient: someone else's deposit at a reused address.
  net.api.scenario.bySourceTx = (ctx) => {
    const hash = ctx.url.pathname.split("/").pop() ?? ""
    return ok(
      makeDeposit({
        src_tx_hash: hash,
        amount: BASE_UNITS,
        deposit_address: net.api.state.depositAddress,
        wallet_address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfmgxjw",
      }),
    )
  }

  await amountInput(page).fill(AMOUNT)
  await submitDeposit(page, net)

  await expect(page.getByText("Couldn't verify this transfer")).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible()
  await shot(page, info, "correlation-conflict")
})
