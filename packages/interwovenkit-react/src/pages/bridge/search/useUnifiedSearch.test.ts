import type { AssetWithChain } from "./types"
import { filterAssets, filterChains, sortAssets } from "./useUnifiedSearch"

function makeAsset(overrides: Partial<AssetWithChain> = {}): AssetWithChain {
  return {
    denom: "utoken",
    symbol: "TOKEN",
    decimals: 6,
    logoUrl: "",
    name: "Token",
    chainId: "chain-1",
    chainName: "Chain One",
    chainLogoUrl: "",
    ...overrides,
  }
}

function makeChain(overrides: Partial<{ pretty_name: string; chain_name: string }> = {}) {
  return {
    pretty_name: "Ethereum",
    chain_name: "ethereum",
    ...overrides,
  }
}

describe("filterChains", () => {
  const chains = [
    makeChain({ pretty_name: "Ethereum", chain_name: "ethereum" }),
    makeChain({ pretty_name: "Initia", chain_name: "initia" }),
    makeChain({ pretty_name: "Arbitrum One", chain_name: "arbitrum" }),
    makeChain({ pretty_name: "Celestia", chain_name: "celestia" }),
  ]

  it("returns starts-with matches first", () => {
    const result = filterChains(chains, "eth")
    expect(result).toHaveLength(1)
    expect(result[0].pretty_name).toBe("Ethereum")
  })

  it("falls back to includes when no starts-with matches", () => {
    const result = filterChains(chains, "eum")
    expect(result).toHaveLength(1)
    expect(result[0].pretty_name).toBe("Ethereum")
  })

  it("is case insensitive", () => {
    const result = filterChains(chains, "INIT")
    expect(result).toHaveLength(1)
    expect(result[0].pretty_name).toBe("Initia")
  })

  it("matches chain_name too", () => {
    const result = filterChains(chains, "arb")
    expect(result).toHaveLength(1)
    expect(result[0].pretty_name).toBe("Arbitrum One")
  })

  it("returns empty for no matches", () => {
    expect(filterChains(chains, "xyz")).toHaveLength(0)
  })

  it("prioritizes shorter prefix matches first", () => {
    const result = filterChains(
      [
        makeChain({ pretty_name: "Initia Testnet", chain_name: "initia-testnet" }),
        makeChain({ pretty_name: "Initia", chain_name: "initia" }),
      ],
      "ini",
    )
    expect(result.map((chain) => chain.pretty_name)).toEqual(["Initia", "Initia Testnet"])
  })
})

describe("filterAssets", () => {
  const assets = [
    makeAsset({ symbol: "USDC", name: "USD Coin" }),
    makeAsset({ symbol: "USDT", name: "Tether" }),
    makeAsset({ symbol: "INIT", name: "Initia Token" }),
    makeAsset({ symbol: "ETH", name: "Ethereum" }),
  ]

  it("returns starts-with matches on symbol", () => {
    const result = filterAssets(assets, "USD")
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.symbol).sort()).toEqual(["USDC", "USDT"])
  })

  it("falls back to includes when no starts-with matches", () => {
    const result = filterAssets(assets, "Coin")
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe("USDC")
  })

  it("matches by name", () => {
    const result = filterAssets(assets, "Tether")
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe("USDT")
  })

  it("is case insensitive", () => {
    const result = filterAssets(assets, "init")
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe("INIT")
  })

  it("returns empty for no matches", () => {
    expect(filterAssets(assets, "xyz")).toHaveLength(0)
  })

  it("prioritizes shorter symbol prefix matches first", () => {
    const result = filterAssets(
      [
        makeAsset({ symbol: "INIT sLP", name: "Initia sLP" }),
        makeAsset({ symbol: "INIT", name: "Initia" }),
      ],
      "ini",
    )
    expect(result[0].symbol).toBe("INIT")
  })

  it("matches multi-word query across asset and chain", () => {
    const multiChainAssets = [
      makeAsset({ symbol: "USDC", chainName: "Ethereum" }),
      makeAsset({ symbol: "USDC", chainName: "Arbitrum" }),
      makeAsset({ symbol: "ETH", chainName: "Ethereum" }),
    ]
    const result = filterAssets(multiChainAssets, "USDC ethereum")
    expect(result).toHaveLength(1)
    expect(result[0].chainName).toBe("Ethereum")
    expect(result[0].symbol).toBe("USDC")
  })

  it("matches multi-word query in any order", () => {
    const multiChainAssets = [
      makeAsset({ symbol: "USDC", chainName: "Ethereum" }),
      makeAsset({ symbol: "ETH", chainName: "Ethereum" }),
    ]
    const result = filterAssets(multiChainAssets, "ethereum usdc")
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe("USDC")
  })
})

describe("sortAssets", () => {
  it("puts INIT first", () => {
    const assets = [
      makeAsset({ symbol: "USDC" }),
      makeAsset({ symbol: "INIT" }),
      makeAsset({ symbol: "ETH" }),
    ]
    const result = sortAssets(assets)
    expect(result[0].symbol).toBe("INIT")
  })

  it("sorts by USD value desc after INIT", () => {
    const assets = [
      makeAsset({ symbol: "USDC", chainId: "c1", denom: "usdc" }),
      makeAsset({ symbol: "ETH", chainId: "c1", denom: "eth" }),
      makeAsset({ symbol: "ATOM", chainId: "c1", denom: "atom" }),
    ]
    const balanceMap = {
      c1: {
        usdc: { amount: "100", value_usd: "100", decimals: 6 },
        eth: { amount: "1", value_usd: "500", decimals: 18 },
        atom: { amount: "20", value_usd: "200", decimals: 6 },
      },
    }
    // @ts-expect-error minimal balance entries for testing
    const result = sortAssets(assets, balanceMap)
    expect(result.map((a) => a.symbol)).toEqual(["ETH", "ATOM", "USDC"])
  })

  it("sorts alphabetically when no balances", () => {
    const assets = [
      makeAsset({ symbol: "USDC" }),
      makeAsset({ symbol: "ATOM" }),
      makeAsset({ symbol: "ETH" }),
    ]
    const result = sortAssets(assets)
    expect(result.map((a) => a.symbol)).toEqual(["ATOM", "ETH", "USDC"])
  })

  it("does not mutate the original array", () => {
    const assets = [makeAsset({ symbol: "B" }), makeAsset({ symbol: "A" })]
    const original = [...assets]
    sortAssets(assets)
    expect(assets[0].symbol).toBe(original[0].symbol)
  })
})
