import { ETHEREUM_USDC, usdc } from "./constants"
import { notFound } from "./depositApi"
import {
  amountInput,
  connectTestWallet,
  expect,
  openDepositHub,
  openWalletDeposit,
  selectSource,
  shot,
  submitDeposit,
  test,
  trackingTitle,
} from "./harness"

/* Reload recovery: case B01 (reload at a durable phase) and the hub's
 * "Continue deposit" section. */

test("a reload mid-flight offers Continue deposit and resumes on progress", async ({
  page,
  net,
}, info) => {
  net.rpc.state(1).tokenBalances[ETHEREUM_USDC.toLowerCase()] = usdc("10")
  // The indexer never catches up, so the session stays non-terminal.
  net.api.scenario.bySourceTx = () => notFound()

  await connectTestWallet(page)
  await openWalletDeposit(page)
  await selectSource(page, "Ethereum")
  await amountInput(page).fill("0.5")
  await submitDeposit(page, net)

  await expect(trackingTitle(page, "Deposit in progress")).toBeVisible()
  const [sent] = net.rpc.sent

  // --- reload ---------------------------------------------------------------
  await page.reload()
  await connectTestWallet(page)
  await openDepositHub(page)

  await expect(page.getByText("Continue deposit")).toBeVisible()
  const resumeRow = page.getByRole("button", { name: /USDC from Ethereum/ })
  await expect(resumeRow).toBeVisible()
  await shot(page, info, "resume-row")

  await resumeRow.click()

  // The saved session resumes read-only on its progress screen; no wallet
  // action is repeated.
  await expect(trackingTitle(page, "Deposit in progress")).toBeVisible()
  await expect(
    page.getByText("Your USDC reached Ethereum. We're waiting for the deposit to be detected."),
  ).toBeVisible({ timeout: 60_000 })
  await shot(page, info, "resume-progress")

  expect(net.rpc.sent).toHaveLength(1)
  expect(net.rpc.sent[0].hash).toBe(sent.hash)
})
