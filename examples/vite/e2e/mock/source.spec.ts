import { ARBITRUM_USDC, BASE_USDC, ETHEREUM_USDC, usdc } from "./constants"
import { ethereumUsdcAsset, fail, ok } from "./depositApi"
import {
  amountInput,
  connectTestWallet,
  depositButton,
  expect,
  grantAllowance,
  openDepositHub,
  openTxDetails,
  openWalletDeposit,
  openWithdraw,
  selectSource,
  shot,
  sourceRow,
  test,
} from "./harness"

/* Source list and transport selection: cases S01, S02, S03, S04, S08 and the
 * Router/Withdraw isolation the plan's "Transport selection and API isolation"
 * section requires. */

test("shows the three canonical USDC sources for iUSD @mobile", async ({ page, net }, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")

  await connectTestWallet(page)
  await openWalletDeposit(page)

  await expect(sourceRow(page, "Ethereum")).toBeVisible()
  await expect(sourceRow(page, "Base")).toBeVisible()
  await expect(sourceRow(page, "Arbitrum")).toBeVisible()
  // The catalog is the support authority, and it lists no Optimism pair.
  await expect(page.getByRole("button", { name: /on Optimism/ })).toHaveCount(0)

  await shot(page, info, "sources")
})

test("Ethereum selects the direct executor and no route picker @mobile", async ({
  page,
  net,
}, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")

  await amountInput(page).fill("0.5")
  await expect(depositButton(page)).toBeEnabled()

  // Direct: an issued address and an ERC-20 transfer, with no provider choice
  // and no LI.FI attribution anywhere in the reviewed details.
  await openTxDetails(page)
  await expect(page.getByText("Provider", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Via", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Receiving address")).toBeVisible()

  // The pinned read is the displayed balance authority (10 USDC, not Skip's
  // aggregate snapshot, which is empty for this throwaway account).
  await expect(page.getByRole("button", { name: /10\b.*MAX/ })).toBeVisible()

  const paths = net.api.requests.map((request) => request.path)
  expect(paths).toContain("v1/deposit-address")
  expect(paths).not.toContain("v1/bridges/options")

  await shot(page, info, "form-direct")
})

test("Base selects the LI.FI executor and ranks a default provider @mobile", async ({
  page,
  net,
}, info) => {
  net.rpc.state(8453).tokenBalances[BASE_USDC.toLowerCase()] = usdc("10")
  // Existing allowance (case X03): the footer's single action is Deposit.
  grantAllowance(net, 8453, BASE_USDC)

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Base")
  await amountInput(page).fill("0.5")

  await expect(depositButton(page)).toBeEnabled()
  await openTxDetails(page)
  // "across" carries the greatest min_received, so it is the ranked default.
  await expect(page.getByRole("button", { name: /AcrossV4/ })).toBeVisible()
  // The aggregator is attribution, never a substitute for the chosen tool.
  await expect(page.getByText("Provider", { exact: true })).toBeVisible()
  await expect(page.getByText("Route", { exact: true })).toBeVisible()

  const optionsRequest = net.api.requests.find((request) => request.path === "v1/bridges/options")
  expect(optionsRequest?.json.src_chain_id).toBe("8453")
  expect(optionsRequest?.json.src_denom).toBe(BASE_USDC)
  // The bridge is chosen client-side; the options request must not hint one.
  expect(optionsRequest?.json.bridge).toBeUndefined()

  await shot(page, info, "form-lifi")
})

test("Arbitrum uses its own identity, not Base's", async ({ page, net }) => {
  net.rpc.state(42161).tokenBalances[ARBITRUM_USDC.toLowerCase()] = usdc("10")
  grantAllowance(net, 42161, ARBITRUM_USDC)

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Arbitrum")
  await amountInput(page).fill("0.5")

  await expect(depositButton(page)).toBeEnabled()
  const optionsRequest = net.api.requests.find((request) => request.path === "v1/bridges/options")
  expect(optionsRequest?.json.src_chain_id).toBe("42161")
  expect(optionsRequest?.json.src_denom).toBe(ARBITRUM_USDC)

  const quoteRequest = net.api.requests.find((request) => request.path === "v1/bridges/quote")
  expect(quoteRequest?.json.src_chain_id).toBe("42161")
})

test("a catalog outage disables only the API sources, with a retry", async ({
  page,
  net,
}, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")
  net.api.scenario.assets = () => fail(503, "catalog unavailable")

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")
  await amountInput(page).fill("0.5")

  await expect(page.getByText("Deposit API unavailable")).toBeVisible({ timeout: 90_000 })
  const retry = page.getByRole("button", { name: "Retry", exact: true })
  await expect(retry).toBeVisible()
  await shot(page, info, "catalog-outage")

  // Never silently handed to Router: no address was issued and no Router
  // preview footer replaced the unavailable state.
  expect(net.api.requests.map((request) => request.path)).not.toContain("v1/deposit-address")
  await expect(depositButton(page)).toHaveCount(0)

  net.api.scenario.assets = () => ok({ assets: [ethereumUsdcAsset()] })
  await retry.click()
  await expect(depositButton(page)).toBeEnabled({ timeout: 90_000 })
})

test("withdraw never consults the Deposit API", async ({ page, net }) => {
  await connectTestWallet(page)
  await openWithdraw(page)

  await expect(page.getByRole("heading", { name: "Select an asset to withdraw" })).toBeVisible()
  await page.getByRole("button", { name: /USDC/ }).first().click()

  await expect(page.getByRole("heading", { name: /^Withdraw / })).toBeVisible()
  // Withdraw always resolves to Router, catalog or not.
  const paths = net.api.requests.map((request) => request.path)
  expect(paths).not.toContain("v1/config/assets")
  expect(paths).not.toContain("v1/bridges/options")
  expect(paths).not.toContain("v1/deposit-address")
})

test("the hub keeps the wallet method available during a catalog outage", async ({ page, net }) => {
  net.api.scenario.assets = () => fail(503, "catalog unavailable")

  await connectTestWallet(page)
  await openDepositHub(page)

  await expect(page.getByRole("button", { name: /Deposit via wallet/ })).toBeEnabled()
})
