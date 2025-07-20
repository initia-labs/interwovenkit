import { toAmount } from "@/public/utils"
import { getMaxAmount } from "./max"

describe("getMaxAmount", () => {
  const gasPrices = [
    { denom: "INIT", amount: "0.015" },
    { denom: "USDC", amount: "0.03" },
  ]

  it("should deduct fee from same token balance when lastFeeDenom equals denom", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    const lastFeeDenom = "INIT"
    const denom = "INIT"

    const maxAmount = getMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toAmount("99.997"))
  })

  it("should return full balance when lastFeeDenom differs from denom", () => {
    const balances = [{ denom: "USDC", amount: String(100 * 1e6) }]

    const lastFeeDenom = "INIT"
    const denom = "USDC"

    const maxAmount = getMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toAmount("99.994"))
  })
})
