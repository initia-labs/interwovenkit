import { describe, expect, it } from "vitest"
import type { RouterAsset } from "@/pages/bridge/data/assets"
import {
  createSourceAssetLookup,
  selectSourceAssetOption,
  type SourceAssetOption,
} from "./sourceAssets"

const option = (symbol: string): SourceAssetOption => ({ symbol, logoUrl: "", routes: [] })

const asset = (denom: string, symbol: string): RouterAsset => ({
  denom,
  chain_id: "1",
  origin_denom: denom,
  origin_chain_id: "1",
  trace: "",
  is_cw20: false,
  is_evm: denom.startsWith("0x"),
  is_svm: false,
  symbol,
  decimals: 6,
  logo_uri: `${symbol}.png`,
})

describe("createSourceAssetLookup", () => {
  const lookup = createSourceAssetLookup({
    "1": { assets: [asset("0xAbCd", "USDC"), asset("uatom", "ATOM")] },
  })

  it("matches EVM denoms case-insensitively", () => {
    expect(lookup.symbol("1", "0xabcd")).toBe("USDC")
    expect(lookup.logoUrl("1", "0xABCD")).toBe("USDC.png")
  })

  it("keeps non-EVM denom matching case-sensitive", () => {
    expect(lookup.symbol("1", "uatom")).toBe("ATOM")
    expect(lookup.logoUrl("1", "UATOM")).toBe("")
  })
})

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
