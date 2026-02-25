import { describe, expect, it } from "vitest"
import { calculateAsset } from "./calculateAsset"

describe("calculateAsset", () => {
  it("returns two token amounts for a valid position", () => {
    const [amount0, amount1] = calculateAsset({
      tickLower: "18446744073709108016",
      tickUpper: "443600",
      liquidity: "1000000",
      sqrtPrice: "18446744073709551616",
    })

    expect(typeof amount0).toBe("bigint")
    expect(typeof amount1).toBe("bigint")
    expect(amount0 >= 0n).toBe(true)
    expect(amount1 >= 0n).toBe(true)
  })

  it("returns zero amounts for zero liquidity", () => {
    const [amount0, amount1] = calculateAsset({
      tickLower: "18446744073709108016",
      tickUpper: "443600",
      liquidity: "0",
      sqrtPrice: "18446744073709551616",
    })

    expect(amount0).toBe(0n)
    expect(amount1).toBe(0n)
  })
})
