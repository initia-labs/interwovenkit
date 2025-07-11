import { formatAmount, formatPercent, toAmount, toQuantity } from "./format"

test("formatAmount", () => {
  expect(formatAmount("1234567890")).toBe("1,234,567,890")
  expect(formatAmount("1234567890", { decimals: 0 })).toBe("1,234,567,890")
  expect(formatAmount("1234567890", { decimals: 7 })).toBe("123.456789")
  expect(formatAmount("1234567890", { decimals: 6 })).toBe("1,234.567890")
  expect(formatAmount("1234567890", { decimals: 6, dp: 6 })).toBe("1,234.567890")
  expect(formatAmount("1234567890", { decimals: 6, dp: 0 })).toBe("1,234")
  expect(formatAmount("1234567890", { decimals: 6, dp: 2 })).toBe("1,234.56")
  expect(formatAmount("1", { decimals: 7 })).toBe("0.000000")
  expect(formatAmount("0", { decimals: undefined })).toBe("0")
  expect(formatAmount("")).toBe("0")
  expect(formatAmount("NaN")).toBe("0")
  expect(formatAmount(undefined)).toBe("0")
  expect(formatAmount("988288776786318571428571", { decimals: 0 })).toBe(
    "988,288,776,786,318,571,428,571",
  )
})

test("toAmount", () => {
  expect(toAmount("1234.56789")).toBe("1234567890")
  expect(toAmount("1234", 0)).toBe("1234")
  expect(toAmount("")).toBe("0")
  expect(toAmount("NaN")).toBe("0")
  expect(toAmount(undefined)).toBe("0")
})

test("toQuantity", () => {
  expect(toQuantity("1234567890")).toBe("1234.567890")
  expect(toQuantity("1234567890", 0)).toBe("1234567890")
  expect(toQuantity("1234567890", 7)).toBe("123.456789")
  expect(toQuantity("1234567890", 4)).toBe("123456.7890")
  expect(toQuantity("")).toBe("0")
  expect(toQuantity("NaN")).toBe("0")
  expect(toQuantity(undefined)).toBe("0")
})

test("formatPercent", () => {
  expect(formatPercent("1.23")).toBe("123%")
  expect(formatPercent("1.23", 3)).toBe("123.000%")
  expect(formatPercent("1.23", 0)).toBe("123%")
  expect(formatPercent("1.234567")).toBe("123%")
  expect(formatPercent("1.234567", 3)).toBe("123.457%")
  expect(formatPercent("1.234567", 0)).toBe("123%")
  expect(formatPercent("0.123")).toBe("12.30%")
  expect(formatPercent("0.123", 3)).toBe("12.300%")
  expect(formatPercent("0.123", 0)).toBe("12%")
  expect(formatPercent("0.1234567")).toBe("12.35%")
  expect(formatPercent("0.1234567", 3)).toBe("12.346%")
  expect(formatPercent("0.1234567", 0)).toBe("12%")
  expect(formatPercent("")).toBe("0%")
  expect(formatPercent("NaN")).toBe("0%")
  expect(formatPercent(undefined)).toBe("0%")
})
