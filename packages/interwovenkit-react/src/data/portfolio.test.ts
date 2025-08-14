import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import type { AssetGroup, AssetBalance } from "./portfolio"
import {
  aggregatePortfolio,
  sortAssetGroups,
  sortChainsWithinGroup,
  calculateAssetGroupTotalValue,
} from "./portfolio"
import type { NormalizedChain, PriceItem } from "./chains"
import type { NormalizedAsset } from "./assets"

describe("aggregatePortfolio", () => {
  const mockChains = [
    { chainId: "interwoven-1" },
    { chainId: "minimove-1" },
    { chainId: "miniwasm-1" },
    { chainId: "minievm-1" },
  ] as NormalizedChain[]

  const mockBalances: (Coin[] | undefined)[] = [
    [
      { denom: "uinit", amount: String(1000 * 1e6) }, // 1000 INIT on Initia
      { denom: "uusdc", amount: String(500 * 1e6) }, // 500 USDC on Initia
    ],
    [
      { denom: "uinit", amount: String(2000 * 1e6) }, // 2000 INIT on Minimove
      { denom: "ueth", amount: String(100 * 1e6) }, // 100 ETH on Minimove
    ],
    [{ denom: "uusdc", amount: String(1500 * 1e6) }], // 1500 USDC on Miniwasm
    [{ denom: "ueth", amount: String(50 * 1e6) }], // 50 ETH on Minievm
  ]

  const mockAssets: (NormalizedAsset[] | undefined)[] = [
    [
      { denom: "uinit", symbol: "INIT", decimals: 6, name: "Initia", logoUrl: "" },
      { denom: "uusdc", symbol: "USDC", decimals: 6, name: "USD Coin", logoUrl: "" },
    ],
    [
      { denom: "uinit", symbol: "INIT", decimals: 6, name: "Initia", logoUrl: "" },
      { denom: "ueth", symbol: "ETH", decimals: 6, name: "Ethereum", logoUrl: "" },
    ],
    [{ denom: "uusdc", symbol: "USDC", decimals: 6, name: "USD Coin", logoUrl: "" }],
    [{ denom: "ueth", symbol: "ETH", decimals: 6, name: "Ethereum", logoUrl: "" }],
  ] as (NormalizedAsset[] | undefined)[]

  const mockPrices: (PriceItem[] | undefined)[] = [
    [
      { id: "uinit", price: 2 }, // 1 INIT = $2
      { id: "uusdc", price: 1 }, // 1 USDC = $1
    ],
    [
      { id: "uinit", price: 2 }, // 1 INIT = $2
      { id: "ueth", price: 3000 }, // 1 ETH = $3000
    ],
    [{ id: "uusdc", price: 1 }], // 1 USDC = $1
    [{ id: "ueth", price: 3000 }], // 1 ETH = $3000
  ]

  it("should aggregate portfolio data correctly", () => {
    const result = aggregatePortfolio(mockBalances, mockAssets, mockPrices, mockChains)

    expect(result.totalValue).toBe(458000) // ($2 * 3000 INIT) + ($1 * 2000 USDC) + ($3000 * 150 ETH)
    expect(result.assetGroups).toHaveLength(3)

    // Verify asset ordering: INIT first, then by value (ETH > USDC)
    const symbols = result.assetGroups.map(({ asset }) => asset.symbol)
    expect(symbols).toEqual(["INIT", "ETH", "USDC"])

    // Verify chain portfolios are sorted by value (without currentChainId)
    const chainValues = result.chainPortfolios.map(({ totalValue }) => totalValue)
    expect(chainValues).toEqual([304000, 150000, 2500, 1500])
  })

  it("should prioritize current chain in chainPortfolios", () => {
    const result = aggregatePortfolio(
      mockBalances,
      mockAssets,
      mockPrices,
      mockChains,
      "miniwasm-1",
    )

    expect(result.chainPortfolios[0].chain.chainId).toBe("miniwasm-1")
    expect(result.chainPortfolios[0].totalValue).toBe(1500) // 1500 USDC on Miniwasm
  })

  const edgeCases = [
    {
      name: "zero balances",
      balances: [
        [
          { denom: "uinit", amount: String(1000 * 1e6) }, // 1000 INIT on Initia
          { denom: "uusdc", amount: "0" }, // 0 USDC on Initia
        ],
        undefined,
        [],
        [{ denom: "ueth", amount: String(50 * 1e6) }], // 50 ETH on Minievm
      ],
      assets: mockAssets,
      prices: mockPrices,
      expectedGroups: 2,
      expectedValue: 152000, // ($2 * 1000 INIT) + ($3000 * 50 ETH)
    },
    {
      name: "missing data",
      balances: [
        [{ denom: "uinit", amount: String(1000 * 1e6) }], // 1000 INIT on Initia
        undefined,
        undefined,
        undefined,
      ],
      assets: [
        [{ denom: "uinit", symbol: "INIT", decimals: 6, name: "Initia", logoUrl: "" }],
        undefined,
        undefined,
        undefined,
      ],
      prices: [[{ id: "uinit", price: 2 }], undefined, undefined, undefined],
      expectedGroups: 1,
      expectedValue: 2000, // ($2 * 1000 INIT)
    },
    {
      name: "missing prices",
      balances: mockBalances,
      assets: mockAssets,
      prices: [
        [{ id: "uinit", price: 2 }],
        [{ id: "uinit", price: 2 }],
        [{ id: "uusdc", price: 1 }],
        [{ id: "ueth", price: 3000 }],
      ],
      expectedGroups: 3,
      expectedValue: 157500, // ($2 * 3000 INIT) + ($1 * 1500 USDC) + ($3000 * 50 ETH)
    },
  ]

  edgeCases.forEach(({ name, balances, assets, prices, expectedGroups, expectedValue }) => {
    it(`should handle ${name} gracefully`, () => {
      const result = aggregatePortfolio(balances, assets, prices, mockChains)
      expect(result.totalValue).toBe(expectedValue)
      expect(result.assetGroups).toHaveLength(expectedGroups)
    })
  })

  it("should separate unsupported assets correctly", () => {
    const balancesWithUnsupported: (Coin[] | undefined)[] = [
      [
        { denom: "uinit", amount: String(1000 * 1e6) },
        { denom: "unknown", amount: String(999 * 1e6) },
      ],
      [
        { denom: "uinit", amount: String(2000 * 1e6) },
        { denom: "notregistered", amount: String(777 * 1e6) },
      ],
      [{ denom: "uusdc", amount: String(1500 * 1e6) }],
      [
        { denom: "ueth", amount: String(50 * 1e6) },
        { denom: "mystery", amount: String(555 * 1e6) },
      ],
    ]

    const result = aggregatePortfolio(balancesWithUnsupported, mockAssets, mockPrices, mockChains)

    expect(result.assetGroups).toHaveLength(3)
    expect(result.unsupportedAssetGroups).toHaveLength(3)
    expect(result.totalValue).toBe(157500) // Only supported assets count
  })
})

