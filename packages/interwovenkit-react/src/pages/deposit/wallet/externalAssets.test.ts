import { describe, expect, it } from "vitest"
import { DEPOSIT_API_SOURCES } from "./depositSources"
import {
  shouldShowTransferSource,
  synthesizeDepositApiAsset,
  synthesizeDepositApiChain,
} from "./externalAssets"

const [ethereum, base] = DEPOSIT_API_SOURCES

describe("shouldShowTransferSource", () => {
  it("keeps today's positive-balance rule for Router deposit sources", () => {
    const args = { mode: "deposit", isDepositApiSource: false } as const
    expect(shouldShowTransferSource({ ...args, hasPositiveBalance: true })).toBe(true)
    expect(shouldShowTransferSource({ ...args, hasPositiveBalance: false })).toBe(false)
  })

  it("lists a Deposit API source whose Skip balance is unknown", () => {
    expect(
      shouldShowTransferSource({
        mode: "deposit",
        hasPositiveBalance: false,
        isDepositApiSource: true,
      }),
    ).toBe(true)
  })

  it("never filters on balance in withdraw mode", () => {
    expect(
      shouldShowTransferSource({
        mode: "withdraw",
        hasPositiveBalance: false,
        isDepositApiSource: false,
      }),
    ).toBe(true)
  })
})

describe("Deposit API fallback records", () => {
  it("synthesizes a usable USDC asset record", () => {
    const asset = synthesizeDepositApiAsset(base, "https://registry.example/images/USDC.png")
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
