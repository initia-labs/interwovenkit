import { describe, expect, it } from "vitest"
import { tickSpacingToMaxLiquidityPerTick } from "./tickMath"

describe("tickSpacingToMaxLiquidityPerTick", () => {
  it("uses floor division semantics for negative min tick", () => {
    expect(tickSpacingToMaxLiquidityPerTick(20n)).toBe(922461944989735827n)
  })

  it("rejects non-positive tick spacing", () => {
    expect(() => tickSpacingToMaxLiquidityPerTick(0n)).toThrowError("NON_POSITIVE_TICK_SPACING")
  })
})
