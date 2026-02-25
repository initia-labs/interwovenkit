import { describe, expect, it } from "vitest"
import { mulDivRoundup } from "./util"

describe("mulDivRoundup", () => {
  it("rounds up integer division", () => {
    expect(mulDivRoundup(5n, 2n, 3n)).toBe(4n)
  })

  it("throws when denominator is zero", () => {
    expect(() => mulDivRoundup(1n, 1n, 0n)).toThrowError(
      "mulDivRoundup: denominator c must be non-zero",
    )
  })
})
