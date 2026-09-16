import { BASE_USDC, ETHEREUM_USDC, usdc } from "./constants"
import { fail } from "./depositApi"
import {
  amountInput,
  connectTestWallet,
  depositButton,
  expect,
  grantAllowance,
  openWalletDeposit,
  selectSource,
  shot,
  test,
  transferForm,
} from "./harness"

/* Failure handling around the wallet prompt and the pre-send reads:
 * cases X12, X15, Q05, Q07, Q10. */

test("a send that returns no hash locks the form as an unknown submission", async ({
  page,
  net,
}, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")
  // A node-level failure with no hash back: nothing here proves the transfer
  // was not broadcast.
  net.rpc.state(1).sendError = { code: -32000, message: "already known" }

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")
  await amountInput(page).fill("0.5")
  await expect(depositButton(page)).toBeEnabled()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await page.getByText(/did not confirm whether this transfer was sent/).isVisible()) break
    await depositButton(page).click()
    await page.waitForTimeout(3_000)
  }

  await expect(
    page.getByText(
      "The wallet did not confirm whether this transfer was sent. Do not send it again — open the progress view to check its status.",
    ),
  ).toBeVisible()
  // The form locks: the only action left opens the session's progress view,
  // and nothing can re-enter the wallet from here.
  await expect(depositButton(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "View progress" })).toBeEnabled()
  expect(net.rpc.sent).toHaveLength(0)
  await shot(page, info, "unknown-send")
})

test("a rejected prompt leaves the form re-signable and sends nothing", async ({ page, net }) => {
  net.rpc.state(8453).tokenBalances[BASE_USDC.toLowerCase()] = usdc("10")
  grantAllowance(net, 8453, BASE_USDC)
  net.rpc.state(8453).sendError = { code: 4001, message: "User denied transaction signature." }

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Base")
  await amountInput(page).fill("0.5")
  await expect(depositButton(page)).toBeEnabled()

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await depositButton(page).click()
    await page.waitForTimeout(3_000)
    if (await page.getByText("User rejected").isVisible()) break
  }

  await expect(page.getByText("User rejected")).toBeVisible()
  // A known rejection is the one failure that leaves the action available.
  await expect(depositButton(page)).toBeEnabled()
  await expect(page.getByText(/did not confirm whether this transfer was sent/)).toHaveCount(0)
  expect(net.rpc.sent).toHaveLength(0)
})

test("a rejected quote (400) blocks review with the backend's reason", async ({
  page,
  net,
}, info) => {
  net.rpc.state(8453).tokenBalances[BASE_USDC.toLowerCase()] = usdc("10")
  grantAllowance(net, 8453, BASE_USDC)
  net.api.scenario.bridgeQuote = () => fail(400, "route temporarily paused")

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Base")
  await amountInput(page).fill("0.5")

  await expect(transferForm(page).getByText("route temporarily paused")).toBeVisible({
    timeout: 60_000,
  })
  await expect(depositButton(page)).toBeDisabled()
  expect(net.rpc.sent).toHaveLength(0)
  await shot(page, info, "quote-rejected")
})

test("an unavailable destination estimate blocks review instead of inventing one", async ({
  page,
  net,
}, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")
  net.api.scenario.quote = () => fail(500, "quote service unavailable")

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")
  await amountInput(page).fill("0.5")

  await expect(page.getByText("Could not verify the destination estimate")).toBeVisible({
    timeout: 60_000,
  })
  await expect(depositButton(page)).toBeDisabled()
  expect(net.rpc.sent).toHaveLength(0)
  await shot(page, info, "estimate-unavailable")
})
