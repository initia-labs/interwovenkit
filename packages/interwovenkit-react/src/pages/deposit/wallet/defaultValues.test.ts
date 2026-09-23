import { buildTransferDefaultValues } from "./defaultValues"
import type { TransferFormValues } from "./transferFlowConfig"

const INIT = { denom: "uinit", chainId: "interwoven-1" }
const USDC = { denom: "uusdc", chainId: "interwoven-1" }

const EMPTY: TransferFormValues = {
  page: "select-local",
  quantity: "",
  srcDenom: "",
  srcChainId: "",
  dstDenom: "",
  dstChainId: "",
  selectedBridge: "",
  depositSessionId: "",
}
const DEPOSIT_INIT = { dstDenom: INIT.denom, dstChainId: INIT.chainId }
const WITHDRAW_INIT = { srcDenom: INIT.denom, srcChainId: INIT.chainId }

describe("buildTransferDefaultValues", () => {
  test.each<
    [string, Parameters<typeof buildTransferDefaultValues>[0], Partial<TransferFormValues>]
  >([
    ["no preset starts at select-local", { mode: "deposit", localOptions: [INIT, USDC] }, {}],
    [
      "deposit presets initialAsset as the destination",
      { mode: "deposit", initialAsset: INIT, localOptions: [] },
      { page: "select-external", ...DEPOSIT_INIT },
    ],
    [
      "withdraw presets initialAsset as the source",
      { mode: "withdraw", initialAsset: INIT, localOptions: [] },
      { page: "fields", ...WITHDRAW_INIT },
    ],
    [
      "deposit presets a single local option",
      { mode: "deposit", localOptions: [INIT] },
      { page: "select-external", ...DEPOSIT_INIT },
    ],
    [
      "withdraw presets a single local option",
      { mode: "withdraw", localOptions: [INIT] },
      { page: "fields", ...WITHDRAW_INIT },
    ],
    [
      "initialAsset wins over a single local option",
      { mode: "deposit", initialAsset: USDC, localOptions: [INIT] },
      { page: "select-external", dstDenom: USDC.denom, dstChainId: USDC.chainId },
    ],
    [
      "deposit opens a resumed session",
      { mode: "deposit", initialAsset: INIT, initialSessionId: "session-1", localOptions: [] },
      { page: "deposit-progress", depositSessionId: "session-1", ...DEPOSIT_INIT },
    ],
    [
      "deposit opens a resumed session without initialAsset",
      { mode: "deposit", initialSessionId: "session-1", localOptions: [INIT, USDC] },
      { page: "deposit-progress", depositSessionId: "session-1" },
    ],
    [
      "withdraw ignores initialSessionId",
      { mode: "withdraw", initialAsset: INIT, initialSessionId: "session-1", localOptions: [] },
      { page: "fields", ...WITHDRAW_INIT },
    ],
  ])("%s", (_, input, expected) => {
    expect(buildTransferDefaultValues(input)).toEqual({ ...EMPTY, ...expected })
  })
})
