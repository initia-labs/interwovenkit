import {
  computeRequiredFeeByDenom,
  decodeCosmosAminoMessages,
  hasSufficientFeeBalance,
} from "./bridgeTxUtils"

describe("computeRequiredFeeByDenom", () => {
  it("rounds each fee asset up after applying gas adjustment", () => {
    expect(
      computeRequiredFeeByDenom({
        gas: 100_001,
        gasAdjustment: 1.1,
        gasPrices: [
          { denom: "uinit", amount: "0.15" },
          { denom: "uusdc", amount: "0.01" },
        ],
      }),
    ).toEqual({
      uinit: "16501",
      uusdc: "1101",
    })
  })

  it("supports alternative fee tokens priced outside router fee asset metadata", () => {
    expect(
      computeRequiredFeeByDenom({
        gas: 200_000,
        gasPrices: [
          { denom: "uinit", amount: "0.015" },
          { denom: "ibc/usdc", amount: "0.00139524973005379" },
        ],
      }),
    ).toEqual({
      uinit: "4200",
      "ibc/usdc": "391",
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

describe("decodeCosmosAminoMessages", () => {
  const fromAmino = vi.fn((value) => ({ typeUrl: value.type, value: value.value }))

  it("throws on unsupported message types", () => {
    expect(() =>
      decodeCosmosAminoMessages([{ msg_type_url: "/unsupported.Msg", msg: "{}" }], {
        fromAmino,
        converters: {},
      }),
    ).toThrow("Unsupported message type: /unsupported.Msg")
  })
})
