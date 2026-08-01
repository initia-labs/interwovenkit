import { describe, expect, it } from "vitest"
import type { Asset } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { resolveSourceRoute } from "./checkout.ts"

// The fields resolveSourceRoute reads, with the rest defaulted to valid noise.
function makeAsset(input: {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
}): Asset {
  return {
    src_chain_id: input.srcChainId,
    src_denom: input.srcDenom,
    src_decimals: 18,
    min_deposit_amount: "1",
    max_slippage_percent: "0.0",
    dst_symbol: "TEST",
    dst_networks: [
      {
        chain_id: input.dstChainId,
        chain_name: "Test",
        denom: input.dstDenom,
        decimals: 6,
        vm_type: "move",
      },
    ],
  }
}

const ETH_NATIVE = makeAsset({
  srcChainId: "1",
  srcDenom: "ethereum-native",
  dstChainId: "interwoven-1",
  dstDenom: "uinit",
})
const USDC_TOKEN = makeAsset({
  srcChainId: "1",
  srcDenom: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  dstChainId: "interwoven-1",
  dstDenom: "uinit",
})
const OTHER_CHAIN = makeAsset({
  srcChainId: "56",
  srcDenom: "bnb-native",
  dstChainId: "interwoven-1",
  dstDenom: "uinit",
})

const checkout = (overrides: Partial<Parameters<typeof resolveSourceRoute>[1]> = {}) => ({
  chainId: "interwoven-1",
  assetDenom: "uinit",
  network: "ethereum",
  crypto: "usdc_ethereum",
  ...overrides,
})

describe("resolveSourceRoute", () => {
  it("picks the -native route for a native crypto id", () => {
    const route = resolveSourceRoute([USDC_TOKEN, ETH_NATIVE], checkout({ crypto: "eth_ethereum" }))
    expect(route).toBe(ETH_NATIVE)
  })

  it("picks the token route for a token crypto id", () => {
    const route = resolveSourceRoute(
      [ETH_NATIVE, USDC_TOKEN],
      checkout({ crypto: "usdc_ethereum" }),
    )
    expect(route).toBe(USDC_TOKEN)
  })

  it("matches the destination case-insensitively on denom", () => {
    const route = resolveSourceRoute([USDC_TOKEN], checkout({ assetDenom: "UINIT" }))
    expect(route).toBe(USDC_TOKEN)
  })

  it("filters candidates by the Onramper network's chain id", () => {
    const route = resolveSourceRoute(
      [OTHER_CHAIN, ETH_NATIVE],
      checkout({ network: "Ethereum", crypto: "eth_ethereum" }),
    )
    expect(route).toBe(ETH_NATIVE)
  })

  it("falls back to the unfiltered candidates when the network filter empties them", () => {
    const route = resolveSourceRoute([OTHER_CHAIN], checkout({ crypto: "bnb_bsc" }))
    expect(route).toBe(OTHER_CHAIN)
  })

  it("returns null when no route serves the destination", () => {
    const route = resolveSourceRoute([ETH_NATIVE, USDC_TOKEN], checkout({ chainId: "unknown-1" }))
    expect(route).toBeNull()
  })
})
