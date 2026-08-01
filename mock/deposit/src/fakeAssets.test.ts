import { describe, expect, it } from "vitest"
import type { Asset } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { withFakeSourceNetwork } from "./fakeAssets.ts"

const usdc: Asset = {
  src_chain_id: "1",
  src_denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  src_decimals: 6,
  min_deposit_amount: "100000",
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [
    {
      chain_id: "interwoven-1",
      chain_name: "initia",
      denom: "move/6c69733a9e722f3660afb524f89fce957801fa7e4408b8ef8fe89db9627b570e",
      decimals: 6,
      vm_type: "move",
    },
  ],
}

const eth: Asset = {
  ...usdc,
  src_denom: "ethereum-native",
  src_decimals: 18,
  min_deposit_amount: "50000000000000",
  dst_symbol: "ETH",
}

const unknown: Asset = {
  ...usdc,
  src_denom: "0x0000000000000000000000000000000000000001",
  dst_symbol: "FOO",
}

describe("withFakeSourceNetwork", () => {
  it("appends an Arbitrum mirror per mappable asset, originals first", () => {
    const result = withFakeSourceNetwork([usdc, eth])
    expect(result).toHaveLength(4)
    expect(result.slice(0, 2)).toEqual([usdc, eth])

    const [fakeUsdc, fakeEth] = result.slice(2)
    expect(fakeUsdc).toMatchObject({
      src_chain_id: "42161",
      src_denom: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      dst_networks: usdc.dst_networks,
    })
    expect(fakeEth).toMatchObject({
      src_chain_id: "42161",
      src_denom: "arbitrum-native",
    })
  })

  it("doubles the minimum so the two networks visibly differ", () => {
    const [, fake] = withFakeSourceNetwork([usdc])
    expect(fake.min_deposit_amount).toBe("200000")
  })

  it("skips assets without a denom mapping", () => {
    expect(withFakeSourceNetwork([unknown])).toEqual([unknown])
  })

  it("does not mirror an already-Arbitrum asset", () => {
    const arbitrum: Asset = { ...usdc, src_chain_id: "42161" }
    expect(withFakeSourceNetwork([arbitrum])).toEqual([arbitrum])
  })
})
