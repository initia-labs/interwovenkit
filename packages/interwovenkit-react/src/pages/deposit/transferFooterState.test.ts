import { getTransferFooterStatus } from "./transferFooterState"

describe("getTransferFooterStatus", () => {
  it("shows insufficient balance when the transfer itself exceeds the source balance", () => {
    expect(
      getTransferFooterStatus({
        feeDenom: "uinit",
        sourceDenom: "uinit",
        feeWarning: "Make sure to leave enough for transaction fee",
        hasSourceBalance: false,
        isFeeBalanceSufficient: false,
      }),
    ).toEqual({ error: "Insufficient balance" })
  })

  it("keeps the fee warning when the transfer fits but needs room for the fee", () => {
    expect(
      getTransferFooterStatus({
        feeDenom: "uinit",
        sourceDenom: "uinit",
        feeWarning: "Make sure to leave enough for transaction fee",
        hasSourceBalance: true,
        isFeeBalanceSufficient: false,
      }),
    ).toEqual({ warning: "Make sure to leave enough for transaction fee" })
  })

  it("shows insufficient balance when the fee cannot be covered and there is no warning", () => {
    expect(
      getTransferFooterStatus({
        feeDenom: "uusdc",
        sourceDenom: "uinit",
        hasSourceBalance: true,
        isFeeBalanceSufficient: false,
      }),
    ).toEqual({ error: "Insufficient balance" })
  })

  it("returns an empty status when both transfer amount and fee are covered", () => {
    expect(
      getTransferFooterStatus({
        feeDenom: "uusdc",
        sourceDenom: "uinit",
        hasSourceBalance: true,
        isFeeBalanceSufficient: true,
      }),
    ).toEqual({})
  })
})
