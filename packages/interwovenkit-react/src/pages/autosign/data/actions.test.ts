import type { Coin } from "@cosmjs/proto-signing"
import { describe, expect, it } from "vitest"
import { calculateFeegrantSpendLimit } from "./actions"

describe("calculateFeegrantSpendLimit", () => {
  const gasPrices: Coin[] = [
    { denom: "uinit", amount: "0.01" },
    { denom: "uusdc", amount: "0.02" },
  ]

  it("calculates a bounded spend limit for finite durations", () => {
    const oneDay = 24 * 60 * 60 * 1000
    const spendLimit = calculateFeegrantSpendLimit(gasPrices, oneDay)

    expect(spendLimit).toEqual([
      { denom: "uinit", amount: "600000" },
      { denom: "uusdc", amount: "1200000" },
    ])
  })

  it("uses a bounded default tx budget for indefinite grants", () => {
    const spendLimit = calculateFeegrantSpendLimit(gasPrices, 0)

    expect(spendLimit).toEqual([
      { denom: "uinit", amount: "6000000" },
      { denom: "uusdc", amount: "12000000" },
    ])
  })

  it("ensures spend limit is at least 1", () => {
    const tinyGasPrice: Coin[] = [{ denom: "uinit", amount: "0.000000000000000001" }]
    const spendLimit = calculateFeegrantSpendLimit(tinyGasPrice, 1000)

    expect(spendLimit).toEqual([{ denom: "uinit", amount: "1" }])
  })
})
