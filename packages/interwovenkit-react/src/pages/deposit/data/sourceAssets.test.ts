import { describe, expect, it } from "vitest"
import { selectSourceAssetOption, type SourceAssetOption } from "./sourceAssets"

const option = (symbol: string): SourceAssetOption => ({ symbol, logoUrl: "", routes: [] })

describe("selectSourceAssetOption", () => {
  const usdc = option("USDC")
  const usdt = option("USDT")
  const options = [usdc, usdt]

  it("selects every supported source asset instead of fixing the first option", () => {
    expect(selectSourceAssetOption(options, "USDC")).toBe(usdc)
    expect(selectSourceAssetOption(options, "USDT")).toBe(usdt)
  })

  it("falls back to the first option when metadata removes the current selection", () => {
    expect(selectSourceAssetOption(options, "DAI")).toBe(usdc)
    expect(selectSourceAssetOption([], "USDC")).toBeUndefined()
  })
})
