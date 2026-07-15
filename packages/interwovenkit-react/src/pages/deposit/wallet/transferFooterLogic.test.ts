import { getTransferFeeWarning, getTransferFooterStatus } from "./transferFooterLogic"

function createFeeDetails({
  balance = "1000",
  fee = "500",
  isSufficient,
}: {
  balance?: string
  fee?: string
  isSufficient: boolean
}) {
  return { balance, fee, isSufficient }
}

describe("getTransferFeeWarning", () => {
  it("warns when the source gas token cannot cover both spend and fee", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uinit", createFeeDetails({ isSufficient: false })]]),
      }),
    ).toBe("Make sure to leave enough for transaction fee")
  })

  it("does not warn when the source denom is not used for fees", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uusdc", createFeeDetails({ isSufficient: false })]]),
      }),
    ).toBeUndefined()
  })

  it("does not warn when another fee denom remains available", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([
          ["uinit", createFeeDetails({ isSufficient: false })],
          ["uusdc", createFeeDetails({ isSufficient: true })],
        ]),
      }),
    ).toBeUndefined()
  })

  it("does not warn when the wallet cannot cover the source fee at all", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([
          ["uinit", createFeeDetails({ balance: "499", isSufficient: false })],
        ]),
      }),
    ).toBeUndefined()
  })

  it("does not warn when the source denom still has enough balance", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uinit", createFeeDetails({ isSufficient: true })]]),
      }),
    ).toBeUndefined()
  })
})

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
