import { describe, expect, it } from "vitest"
import { getNextSqrtPriceFromAmount1RoundingDown } from "./sqrtPriceMath"

describe("getNextSqrtPriceFromAmount1RoundingDown", () => {
  it("throws when liquidity is zero", () => {
    expect(() => getNextSqrtPriceFromAmount1RoundingDown(1n, 0n, 1n, true)).toThrowError(
      "ZERO_LIQUIDITY",
    )
  })
})
