import { describe, expect, it } from "vitest"
import { getSlippageMessage } from "./slippageMessage"

describe("getSlippageMessage", () => {
  it("rejects empty input", () => {
    expect(getSlippageMessage("")).toEqual({ type: "error", text: "Enter a slippage value" })
  })

  it("rejects undefined input", () => {
    expect(getSlippageMessage(undefined)).toEqual({
      type: "error",
      text: "Enter a slippage value",
    })
  })

  // NumericFormat can emit "." while the user is mid-input; the previous
  // `Number(value) > 100` gate let it through and the bridge signed with no
  // slippage protection. Lock that regression down.
  it("rejects a bare decimal point", () => {
    expect(getSlippageMessage(".")).toEqual({ type: "error", text: "Enter a slippage value" })
  })

  it("rejects non-numeric input", () => {
    expect(getSlippageMessage("abc")).toEqual({ type: "error", text: "Enter a slippage value" })
  })

  it("rejects zero", () => {
    expect(getSlippageMessage("0")).toEqual({
      type: "error",
      text: "Slippage must be greater than 0",
    })
  })

  it("rejects values over 100", () => {
    expect(getSlippageMessage("101")).toEqual({
      type: "error",
      text: "Slippage must be less than 100%",
    })
  })

  it("warns when slippage exceeds 5%", () => {
    expect(getSlippageMessage("5.1")).toEqual({
      type: "warning",
      text: "Your transaction may be frontrun",
    })
  })

  it("warns when slippage is below 0.1%", () => {
    expect(getSlippageMessage("0.05")).toEqual({
      type: "warning",
      text: "Your transaction may fail",
    })
  })

  it("returns null for the default 0.5%", () => {
    expect(getSlippageMessage("0.5")).toBeNull()
  })

  it("returns null for the boundary 0.1%", () => {
    expect(getSlippageMessage("0.1")).toBeNull()
  })

  it("returns null for the boundary 5%", () => {
    expect(getSlippageMessage("5")).toBeNull()
  })

  // Anything above 5% — including the upper bound 100% — is parseable and
  // not >100, so it produces the frontrun warning rather than an error.
  it("warns at the 100% boundary", () => {
    expect(getSlippageMessage("100")).toEqual({
      type: "warning",
      text: "Your transaction may be frontrun",
    })
  })
})
