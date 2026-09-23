import { describe, expect, it } from "vitest"
import { isInsufficientBalance, parseQuantity } from "./amountValidation"

describe("parseQuantity", () => {
  it("returns null for undefined", () => {
    expect(parseQuantity(undefined)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseQuantity("")).toBeNull()
  })

  it("returns null for null", () => {
    expect(parseQuantity(null)).toBeNull()
  })

  it("returns null for a bare decimal point", () => {
    // NumericFormat can emit "." while the user is mid-input; strict-mode
    // BigNumber would throw, so the helper must swallow it.
    expect(parseQuantity(".")).toBeNull()
  })

  it("returns null for non-numeric strings", () => {
    expect(parseQuantity("abc")).toBeNull()
  })

  it("returns null for whitespace-only input", () => {
    expect(parseQuantity(" ")).toBeNull()
  })

  it("returns null for a bare minus sign", () => {
    expect(parseQuantity("-")).toBeNull()
  })

  it("returns null for multi-decimal-point input", () => {
    expect(parseQuantity("1.2.3")).toBeNull()
  })

  it("returns null for comma-grouped input", () => {
    expect(parseQuantity("1,000")).toBeNull()
  })

  // BigNumber("Infinity") parses without throwing but `isFinite()` is false,
  // so the helper must reject it via the isFinite branch rather than the catch.
  it("returns null for Infinity", () => {
    expect(parseQuantity("Infinity")).toBeNull()
  })

  it("returns null for -Infinity", () => {
    expect(parseQuantity("-Infinity")).toBeNull()
  })

  it("returns null for NaN", () => {
    expect(parseQuantity("NaN")).toBeNull()
  })

  // Lock in scientific notation as a valid input so a future defensive regex
  // cannot regress it.
  it("accepts scientific notation 1e10", () => {
    expect(parseQuantity("1e10")?.toFixed()).toBe("10000000000")
  })

  it("parses zero", () => {
    expect(parseQuantity("0")?.toFixed()).toBe("0")
  })

  it("parses trailing-decimal forms", () => {
    expect(parseQuantity("0.")?.toFixed()).toBe("0")
  })

  it("parses leading-decimal forms", () => {
    expect(parseQuantity(".5")?.toFixed()).toBe("0.5")
  })

  it("parses positive decimals", () => {
    expect(parseQuantity("12.34")?.toFixed()).toBe("12.34")
  })

  it("parses negative decimals", () => {
    expect(parseQuantity("-1.5")?.toFixed()).toBe("-1.5")
  })

  it("returns a finite BigNumber for large values", () => {
    const bn = parseQuantity("1000000000000000000")
    expect(bn?.isFinite()).toBe(true)
    expect(bn?.toFixed()).toBe("1000000000000000000")
  })
})

describe("isInsufficientBalance", () => {
  it("returns false when quantity is empty", () => {
    expect(isInsufficientBalance({ quantity: "", balance: "100", decimals: 6 })).toBe(false)
  })

  it("returns false when quantity is undefined", () => {
    expect(isInsufficientBalance({ quantity: undefined, balance: "100", decimals: 6 })).toBe(false)
  })

  it("returns false when balance is undefined", () => {
    expect(isInsufficientBalance({ quantity: "1", balance: undefined, decimals: 6 })).toBe(false)
  })

  it("returns false when decimals is undefined", () => {
    expect(isInsufficientBalance({ quantity: "1", balance: "100", decimals: undefined })).toBe(
      false,
    )
  })

  it("returns false when quantity is zero", () => {
    expect(isInsufficientBalance({ quantity: "0", balance: "100", decimals: 6 })).toBe(false)
  })

  it("treats empty-string balance as zero (insufficient)", () => {
    expect(isInsufficientBalance({ quantity: "1", balance: "", decimals: 6 })).toBe(true)
  })

  it("returns true when quantity exceeds balance", () => {
    expect(isInsufficientBalance({ quantity: "1", balance: "500000", decimals: 6 })).toBe(true)
  })

  it("returns false when quantity equals balance", () => {
    expect(isInsufficientBalance({ quantity: "1", balance: "1000000", decimals: 6 })).toBe(false)
  })

  it("returns false when quantity is less than balance", () => {
    expect(isInsufficientBalance({ quantity: "0.5", balance: "1000000", decimals: 6 })).toBe(false)
  })

  it("handles high-decimal precision without throwing", () => {
    expect(
      isInsufficientBalance({ quantity: "1", balance: "1000000000000000000", decimals: 18 }),
    ).toBe(false)
  })

  it("returns false for unparseable quantity instead of throwing under strict mode", () => {
    expect(isInsufficientBalance({ quantity: "abc", balance: "100", decimals: 6 })).toBe(false)
  })
})
