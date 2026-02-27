import type { AssetWithChain } from "../search/types"
import { parseBridgeIntent } from "./parseBridgeIntent"
import { getUnavailablePairMessage, resolveIntent } from "./useResolveIntent"

function makeAsset(overrides: Partial<AssetWithChain> = {}): AssetWithChain {
  return {
    denom: "base",
    symbol: "TOKEN",
    decimals: 6,
    logoUrl: "",
    name: "Token",
    chainId: "initia-1",
    chainName: "Initia",
    chainLogoUrl: "",
    ...overrides,
  }
}

const CHAINS = [
  { chain_id: "initia-1", pretty_name: "Initia", chain_name: "initia" },
  { chain_id: "arbitrum-1", pretty_name: "Arbitrum", chain_name: "arbitrum" },
  { chain_id: "echelon-1", pretty_name: "Echelon", chain_name: "echelon" },
]

const ASSETS = [
  makeAsset({
    symbol: "USDC",
    name: "USD Coin",
    chainId: "arbitrum-1",
    chainName: "Arbitrum",
    denom: "usdc-arb",
  }),
  makeAsset({
    symbol: "USDC",
    name: "USD Coin",
    chainId: "initia-1",
    chainName: "Initia",
    denom: "usdc-initia",
  }),
  makeAsset({
    symbol: "ETH",
    name: "Ethereum",
    chainId: "arbitrum-1",
    chainName: "Arbitrum",
    denom: "eth-arb",
  }),
  makeAsset({
    symbol: "iUSD",
    name: "Interwoven USD",
    chainId: "initia-1",
    chainName: "Initia",
    denom: "iusd-initia",
  }),
]

describe("getUnavailablePairMessage", () => {
  it("returns error when exact asset+chain are provided but pair does not exist", () => {
    const result = getUnavailablePairMessage(
      { assetText: "iUSD", chainText: "Arbitrum" },
      ASSETS,
      CHAINS,
    )
    expect(result).toBe("iUSD is not available on Arbitrum")
  })

  it("returns undefined when pair exists", () => {
    const result = getUnavailablePairMessage(
      { assetText: "USDC", chainText: "Arbitrum" },
      ASSETS,
      CHAINS,
    )
    expect(result).toBeUndefined()
  })

  it("returns undefined when asset text is partial", () => {
    const result = getUnavailablePairMessage(
      { assetText: "iUS", chainText: "Arbitrum" },
      ASSETS,
      CHAINS,
    )
    expect(result).toBeUndefined()
  })

  it("returns undefined when chain text is partial", () => {
    const result = getUnavailablePairMessage(
      { assetText: "iUSD", chainText: "Arbi" },
      ASSETS,
      CHAINS,
    )
    expect(result).toBeUndefined()
  })
})

describe("resolveIntent", () => {
  it("treats single-token chain-first input as chain with missing asset", () => {
    const parsed = parseBridgeIntent("1 Echelon")
    const result = resolveIntent(parsed, ASSETS, CHAINS)

    expect(result.src.chainName).toBe("Echelon")
    expect(result.src.assetSymbol).toBeUndefined()
    expect(result.src.denom).toBeUndefined()
    expect(result.isComplete).toBe(false)
  })

  it("defaults destination chain to source chain when destination has only asset", () => {
    const parsed = parseBridgeIntent("1 USDC from Arbitrum to ETH")
    const result = resolveIntent(parsed, ASSETS, CHAINS)

    expect(result.dst.chainName).toBe("Arbitrum")
    expect(result.dst.assetSymbol).toBe("ETH")
    expect(result.dst.denom).toBe("eth-arb")
  })

  it("defaults destination asset to source asset when destination omits asset", () => {
    const parsed = parseBridgeIntent("1 USDC from Arbitrum to Initia")
    const result = resolveIntent(parsed, ASSETS, CHAINS)

    expect(result.src.assetSymbol).toBe("USDC")
    expect(result.dst.chainName).toBe("Initia")
    expect(result.dst.assetSymbol).toBe("USDC")
    expect(result.dst.denom).toBe("usdc-initia")
  })
})
