import { describe, expect, it } from "vitest"
import { getFeeDp, getFeeLabel } from "./feeLabel"

const findAsset = (denom: string) => {
  return { symbol: denom.toUpperCase(), decimals: denom === "utiny" ? 8 : 6 }
}

describe("getFeeDp", () => {
  it("uses default precision for normally visible fees", () => {
    expect(getFeeDp("123456", 6)).toBeUndefined()
  })

  it("uses 8 decimals for tiny fees hidden by default precision", () => {
    expect(getFeeDp("1", 8)).toBe(8)
  })
})

describe("getFeeLabel", () => {
  it("returns 0 for zero fees", () => {
    expect(getFeeLabel({ amount: [{ amount: "0", denom: "uinit" }] }, findAsset)).toBe("0")
  })

  it("formats normal fees with the asset symbol", () => {
    expect(getFeeLabel({ amount: [{ amount: "123456", denom: "uinit" }] }, findAsset)).toBe(
      "0.123456 UINIT",
    )
  })

  it("keeps tiny non-zero fees visible", () => {
    expect(getFeeLabel({ amount: [{ amount: "1", denom: "utiny" }] }, findAsset)).toBe(
      "0.00000001 UTINY",
    )
  })
})
