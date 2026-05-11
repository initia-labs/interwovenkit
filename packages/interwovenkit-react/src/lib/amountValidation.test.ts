import { describe, expect, it } from "vitest"
import { isInsufficientBalance } from "./amountValidation"

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
