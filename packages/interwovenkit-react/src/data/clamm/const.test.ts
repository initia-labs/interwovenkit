import { describe, expect, it } from "vitest"
import { i64FromBits, isFullRange, MAX_TICK } from "./const"

describe("clamm const utils", () => {
  it("decodes positive i64 bits as-is", () => {
    expect(i64FromBits("443600")).toBe(443600n)
  })

  it("decodes negative i64 bits from two's complement", () => {
    expect(i64FromBits("18446744073709108016")).toBe(-443600n)
  })

  it("detects full range with known spacing", () => {
    const spacing = 20
    const fullRangeMin = Math.trunc(-Number(MAX_TICK) / spacing) * spacing
    const fullRangeMax = Math.trunc(Number(MAX_TICK) / spacing) * spacing

    const minBits =
      fullRangeMin < 0 ? (2n ** 64n + BigInt(fullRangeMin)).toString() : String(fullRangeMin)
    const maxBits = String(fullRangeMax)

    expect(isFullRange(minBits, maxBits, spacing)).toBe(true)
  })
})
