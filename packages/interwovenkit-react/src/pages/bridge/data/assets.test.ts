import { describe, expect, it } from "vitest"
import { type RouterAsset, sortSkipAssets } from "./assets"

describe("sortSkipAssets", () => {
  it("keeps INIT first when filtering a chain-local asset list", () => {
    const assets: RouterAsset[] = [
      {
        chain_id: "interwoven-1",
        denom: "uusdc",
        symbol: "USDC",
        decimals: 6,
        origin_denom: "uusdc",
        origin_chain_id: "interwoven-1",
        trace: "",
        is_cw20: false,
        is_evm: false,
        is_svm: false,
      },
      {
        chain_id: "interwoven-1",
        denom: "uinit",
        symbol: "INIT",
        decimals: 6,
        origin_denom: "uinit",
        origin_chain_id: "interwoven-1",
        trace: "",
        is_cw20: false,
        is_evm: false,
        is_svm: false,
      },
      {
        chain_id: "interwoven-1",
        denom: "uatom",
        symbol: "ATOM",
        decimals: 6,
        origin_denom: "uatom",
        origin_chain_id: "interwoven-1",
        trace: "",
        is_cw20: false,
        is_evm: false,
        is_svm: false,
      },
    ]

    expect(sortSkipAssets(assets).map((asset) => asset.symbol)).toEqual(["INIT", "USDC", "ATOM"])
  })
})
