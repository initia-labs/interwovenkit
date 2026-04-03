import { getTransferFeeWarning } from "./transferFeeWarning"

describe("getTransferFeeWarning", () => {
  it("warns when the source gas token cannot cover both spend and fee", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uinit", { isSufficient: false }]]),
      }),
    ).toBe("Make sure to leave enough for transaction fee")
  })

  it("does not warn when the source denom is not used for fees", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uusdc", { isSufficient: false }]]),
      }),
    ).toBeUndefined()
  })

  it("does not warn when another fee denom remains available", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([
          ["uinit", { isSufficient: false }],
          ["uusdc", { isSufficient: true }],
        ]),
      }),
    ).toBeUndefined()
  })

  it("does not warn when the source denom still has enough balance", () => {
    expect(
      getTransferFeeWarning({
        sourceDenom: "uinit",
        feeDetailsByDenom: new Map([["uinit", { isSufficient: true }]]),
      }),
    ).toBeUndefined()
  })
})
