import type { FeeJson } from "@skip-go/client"
import { describe, expect, it } from "vite-plus/test"
import { shouldWarnInsufficientFeeBalance } from "./fee-warning"

describe("shouldWarnInsufficientFeeBalance", () => {
  it("does not warn while balance data is still loading", () => {
    const additionalFees = [
      {
        amount: "1000",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        feeTokenDenoms: ["uinit"],
        additionalFees,
      }),
    ).toBe(false)
  })

  it("warns when the source fee token balance cannot cover amount plus fee", () => {
    const additionalFees = [
      {
        amount: "1000",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000000",
        amountIn: "999500",
        feeTokenDenoms: ["uinit"],
        balancesByDenom: {
          uinit: { amount: "1000000" },
        },
        additionalFees,
      }),
    ).toBe(true)
  })

  it("does not warn when another fee token has balance", () => {
    const additionalFees = [
      {
        amount: "1000",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000000",
        amountIn: "999500",
        feeTokenDenoms: ["uinit", "uusdc"],
        balancesByDenom: {
          uinit: { amount: "1000000" },
          uusdc: { amount: "1" },
        },
        additionalFees,
      }),
    ).toBe(false)
  })

  it("still warns when another fee token only has dust balance", () => {
    const additionalFees = [
      {
        amount: "1000",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
      {
        amount: "500",
        origin_asset: { denom: "uusdc", symbol: "USDC", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000000",
        amountIn: "999500",
        feeTokenDenoms: ["uinit", "uusdc"],
        balancesByDenom: {
          uinit: { amount: "1000000" },
          uusdc: { amount: "1" },
        },
        additionalFees,
      }),
    ).toBe(true)
  })

  it("ignores fee entries whose amount is omitted", () => {
    const additionalFees = [
      {
        amount: "1000",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
      {
        amount: undefined,
        origin_asset: { denom: "uusdc", symbol: "USDC", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000000",
        amountIn: "999500",
        feeTokenDenoms: ["uinit", "uusdc"],
        balancesByDenom: {
          uinit: { amount: "1000000" },
          uusdc: { amount: "0" },
        },
        additionalFees,
      }),
    ).toBe(true)
  })

  it("does not warn when the source asset is not a fee token", () => {
    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uatom",
        sourceBalance: "1000",
        amountIn: "500",
        feeTokenDenoms: ["uinit"],
        balancesByDenom: {
          uatom: { amount: "1000" },
        },
        additionalFees: [],
      }),
    ).toBe(false)
  })

  it("does not warn when there is no quoted source fee", () => {
    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000",
        amountIn: "500",
        feeTokenDenoms: ["uinit"],
        balancesByDenom: {
          uinit: { amount: "1000" },
        },
        additionalFees: [],
      }),
    ).toBe(false)
  })

  it("does not warn when the balance exactly covers amount plus fee", () => {
    const additionalFees = [
      {
        amount: "500",
        origin_asset: { denom: "uinit", symbol: "INIT", decimals: 6 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "uinit",
        sourceBalance: "1000",
        amountIn: "500",
        feeTokenDenoms: ["uinit"],
        balancesByDenom: {
          uinit: { amount: "1000" },
        },
        additionalFees,
      }),
    ).toBe(false)
  })

  it("handles high-precision balances without relying on exact max equality", () => {
    const additionalFees = [
      {
        amount: "1014000000000",
        origin_asset: { denom: "evm/init", symbol: "INIT", decimals: 18 },
      } as FeeJson,
    ]

    expect(
      shouldWarnInsufficientFeeBalance({
        sourceDenom: "evm/init",
        sourceBalance: "1549176000000000000",
        amountIn: "1549176000000000000",
        feeTokenDenoms: ["evm/init"],
        balancesByDenom: {
          "evm/init": { amount: "1549176000000000000" },
        },
        additionalFees,
      }),
    ).toBe(true)
  })
})
