import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import type { NormalizedChain, PriceItem } from "./chains"
import type { NormalizedAsset } from "./assets"
import type { PortfolioAssetGroup, PortfolioAssetItem } from "./portfolio"
import { calcTotalValue, createPortfolio, sortAssetGroups, sortAssets } from "./portfolio"

describe("createPortfolio", () => {
  const mockChains: NormalizedChain[] = [
    { chainId: "interwoven-1", name: "Initia" },
    { chainId: "minimove-1", name: "Minimove" },
    { chainId: "miniwasm-1", name: "Miniwasm" },
    { chainId: "minievm-1", name: "Minievm" },
  ] as NormalizedChain[]

  const mockBalances: Record<string, Coin[] | undefined> = {
    "interwoven-1": [
      { denom: "uinit", amount: String(1000 * 1e6) }, // 1000 INIT on Initia
      { denom: "uusdc", amount: String(500 * 1e6) }, // 500 USDC on Initia
    ],
    "minimove-1": [
      { denom: "uinit", amount: String(2000 * 1e6) }, // 2000 INIT on Minimove
      { denom: "ueth", amount: String(100 * 1e6) }, // 100 ETH on Minimove
    ],
    "miniwasm-1": [{ denom: "uusdc", amount: String(1500 * 1e6) }], // 1500 USDC on Miniwasm
    "minievm-1": [{ denom: "ueth", amount: String(50 * 1e6) }], // 50 ETH on Minievm
  }

  const mockAssets: Record<string, NormalizedAsset[] | undefined> = {
    "interwoven-1": [
      { denom: "uinit", symbol: "INIT", decimals: 6 } as NormalizedAsset,
      { denom: "uusdc", symbol: "USDC", decimals: 6 } as NormalizedAsset,
    ],
    "minimove-1": [
      { denom: "uinit", symbol: "INIT", decimals: 6 } as NormalizedAsset,
      { denom: "ueth", symbol: "ETH", decimals: 6 } as NormalizedAsset,
    ],
    "miniwasm-1": [{ denom: "uusdc", symbol: "USDC", decimals: 6 } as NormalizedAsset],
    "minievm-1": [{ denom: "ueth", symbol: "ETH", decimals: 6 } as NormalizedAsset],
  }

  const mockPrices: Record<string, PriceItem[] | undefined> = {
    "interwoven-1": [
      { id: "uinit", price: 2 }, // 1 INIT = $2
      { id: "uusdc", price: 1 }, // 1 USDC = $1
    ],
    "minimove-1": [
      { id: "uinit", price: 2 }, // 1 INIT = $2
      { id: "ueth", price: 3000 }, // 1 ETH = $3000
    ],
    "miniwasm-1": [{ id: "uusdc", price: 1 }], // 1 USDC = $1
    "minievm-1": [{ id: "ueth", price: 3000 }], // 1 ETH = $3000
  }

  it("should aggregate portfolio data correctly", () => {
    const { totalValue, assetGroups, chainsByValue } = createPortfolio(
      mockChains,
      mockBalances,
      mockAssets,
      mockPrices,
    )

    expect(totalValue).toBe(458000) // ($2 * 3000 INIT) + ($1 * 2000 USDC) + ($3000 * 150 ETH)
    expect(assetGroups).toHaveLength(3)

    // Verify asset ordering: INIT first, then by value (ETH > USDC)
    const symbols = assetGroups.map(({ symbol }) => symbol)
    expect(symbols).toEqual(["INIT", "ETH", "USDC"])

    // Verify chain portfolios are sorted by value (without currentChainId)
    const chainValues = chainsByValue.map(({ value }) => value)
    expect(chainValues).toEqual([304000, 150000, 2500, 1500])
  })

  it("should prioritize current chain in chainsByValue", () => {
    const { chainsByValue } = createPortfolio(
      mockChains,
      mockBalances,
      mockAssets,
      mockPrices,
      "miniwasm-1",
    )

    expect(chainsByValue[0].chainId).toBe("miniwasm-1")
    expect(chainsByValue[0].value).toBe(1500) // 1500 USDC on Miniwasm
  })

  const edgeCases = [
    {
      name: "zero balances",
      balances: {
        "interwoven-1": [
          { denom: "uinit", amount: String(1000 * 1e6) }, // 1000 INIT on Initia
          { denom: "uusdc", amount: "0" }, // 0 USDC on Initia
        ],
        "minimove-1": undefined,
        "miniwasm-1": [],
        "minievm-1": [{ denom: "ueth", amount: String(50 * 1e6) }], // 50 ETH on Minievm
      },
      assets: mockAssets,
      prices: mockPrices,
      expectedGroups: 2,
      expectedValue: 152000, // ($2 * 1000 INIT) + ($3000 * 50 ETH)
    },
    {
      name: "missing data",
      balances: {
        "interwoven-1": [{ denom: "uinit", amount: String(1000 * 1e6) }], // 1000 INIT on Initia
        "minimove-1": undefined,
        "miniwasm-1": undefined,
        "minievm-1": undefined,
      },
      assets: {
        "interwoven-1": [{ denom: "uinit", symbol: "INIT", decimals: 6 } as NormalizedAsset],
        "minimove-1": undefined,
        "miniwasm-1": undefined,
        "minievm-1": undefined,
      },
      prices: {
        "interwoven-1": [{ id: "uinit", price: 2 }],
        "minimove-1": undefined,
        "miniwasm-1": undefined,
        "minievm-1": undefined,
      },
      expectedGroups: 1,
      expectedValue: 2000, // ($2 * 1000 INIT)
    },
    {
      name: "missing prices",
      balances: mockBalances,
      assets: mockAssets,
      prices: {
        "interwoven-1": [{ id: "uinit", price: 2 }],
        "minimove-1": [{ id: "uinit", price: 2 }],
        "miniwasm-1": [{ id: "uusdc", price: 1 }],
        "minievm-1": [{ id: "ueth", price: 3000 }],
      },
      expectedGroups: 3,
      expectedValue: 157500, // ($2 * 3000 INIT) + ($1 * 1500 USDC) + ($3000 * 50 ETH)
    },
  ]

  edgeCases.forEach(({ name, balances, assets, prices, expectedGroups, expectedValue }) => {
    it(`should handle ${name} gracefully`, () => {
      const { totalValue, assetGroups } = createPortfolio(mockChains, balances, assets, prices)
      expect(totalValue).toBe(expectedValue)
      expect(assetGroups).toHaveLength(expectedGroups)
    })
  })

  it("should separate unsupported assets correctly", () => {
    const balancesWithUnsupported: Record<string, Coin[] | undefined> = {
      "interwoven-1": [
        { denom: "uinit", amount: String(1000 * 1e6) },
        { denom: "unknown", amount: String(999 * 1e6) },
      ],
      "minimove-1": [
        { denom: "uinit", amount: String(2000 * 1e6) },
        { denom: "notregistered", amount: String(777 * 1e6) },
      ],
      "miniwasm-1": [{ denom: "uusdc", amount: String(1500 * 1e6) }],
      "minievm-1": [
        { denom: "ueth", amount: String(50 * 1e6) },
        { denom: "mystery", amount: String(555 * 1e6) },
      ],
    }

    const { assetGroups, unsupportedAssets, totalValue } = createPortfolio(
      mockChains,
      balancesWithUnsupported,
      mockAssets,
      mockPrices,
    )

    expect(assetGroups).toHaveLength(3)
    expect(unsupportedAssets).toHaveLength(3)
    expect(totalValue).toBe(157500) // Only supported assets count
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
  }): PortfolioAssetGroup {
    const assets = Array.from({ length: chainCount }, (_, i) => ({
      amount: "100000000",
      denom: `denom-${symbol}`,
      decimals: 6,
      symbol,
      logoUrl: "",
      quantity: "100",
      price: 1,
      value: totalValue / chainCount,
      chain: { chainId: `chain-${i}`, name: `Chain ${i}`, logoUrl: "" },
    }))

    return {
      symbol,
      logoUrl: "",
      assets,
    }
  }

  it("should sort by total value (descending)", () => {
    const groups = [
      createAssetGroup({ symbol: "B", totalValue: 50 }),
      createAssetGroup({ symbol: "A", totalValue: 100 }),
      createAssetGroup({ symbol: "C", totalValue: 25 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(calcTotalValue)).toEqual([100, 50, 25])
  })

  it("should sort by chain count when values are equal", () => {
    const groups = [
      createAssetGroup({ symbol: "B", totalValue: 100, chainCount: 2 }),
      createAssetGroup({ symbol: "A", totalValue: 100, chainCount: 3 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(({ assets }) => assets.length)).toEqual([3, 2])
  })

  it("should sort alphabetically when value and chain count are equal", () => {
    const groups = [
      createAssetGroup({ symbol: "ZZZ", totalValue: 100 }),
      createAssetGroup({ symbol: "AAA", totalValue: 100 }),
      createAssetGroup({ symbol: "MMM", totalValue: 100 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted.map(({ symbol }) => symbol)).toEqual(["AAA", "MMM", "ZZZ"])
  })

  it("should keep INIT symbol at the top regardless of value", () => {
    const groups = [
      createAssetGroup({ symbol: "USDC", totalValue: 1000 }),
      createAssetGroup({ symbol: "INIT", totalValue: 10 }),
      createAssetGroup({ symbol: "ETH", totalValue: 500 }),
    ]
    const sorted = sortAssetGroups(groups)
    expect(sorted[0].symbol).toBe("INIT")
  })
})

describe("sortChainsWithinGroup", () => {
  function createAssetItem({
    chainName,
    value,
  }: {
    chainName: string
    value: number
  }): PortfolioAssetItem {
    return {
      amount: "100000000",
      denom: "denom",
      decimals: 6,
      symbol: "TOKEN",
      logoUrl: "",
      quantity: "100",
      price: 1,
      value,
      chain: { chainId: chainName.toLowerCase(), name: chainName, logoUrl: "" },
    }
  }

  it("should sort chains by value (descending)", () => {
    const assets = [
      createAssetItem({ chainName: "Alpha", value: 50 }),
      createAssetItem({ chainName: "Beta", value: 100 }),
      createAssetItem({ chainName: "Gamma", value: 25 }),
    ]
    const sorted = sortAssets(assets)
    expect(sorted.map(({ value }) => value)).toEqual([100, 50, 25])
  })

  it("should sort alphabetically by chain name when values are equal", () => {
    const assets = [
      createAssetItem({ chainName: "Zebra", value: 100 }),
      createAssetItem({ chainName: "Alpha", value: 100 }),
      createAssetItem({ chainName: "Mike", value: 100 }),
    ]
    const sorted = sortAssets(assets)
    expect(sorted.map(({ chain }) => chain.name)).toEqual(["Alpha", "Mike", "Zebra"])
  })
})
