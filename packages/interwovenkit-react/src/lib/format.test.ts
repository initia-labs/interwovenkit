import { describe, expect, it } from "vitest"
import { formatValue } from "./format"

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

  it("should return <$0.01 for values less than 0.01", () => {
    expect(formatValue(0.001)).toBe("<$0.01")
    expect(formatValue(0.009)).toBe("<$0.01")
    expect(formatValue(0.0099)).toBe("<$0.01")
    expect(formatValue("0.005")).toBe("<$0.01")
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
    expect(formatValue("0.001")).toBe("<$0.01")
  })

  it("should handle negative values", () => {
    expect(formatValue(-100)).toBe("$-100.00")
    expect(formatValue(-1000)).toBe("$-1,000.00")
  })

  it("should handle BigNumber-compatible inputs", () => {
    expect(formatValue("123456789.123456789")).toBe("$123,456,789.12")
    expect(formatValue("0.000000001")).toBe("<$0.01")
  })
})
