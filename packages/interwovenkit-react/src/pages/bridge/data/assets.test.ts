import { describe, expect, it } from "vitest"
import { type RouterAsset, sortSkipAssets } from "./assets"

function createAsset(symbol: string, denom = symbol.toLowerCase()): RouterAsset {
  return {
    chain_id: "interwoven-1",
    denom,
    symbol,
    decimals: 6,
    origin_denom: denom,
    origin_chain_id: "interwoven-1",
    trace: "",
    is_cw20: false,
    is_evm: false,
    is_svm: false,
  }
}

describe("sortSkipAssets", () => {
  it("keeps INIT first when sorting a chain-local asset list", () => {
    const assets: RouterAsset[] = [
      createAsset("USDC", "uusdc"),
      createAsset("INIT", "uinit"),
      createAsset("ATOM", "uatom"),
    ]

    expect(sortSkipAssets(assets).map((asset) => asset.symbol)).toEqual(["INIT", "USDC", "ATOM"])
  })

  it("returns an empty array for empty input", () => {
    expect(sortSkipAssets([])).toEqual([])
  })

  it("preserves the relative order of non-INIT assets", () => {
    const assets: RouterAsset[] = [
      createAsset("USDC", "uusdc"),
      createAsset("ATOM", "uatom"),
      createAsset("OSMO", "uosmo"),
    ]

    expect(sortSkipAssets(assets).map((asset) => asset.symbol)).toEqual(["USDC", "ATOM", "OSMO"])
  })
})
