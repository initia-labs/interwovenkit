import type { OnrampPreset } from "@/pages/deposit/data/assetOptions"
import { normalizeOnrampPreset } from "./deposit"

describe("normalizeOnrampPreset", () => {
  test("normalizes a valid host preset", () => {
    expect(normalizeOnrampPreset({ amount: " 40.50 ", currency: " USD " })).toEqual({
      amount: "40.50",
      currency: "usd",
    })
  })

  test.each(["", ".5", "1.", "-5", "1e3", "1,000", "1.234", "abc"])(
    "rejects an invalid amount: %s",
    (amount) => {
      expect(() => normalizeOnrampPreset({ amount, currency: "USD" })).toThrow(/onramp amount/)
    },
  )

  test("rejects an invalid currency", () => {
    expect(() => normalizeOnrampPreset({ amount: "40", currency: "US" })).toThrow(/onramp currency/)
  })

  test("rejects non-string values at runtime", () => {
    const onramp = { amount: 40, currency: "USD" } as unknown as OnrampPreset
    expect(() => normalizeOnrampPreset(onramp)).toThrow(/must be strings/)
  })
})
