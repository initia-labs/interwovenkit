import { describe, expect, it } from "vitest"
import { formatDisplayAmount, formatValue } from "./format"

describe("formatDisplayAmount", () => {
  it("matches default amount formatting for regular amounts", () => {
    expect(formatDisplayAmount("1234567", { decimals: 6 })).toBe("1.234567")
    expect(formatDisplayAmount("1000000", { decimals: 6 })).toBe("1.000000")
  })

  it("shows subscript notation for tiny non-zero amounts hidden by 6dp", () => {
    expect(formatDisplayAmount("1", { decimals: 8 })).toBe("0.0₆1")
    expect(formatDisplayAmount("3159", { decimals: 10 })).toBe("0.0₅3")
  })

  it("uses subscript when precision is hidden beyond the 6th decimal", () => {
    expect(formatDisplayAmount("12345", { decimals: 10 })).toBe("0.0₄1")
  })

  it("supports configurable decimal precision", () => {
    expect(formatDisplayAmount("1", { decimals: 10, dp: 8 })).toBe("0.0₈1")
  })

  it("does not use subscript when amount is exactly zero", () => {
    expect(formatDisplayAmount("0", { decimals: 18 })).toBe("0")
  })
})

describe("formatValue", () => {
  it("should return empty string for undefined", () => {
    expect(formatValue(undefined)).toBe("")
  })

  it("should return empty string for null-like values", () => {
    // @ts-expect-error - testing null handling
    expect(formatValue(null)).toBe("")
  })

  it("should return $0 for zero", () => {
    expect(formatValue(0)).toBe("$0")
    expect(formatValue("0")).toBe("$0")
  })

  it("should return < $0.01 for values less than 0.01", () => {
    expect(formatValue(0.001)).toBe("< $0.01")
    expect(formatValue(0.009)).toBe("< $0.01")
    expect(formatValue(0.0099)).toBe("< $0.01")
    expect(formatValue("0.005")).toBe("< $0.01")
  })

  it("should format regular values with dollar sign", () => {
    expect(formatValue(0.01)).toBe("$0.01")
    expect(formatValue(1)).toBe("$1.00")
    expect(formatValue(10)).toBe("$10.00")
    expect(formatValue(100)).toBe("$100.00")
    expect(formatValue(1000)).toBe("$1,000.00")
    expect(formatValue(1000000)).toBe("$1,000,000.00")
  })

  it("should handle decimal values correctly", () => {
    expect(formatValue(0.1)).toBe("$0.10")
    expect(formatValue(0.15)).toBe("$0.15")
    expect(formatValue(1.5)).toBe("$1.50")
    expect(formatValue(10.99)).toBe("$10.99")
    expect(formatValue(1234.56)).toBe("$1,234.56")
  })

  it("should handle string number inputs", () => {
    expect(formatValue("100")).toBe("$100.00")
    expect(formatValue("1000.50")).toBe("$1,000.50")
    expect(formatValue("0.001")).toBe("< $0.01")
  })

  it("should handle negative values", () => {
    expect(formatValue(-100)).toBe("-$100.00")
    expect(formatValue(-1000)).toBe("-$1,000.00")
  })

  it("should handle negative small values (less than 0.01)", () => {
    expect(formatValue(-0.005)).toBe("< $0.01")
    expect(formatValue(-0.001)).toBe("< $0.01")
    expect(formatValue(-0.009)).toBe("< $0.01")
  })

  it("should handle BigNumber-compatible inputs", () => {
    expect(formatValue("123456789.123456789")).toBe("$123,456,789.12")
    expect(formatValue("0.000000001")).toBe("< $0.01")
  })
})
