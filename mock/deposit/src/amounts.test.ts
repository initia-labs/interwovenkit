import { describe, expect, it } from "vitest"
import { shiftDecimals, toBaseUnit } from "./amounts.ts"

describe("shiftDecimals", () => {
  it("shifts up by appending zeros", () => {
    expect(shiftDecimals("123", 6)).toBe("123000000")
  })

  it("shifts down by flooring", () => {
    expect(shiftDecimals("123456789", -6)).toBe("123")
    expect(shiftDecimals("123", -6)).toBe("0")
  })

  it("returns the input unchanged for zero shift or non-integer input", () => {
    expect(shiftDecimals("123", 0)).toBe("123")
    expect(shiftDecimals("12.3", 3)).toBe("12.3")
  })
})

describe("toBaseUnit", () => {
  it("converts whole and fractional amounts", () => {
    expect(toBaseUnit("100", 6)).toBe("100000000")
    expect(toBaseUnit("100.5", 6)).toBe("100500000")
    expect(toBaseUnit("0.000001", 6)).toBe("1")
  })

  it("floors fraction digits beyond the decimals", () => {
    expect(toBaseUnit("1.9999999", 6)).toBe("1999999")
  })

  it("rejects non-decimal input", () => {
    expect(toBaseUnit("1e2", 6)).toBeNull()
    expect(toBaseUnit("-1", 6)).toBeNull()
    expect(toBaseUnit("", 6)).toBeNull()
  })
})
