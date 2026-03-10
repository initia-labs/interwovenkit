import { computeRequiredFeeByDenom, hasSufficientFeeBalance } from "./bridgeTxUtils"

describe("computeRequiredFeeByDenom", () => {
  it("rounds each fee asset up after applying gas adjustment", () => {
    expect(
      computeRequiredFeeByDenom({
        gas: 100_001,
        gasAdjustment: 1.1,
        feeAssets: [
          { denom: "uinit", gas_price: { average: "0.15" } },
          { denom: "uusdc", gas_price: { average: "0.01" } },
        ],
      }),
    ).toEqual({
      uinit: "16501",
      uusdc: "1101",
    })
  })
})

describe("hasSufficientFeeBalance", () => {
  it("accepts a fee asset that still has enough remaining balance after the bridge spend", () => {
    expect(
      hasSufficientFeeBalance({
        balances: {
          uinit: { amount: "2500", formatted_amount: "0" },
          uusdc: { amount: "300", formatted_amount: "0" },
        },
        requiredFeeByDenom: {
          uinit: "400",
          uusdc: "500",
        },
        sourceDenom: "uinit",
        amountIn: "2000",
      }),
    ).toBe(true)
  })

  it("fails when every available fee asset would be dusted after the bridge spend", () => {
    expect(
      hasSufficientFeeBalance({
        balances: {
          uinit: { amount: "2300", formatted_amount: "0" },
          uusdc: { amount: "300", formatted_amount: "0" },
        },
        requiredFeeByDenom: {
          uinit: "400",
          uusdc: "500",
        },
        sourceDenom: "uinit",
        amountIn: "2000",
      }),
    ).toBe(false)
  })
})
