import { describe, expect, it } from "vitest"
import { normalizePersistedSlippage } from "./form"

describe("normalizePersistedSlippage", () => {
  it("returns null when nothing was persisted", () => {
    expect(normalizePersistedSlippage(null)).toBeNull()
  })

  // Earlier builds let SlippageControl persist mid-input values; replaying
  // them would either throw under BigNumber strict mode or sign without
  // slippage protection. Drop them so the default ("0.5") wins.
  it("drops empty-string persistence", () => {
    expect(normalizePersistedSlippage("")).toBeNull()
  })

  it("drops bare decimal point persistence", () => {
    expect(normalizePersistedSlippage(".")).toBeNull()
  })

  it("drops non-numeric persistence", () => {
    expect(normalizePersistedSlippage("abc")).toBeNull()
  })

  it("drops zero persistence", () => {
    expect(normalizePersistedSlippage("0")).toBeNull()
  })

  it("drops negative persistence", () => {
    expect(normalizePersistedSlippage("-1")).toBeNull()
  })

  it("drops non-finite persistence", () => {
    expect(normalizePersistedSlippage("Infinity")).toBeNull()
  })

  it("preserves a valid stored value as-is", () => {
    expect(normalizePersistedSlippage("0.5")).toBe("0.5")
  })

  it("preserves an unusual but valid value", () => {
    expect(normalizePersistedSlippage("2.75")).toBe("2.75")
  })
})