describe("sortAssetGroups", () => {
  function createAssetGroup({
    symbol,
    totalValue,
    chainCount = 1,
  }: {
    symbol: string
    totalValue: number
    chainCount?: number
  }): AssetGroup {
    const chains = Array.from({ length: chainCount }, (_, i) => ({
      denom: `denom-${symbol}`,
      amount: "100000000",
      quantity: "100",
      price: 1,
      value: totalValue / chainCount,
      chain: { chainId: `chain-${i}` } as NormalizedChain,
      asset: { denom: `denom-${symbol}`, symbol, decimals: 6, logoUrl: "" } as NormalizedAsset,
    }))

    return {
      asset: { denom: `denom-${symbol}`, symbol, decimals: 6, logoUrl: "" },
      chains,
    }
  }

  it("should sort by total value (descending)", () => {
    const groups = [
      createAssetGroup({ symbol: "B", totalValue: 50 }),
      createAssetGroup({ symbol: "A", totalValue: 100 }),
      createAssetGroup({ symbol: "C", totalValue: 25 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(calculateAssetGroupTotalValue)).toEqual([100, 50, 25])
  })

  it("should sort by chain count when values are equal", () => {
    const groups = [
      createAssetGroup({ symbol: "B", totalValue: 100, chainCount: 2 }),
      createAssetGroup({ symbol: "A", totalValue: 100, chainCount: 3 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(({ chains }) => chains.length)).toEqual([3, 2])
  })

  it("should sort alphabetically when value and chain count are equal", () => {
    const groups = [
      createAssetGroup({ symbol: "ZZZ", totalValue: 100 }),
      createAssetGroup({ symbol: "AAA", totalValue: 100 }),
      createAssetGroup({ symbol: "MMM", totalValue: 100 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(({ asset }) => asset.symbol)).toEqual(["AAA", "MMM", "ZZZ"])
  })

  it("should keep INIT symbol at the top regardless of value", () => {
    const groups = [
      createAssetGroup({ symbol: "USDC", totalValue: 1000 }),
      createAssetGroup({ symbol: "INIT", totalValue: 10 }),
      createAssetGroup({ symbol: "ETH", totalValue: 500 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted[0].asset.symbol).toBe("INIT")
  })
})

describe("sortChainsWithinGroup", () => {
  function createChainBalance({
    chainName,
    value,
  }: {
    chainName: string
    value: number
  }): AssetBalance {
    return {
      denom: "denom",
      amount: "100000000",
      quantity: "100",
      price: 1,
      value,
      chain: { chainId: chainName.toLowerCase(), name: chainName } as NormalizedChain,
      asset: { denom: "denom", symbol: "TOKEN", decimals: 6, logoUrl: "" },
    }
  }

  it("should sort chains by value (descending)", () => {
    const chains = [
      createChainBalance({ chainName: "Alpha", value: 50 }),
      createChainBalance({ chainName: "Beta", value: 100 }),
      createChainBalance({ chainName: "Gamma", value: 25 }),
    ]
    const sorted = sortChainsWithinGroup(chains)
    expect(sorted.map(({ value }) => value)).toEqual([100, 50, 25])
  })

  it("should sort alphabetically by chain name when values are equal", () => {
    const chains = [
      createChainBalance({ chainName: "Zebra", value: 100 }),
      createChainBalance({ chainName: "Alpha", value: 100 }),
      createChainBalance({ chainName: "Mike", value: 100 }),
    ]
    const sorted = sortChainsWithinGroup(chains)
    expect(sorted.map(({ chain }) => chain.name)).toEqual(["Alpha", "Mike", "Zebra"])
  })
})
