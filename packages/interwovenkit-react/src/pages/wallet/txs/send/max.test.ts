import { toBaseUnit } from "@initia/utils"
import { calcMaxAmount } from "./max"

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

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("99.997", { decimals: 6 }))
  })

  it("should return full balance when lastFeeDenom differs from denom and lastFeeDenom has enough balance", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    const lastFeeDenom = "INIT"
    const denom = "USDC"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("100", { decimals: 6 }))
  })

  it("should return full balance when lastFeeDenom differs from denom", () => {
    const balances = [{ denom: "USDC", amount: String(100 * 1e6) }]

    const lastFeeDenom = "INIT"
    const denom = "USDC"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("99.994", { decimals: 6 }))
  })

  it("should deduct fee from current token when lastFeeDenom has insufficient balance", () => {
    const balances = [
      { denom: "INIT", amount: String(0.001 * 1e6) }, // Insufficient for gas
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    const lastFeeDenom = "INIT"
    const denom = "USDC"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("99.994", { decimals: 6 }))
  })

  it("should return full balance when token cannot be used for gas", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
      { denom: "TOKEN", amount: String(50 * 1e6) }, // Not in gasPrices
    ]

    const lastFeeDenom = "INIT"
    const denom = "TOKEN"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("50", { decimals: 6 }))
  })

  it("should return 0 when same token has insufficient balance for gas fee", () => {
    const balances = [
      { denom: "INIT", amount: String(0.001 * 1e6) }, // Insufficient for gas
    ]

    const lastFeeDenom = "INIT"
    const denom = "INIT"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe("0")
  })

  it("should return 0 when different token has insufficient balance for gas fee", () => {
    const balances = [
      { denom: "INIT", amount: String(0.001 * 1e6) }, // Insufficient for gas
      { denom: "USDC", amount: String(0.001 * 1e6) }, // Insufficient for gas
    ]

    const lastFeeDenom = "INIT"
    const denom = "USDC"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe("0")
  })

  it("should return full balance for INIT when lastFeeDenom is null and both have enough for gas", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    const lastFeeDenom = null
    const denom = "INIT"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("99.997", { decimals: 6 }))
  })

  it("should return full balance for USDC when lastFeeDenom is null and both have enough for gas", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    const lastFeeDenom = null
    const denom = "USDC"

    const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom })

    expect(maxAmount).toBe(toBaseUnit("100", { decimals: 6 }))
  })

  it("should deduct fee from self when lastFeeDenom is null and only one fee token exists", () => {
    const balances = [{ denom: "INIT", amount: String(100 * 1e6) }]
    const lastFeeDenom = null

    const maxAmount = calcMaxAmount({ denom: "INIT", balances, gasPrices, lastFeeDenom })
    expect(maxAmount).toBe(toBaseUnit("99.997", { decimals: 6 }))
  })
})
