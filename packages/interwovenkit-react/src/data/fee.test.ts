import type { Coin } from "@cosmjs/proto-signing"
import BigNumber from "bignumber.js"
import { describe, expect, it } from "vitest"
import { DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { normalizeL1GasPriceEntry } from "./fee"

describe("normalizeL1GasPriceEntry", () => {
  it("normalizes uinit at multiplier 1", () => {
    expect(normalizeL1GasPriceEntry({ denom: "uinit", amount: "0.015" })).toEqual({
      denom: "uinit",
      amount: "0.015000000000000000",
    })
  })

  it("applies the default multiplier to non-uinit denoms", () => {
    const result = normalizeL1GasPriceEntry({ denom: "uusdc", amount: "0.01" })
    expect(result?.denom).toBe("uusdc")
    // Compare via BigNumber to avoid JavaScript's `0.01 * 1.05` float drift.
    expect(result?.amount).toBe(BigNumber("0.01").times(DEFAULT_GAS_PRICE_MULTIPLIER).toFixed(18))
  })

  it("drops entries with empty-string amounts", () => {
    expect(normalizeL1GasPriceEntry({ denom: "uinit", amount: "" })).toBeNull()
  })

  it("drops entries with whitespace-only amounts", () => {
    expect(normalizeL1GasPriceEntry({ denom: "uinit", amount: "   " })).toBeNull()
  })

  it("drops entries when amount is missing entirely", () => {
    // Cast through unknown because the upstream API can violate the declared
    // `string` type; normalize must survive that.
    const entry = { denom: "uinit" } as unknown as Coin
    expect(normalizeL1GasPriceEntry(entry)).toBeNull()
  })

  // Negative regression: passing the raw empty amount into BigNumber would
  // throw under strict mode (v10+). The trim guard must intercept it before
  // construction. If a future refactor removes the trim, this test will start
  // throwing instead of returning null.
  it("does not throw under strict mode for empty amounts", () => {
    expect(() => normalizeL1GasPriceEntry({ denom: "uinit", amount: "" })).not.toThrow()
  })
})
