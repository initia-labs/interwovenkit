import { describe, expect, it } from "vitest"
import { calculateTokens } from "./calculateTokens"

describe("calculateTokens", () => {
  it("returns min and max prices", () => {
    const tokens = calculateTokens({
      tickLower: "18446744073709108016",
      tickUpper: "443600",
    })

    expect(tokens.min).toBeGreaterThan(0)
    expect(tokens.max).toBeGreaterThan(tokens.min)
  })

  it("supports reversed pair display", () => {
    const normal = calculateTokens({
      tickLower: "18446744073709108016",
      tickUpper: "443600",
      isReversed: false,
    })

    const reversed = calculateTokens({
      tickLower: "18446744073709108016",
      tickUpper: "443600",
      isReversed: true,
    })

    expect(reversed.min).toBeCloseTo(1 / normal.max, 12)
    expect(reversed.max).toBeCloseTo(1 / normal.min, 12)
  })

  it("keeps prices finite at extreme tick bounds", () => {
    const tokens = calculateTokens({
      tickLower: "18446744073709107980",
      tickUpper: "443636",
    })

    expect(Number.isFinite(tokens.max)).toBe(true)
    expect(tokens.max).toBeGreaterThan(tokens.min)
  })
})
