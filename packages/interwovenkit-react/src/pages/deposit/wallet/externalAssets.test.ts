import { describe, expect, it } from "vitest"
import { DEPOSIT_API_SOURCES } from "./depositSources"
import { synthesizeDepositApiAsset, synthesizeDepositApiChain } from "./externalAssets"

const [ethereum, base] = DEPOSIT_API_SOURCES

describe("Deposit API fallback records", () => {
  it("synthesizes a usable USDC asset record", () => {
    const asset = synthesizeDepositApiAsset(base, "https://registry.example")
    expect(asset).toMatchObject({
      denom: base.denom,
      chain_id: base.chainId,
      symbol: "USDC",
      decimals: 6,
      logo_uri: "https://registry.example/images/USDC.png",
    })
  })

  it("synthesizes an EVM chain record with no RPC, so no pinned read can claim to verify it", () => {
    const chain = synthesizeDepositApiChain(ethereum)
    expect(chain).toMatchObject({
      chain_id: "1",
      chain_type: "evm",
      pretty_name: "Ethereum",
      logo_uri: ethereum.fallbackChainLogoUrl,
      rpc: "",
    })
  })
})
