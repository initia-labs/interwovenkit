import { describe, expect, it } from "vitest"
import { INIT_SYMBOL } from "../constants"
import type { PortfolioAssetGroup, PortfolioAssetItem } from "../portfolio"
import type {
  Balance,
  ChainBalanceData,
  ChainInfo,
  FungiblePosition,
  Position,
  ProtocolPosition,
  TokenAsset,
} from "./types"
import {
  applyFallbackPricing,
  applyLogosToGroups,
  buildAssetLogoMaps,
  buildPriceMap,
  compareAssetGroups,
  filterAllAssets,
  filterAssetGroups,
  filterUnlistedAssets,
  getPositionBalance,
  getPositionDenom,
  getPositionSymbol,
  getPositionTypeLabel,
  getPositionValue,
  getSectionKey,
  getSectionLabel,
  groupBalancesBySymbol,
  groupPositionsByDenom,
  groupPositionsBySection,
  groupPositionsByType,
  isStakingProtocol,
  isStakingType,
  processMinityBalances,
} from "./utilities"

// ============================================
// MOCK DATA FACTORIES
// ============================================

const createMockBalance = (overrides: Partial<TokenAsset> = {}): TokenAsset => ({
  type: "asset",
  denom: "uinit",
  symbol: "INIT",
  decimals: 6,
  amount: "1000000",
  formattedAmount: 1,
  value: 100,
  ...overrides,
})

// Create a generic balance that can be any Balance type
const createMockBalanceOfType = (
  type: Balance["type"],
  overrides: Record<string, unknown> = {},
): Balance => {
  if (type === "unknown") {
    return {
      type: "unknown",
      denom: "unknown-denom",
      amount: "0",
      ...overrides,
    } as Balance
  }
  if (type === "lp") {
    return {
      type: "lp",
      denom: "lp-denom",
      symbol: "LP",
      decimals: 6,
      amount: "1000000",
      formattedAmount: 1,
      value: 100,
      coins: [],
      ...overrides,
    } as Balance
  }
  return {
    type: "asset",
    denom: "uinit",
    symbol: "INIT",
    decimals: 6,
    amount: "1000000",
    formattedAmount: 1,
    value: 100,
    ...overrides,
  } as Balance
}

const createMockPosition = (overrides: Partial<Position> = {}): Position =>
  ({
    type: "staking",
    balance: createMockBalance(),
    ...overrides,
  }) as Position

const createMockFungiblePosition = (
  overrides: Partial<FungiblePosition> = {},
): FungiblePosition => ({
  type: "fungible-position",
  title: "LP-INIT-USDC",
  value: 100,
  amount: 1,
  ...overrides,
})

const createMockProtocolPosition = (
  positions: Position[] = [createMockPosition()],
): ProtocolPosition => ({
  protocol: "Test Protocol",
  positions,
})

const createMockChainBalanceData = (
  overrides: Partial<ChainBalanceData> = {},
): ChainBalanceData => ({
  chainName: "initia",
  chainId: "initiation-1",
  balances: [createMockBalance()],
  ...overrides,
})

const createMockChainInfo = (overrides: Partial<ChainInfo> = {}): ChainInfo => ({
  chainId: "initiation-1",
  chainName: "initia",
  prettyName: "Initia",
  logoUrl: "https://registry.initia.xyz/images/initia.png",
  ...overrides,
})

const createMockAssetGroup = (
  overrides: Partial<PortfolioAssetGroup> = {},
): PortfolioAssetGroup => ({
  symbol: "INIT",
  logoUrl: "https://registry.initia.xyz/images/init.png",
  assets: [],
  totalValue: 100,
  totalAmount: 1,
  ...overrides,
})

const createMockAssetItem = (overrides: Partial<PortfolioAssetItem> = {}): PortfolioAssetItem => ({
  symbol: "INIT",
  logoUrl: "https://registry.initia.xyz/images/init.png",
  denom: "uinit",
  amount: "1000000",
  decimals: 6,
  quantity: "1",
  value: 100,
  chain: {
    chainId: "initiation-1",
    name: "Initia",
    logoUrl: "https://registry.initia.xyz/images/initia.png",
  },
  ...overrides,
})

// ============================================
// TESTS
// ============================================

describe("minity/utilities", () => {
  describe("Map Builders", () => {
    describe("buildAssetLogoMaps", () => {
      it("should build denom and symbol logo maps with chainId:denom keys", () => {
        const queries = [
          {
            data: [
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/init.png",
              },
              {
                denom: "uusdc",
                symbol: "USDC",
                logoUrl: "https://registry.initia.xyz/images/usdc.png",
              },
            ],
          },
        ]
        const chains = [{ chainId: "initiation-1" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.get("initiation-1:uinit")).toBe(
          "https://registry.initia.xyz/images/init.png",
        )
        expect(denomLogos.get("initiation-1:uusdc")).toBe(
          "https://registry.initia.xyz/images/usdc.png",
        )
        expect(symbolLogos.get("INIT")).toBe("https://registry.initia.xyz/images/init.png")
        expect(symbolLogos.get("USDC")).toBe("https://registry.initia.xyz/images/usdc.png")
      })

      it("should skip queries without data or chain", () => {
        const queries = [{ data: undefined }, {}]
        const chains = [{ chainId: "chain-1" }, { chainId: "chain-2" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.size).toBe(0)
        expect(symbolLogos.size).toBe(0)
      })

      it("should skip assets without logoUrl", () => {
        const queries = [
          {
            data: [
              { denom: "uinit", symbol: "INIT", logoUrl: undefined },
              { denom: "uusdc", symbol: "USDC", logoUrl: "" },
            ],
          },
        ]
        const chains = [{ chainId: "initiation-1" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.size).toBe(0)
        expect(symbolLogos.size).toBe(0)
      })

      it("should filter out logos containing 'undefined'", () => {
        const queries = [
          {
            data: [
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/undefined.png",
              },
            ],
          },
        ]
        const chains = [{ chainId: "initiation-1" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.size).toBe(0)
        expect(symbolLogos.size).toBe(0)
      })

      it("should prefer first logo for duplicate denoms/symbols", () => {
        const queries = [
          {
            data: [
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/init1.png",
              },
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/init2.png",
              },
            ],
          },
        ]
        const chains = [{ chainId: "initiation-1" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.get("initiation-1:uinit")).toBe(
          "https://registry.initia.xyz/images/init1.png",
        )
        expect(symbolLogos.get("INIT")).toBe("https://registry.initia.xyz/images/init1.png")
      })

      it("should convert symbols to uppercase for symbol map", () => {
        const queries = [
          {
            data: [
              {
                denom: "uinit",
                symbol: "init",
                logoUrl: "https://registry.initia.xyz/images/init.png",
              },
            ],
          },
        ]
        const chains = [{ chainId: "initiation-1" }]

        const { symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(symbolLogos.get("INIT")).toBe("https://registry.initia.xyz/images/init.png")
        expect(symbolLogos.get("init")).toBeUndefined()
      })

      it("should use chainId:denom keys to prevent cross-chain collision", () => {
        const queries = [
          {
            data: [
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/chain-1/INIT.png",
              },
            ],
          },
          {
            data: [
              {
                denom: "uinit",
                symbol: "INIT",
                logoUrl: "https://registry.initia.xyz/images/chain-2/INIT.png",
              },
            ],
          },
        ]
        const chains = [{ chainId: "chain-1" }, { chainId: "chain-2" }]

        const { denomLogos, symbolLogos } = buildAssetLogoMaps(queries, chains)

        expect(denomLogos.get("chain-1:uinit")).toBe(
          "https://registry.initia.xyz/images/chain-1/INIT.png",
        )
        expect(denomLogos.get("chain-2:uinit")).toBe(
          "https://registry.initia.xyz/images/chain-2/INIT.png",
        )
        // Symbol takes first logo encountered
        expect(symbolLogos.get("INIT")).toBe("https://registry.initia.xyz/images/chain-1/INIT.png")
      })
    })

    describe("buildPriceMap", () => {
      it("should build nested price map by chainId and denom", () => {
        const chains = [{ chainId: "chain-1" }, { chainId: "chain-2" }]
        const priceQueries = [
          { data: [{ id: "uinit", price: 1.5 }] },
          { data: [{ id: "uusdc", price: 1.0 }] },
        ]

        const priceMap = buildPriceMap(chains, priceQueries)

        expect(priceMap.get("chain-1")?.get("uinit")).toBe(1.5)
        expect(priceMap.get("chain-2")?.get("uusdc")).toBe(1.0)
      })

      it("should skip queries without data", () => {
        const chains = [{ chainId: "chain-1" }]
        const priceQueries = [{ data: undefined }]

        const priceMap = buildPriceMap(chains, priceQueries)

        expect(priceMap.size).toBe(0)
      })

      it("should handle empty price arrays", () => {
        const chains = [{ chainId: "chain-1" }]
        const priceQueries = [{ data: [] }]

        const priceMap = buildPriceMap(chains, priceQueries)

        expect(priceMap.size).toBe(0)
      })

      it("should match chains to queries by index", () => {
        const chains = [{ chainId: "chain-1" }, { chainId: "chain-2" }, { chainId: "chain-3" }]
        const priceQueries = [
          { data: [{ id: "denom1", price: 1 }] },
          { data: [{ id: "denom2", price: 2 }] },
          { data: [{ id: "denom3", price: 3 }] },
        ]

        const priceMap = buildPriceMap(chains, priceQueries)

        expect(priceMap.get("chain-1")?.get("denom1")).toBe(1)
        expect(priceMap.get("chain-2")?.get("denom2")).toBe(2)
        expect(priceMap.get("chain-3")?.get("denom3")).toBe(3)
      })
    })
  })

  describe("Staking Type Utilities", () => {
    describe("isStakingType", () => {
      it("should return true for staking types", () => {
        expect(isStakingType("staking")).toBe(true)
        expect(isStakingType("lockstaking")).toBe(true)
        expect(isStakingType("unstaking")).toBe(true)
      })

      it("should return false for non-staking types", () => {
        expect(isStakingType("lending")).toBe(false)
        expect(isStakingType("fungible-position")).toBe(false)
        expect(isStakingType("unknown")).toBe(false)
      })
    })

    describe("isStakingProtocol", () => {
      it("should return true if any position is staking type", () => {
        const protocol = createMockProtocolPosition([
          createMockPosition({ type: "staking" }),
          createMockPosition({ type: "lending" }),
        ])

        expect(isStakingProtocol(protocol)).toBe(true)
      })

      it("should return false if no positions are staking type", () => {
        const protocol = createMockProtocolPosition([createMockPosition({ type: "lending" })])

        expect(isStakingProtocol(protocol)).toBe(false)
      })

      it("should handle empty positions array", () => {
        const protocol = createMockProtocolPosition([])

        expect(isStakingProtocol(protocol)).toBe(false)
      })
    })
  })

  describe("Position Value Utilities", () => {
    describe("getPositionValue", () => {
      it("should return value for fungible-position", () => {
        const position = createMockFungiblePosition({ value: 150 })

        expect(getPositionValue(position)).toBe(150)
      })

      it("should return 0 for unknown balance type", () => {
        const position = createMockPosition({
          balance: createMockBalanceOfType("unknown"),
        })

        expect(getPositionValue(position)).toBe(0)
      })

      it("should return positive value for regular positions", () => {
        const position = createMockPosition({
          type: "staking",
          balance: createMockBalance({ value: 100 }),
        })

        expect(getPositionValue(position)).toBe(100)
      })

      it("should return negative value for borrowing positions", () => {
        const position = createMockPosition({
          type: "lending",
          direction: "borrow",
          balance: createMockBalance({ value: 100 }),
        })

        expect(getPositionValue(position)).toBe(-100)
      })

      it("should handle null/undefined values as 0", () => {
        const position = createMockPosition({
          balance: createMockBalance({ value: undefined }),
        })

        expect(getPositionValue(position)).toBe(0)
      })
    })

    describe("getSectionKey", () => {
      it("should return null for fungible-position", () => {
        const position = createMockFungiblePosition()

        expect(getSectionKey(position)).toBeNull()
      })

      it("should return 'staking' for staking types", () => {
        expect(getSectionKey(createMockPosition({ type: "staking" }))).toBe("staking")
        expect(getSectionKey(createMockPosition({ type: "unstaking" }))).toBe("staking")
        expect(getSectionKey(createMockPosition({ type: "lockstaking" }))).toBe("staking")
      })

      it("should return 'lending' for supply direction", () => {
        const position = createMockPosition({
          type: "lending",
          direction: "supply",
        })

        expect(getSectionKey(position)).toBe("lending")
      })

      it("should return 'borrowing' for borrow direction", () => {
        const position = createMockPosition({
          type: "lending",
          direction: "borrow",
        })

        expect(getSectionKey(position)).toBe("borrowing")
      })
    })

    describe("getSectionLabel", () => {
      it("should return 'INIT staking' when isInitia=true", () => {
        expect(getSectionLabel("staking", true)).toBe("INIT staking")
      })

      it("should return 'Staking' when isInitia=false", () => {
        expect(getSectionLabel("staking", false)).toBe("Staking")
      })

      it("should return 'Borrowing' for borrowing", () => {
        expect(getSectionLabel("borrowing")).toBe("Borrowing")
      })

      it("should return 'Lending' for lending", () => {
        expect(getSectionLabel("lending")).toBe("Lending")
      })

      it("should capitalize unknown keys", () => {
        expect(getSectionLabel("custom")).toBe("Custom")
      })
    })

    describe("groupPositionsBySection", () => {
      it("should group positions by section key", () => {
        const positions = [
          createMockPosition({ type: "staking" }),
          createMockPosition({ type: "lending", direction: "supply" }),
          createMockPosition({ type: "lockstaking" }),
        ]

        const groups = groupPositionsBySection(positions)

        expect(groups.has("staking")).toBe(true)
        expect(groups.has("lending")).toBe(true)
        expect(groups.get("staking")?.positions.length).toBe(2)
      })

      it("should calculate total values correctly", () => {
        const positions = [
          createMockPosition({
            type: "staking",
            balance: createMockBalance({ value: 100 }),
          }),
          createMockPosition({
            type: "staking",
            balance: createMockBalance({ value: 50 }),
          }),
        ]

        const groups = groupPositionsBySection(positions)

        expect(groups.get("staking")?.totalValue).toBe(150)
      })

      it("should handle borrowing as negative value", () => {
        const positions = [
          createMockPosition({
            type: "lending",
            direction: "borrow",
            balance: createMockBalance({ value: 100 }),
          }),
        ]

        const groups = groupPositionsBySection(positions)

        expect(groups.get("borrowing")?.totalValue).toBe(-100)
      })

      it("should skip positions with null section key", () => {
        const positions = [createMockFungiblePosition(), createMockPosition({ type: "staking" })]

        const groups = groupPositionsBySection(positions)

        expect(groups.size).toBe(1)
        expect(groups.has("staking")).toBe(true)
      })
    })

    describe("getPositionDenom", () => {
      it("should return title for fungible-position", () => {
        const position = createMockFungiblePosition({ title: "LP-INIT-USDC" })

        expect(getPositionDenom(position)).toBe("LP-INIT-USDC")
      })

      it("should return balance.denom for other types", () => {
        const position = createMockPosition({
          balance: createMockBalance({ denom: "uinit" }),
        })

        expect(getPositionDenom(position)).toBe("uinit")
      })
    })

    describe("getPositionSymbol", () => {
      it("should return title for fungible-position", () => {
        const position = createMockFungiblePosition({ title: "LP-INIT-USDC" })

        expect(getPositionSymbol(position)).toBe("LP-INIT-USDC")
      })

      it("should return balance.denom for unknown type", () => {
        const position = createMockPosition({
          balance: createMockBalanceOfType("unknown", { denom: "uinit" }),
        })

        expect(getPositionSymbol(position)).toBe("uinit")
      })

      it("should return balance.symbol for known type", () => {
        const position = createMockPosition({
          balance: createMockBalance({ symbol: "INIT" }),
        })

        expect(getPositionSymbol(position)).toBe("INIT")
      })
    })

    describe("getPositionBalance", () => {
      it("should return null for fungible-position", () => {
        const position = createMockFungiblePosition()

        expect(getPositionBalance(position)).toBeNull()
      })

      it("should return balance for other types", () => {
        const balance = createMockBalance()
        const position = createMockPosition({ balance })

        expect(getPositionBalance(position)).toBe(balance)
      })
    })

    describe("getPositionTypeLabel", () => {
      it("should return correct labels for all position types", () => {
        expect(getPositionTypeLabel("staking")).toBe("Staking")
        expect(getPositionTypeLabel("unstaking")).toBe("Unstaking")
        expect(getPositionTypeLabel("lockstaking")).toBe("Lock staking")
        expect(getPositionTypeLabel("lending")).toBe("Lending")
        expect(getPositionTypeLabel("fungible-position")).toBe("Position")
      })

      it("should return empty string for unknown type", () => {
        // @ts-expect-error Testing invalid type
        expect(getPositionTypeLabel("unknown")).toBe("")
      })
    })

    describe("groupPositionsByType", () => {
      it("should group positions by type", () => {
        const positions = [
          createMockPosition({ type: "staking" }),
          createMockPosition({ type: "lending" }),
          createMockPosition({ type: "staking" }),
        ]

        const groups = groupPositionsByType(positions)

        expect(groups.get("staking")?.length).toBe(2)
        expect(groups.get("lending")?.length).toBe(1)
      })

      it("should handle empty array", () => {
        const groups = groupPositionsByType([])

        expect(groups.size).toBe(0)
      })
    })

    describe("groupPositionsByDenom", () => {
      it("should group positions by denom", () => {
        const positions = [
          createMockPosition({ balance: createMockBalance({ denom: "uinit" }) }),
          createMockPosition({ balance: createMockBalance({ denom: "uusdc" }) }),
          createMockPosition({ balance: createMockBalance({ denom: "uinit" }) }),
        ]

        const groups = groupPositionsByDenom(positions)

        expect(groups.length).toBe(2)
        expect(groups.find((g) => g.denom === "uinit")?.positions.length).toBe(2)
      })

      it("should calculate total value and amount", () => {
        const positions = [
          createMockPosition({
            balance: createMockBalance({ denom: "uinit", value: 100, formattedAmount: 1 }),
          }),
          createMockPosition({
            balance: createMockBalance({ denom: "uinit", value: 50, formattedAmount: 0.5 }),
          }),
        ]

        const groups = groupPositionsByDenom(positions)
        const initGroup = groups.find((g) => g.denom === "uinit")

        expect(initGroup?.totalValue).toBe(150)
        expect(initGroup?.totalAmount).toBe(1.5)
      })

      it("should sort INIT first", () => {
        const positions = [
          createMockPosition({
            balance: createMockBalance({ symbol: "USDC", denom: "uusdc", value: 200 }),
          }),
          createMockPosition({
            balance: createMockBalance({ symbol: INIT_SYMBOL, denom: "uinit", value: 100 }),
          }),
        ]

        const groups = groupPositionsByDenom(positions)

        expect(groups[0].symbol).toBe(INIT_SYMBOL)
      })

      it("should sort by value descending after INIT", () => {
        const positions = [
          createMockPosition({
            balance: createMockBalance({ symbol: "USDC", denom: "uusdc", value: 100 }),
          }),
          createMockPosition({
            balance: createMockBalance({ symbol: "ETH", denom: "ueth", value: 200 }),
          }),
          createMockPosition({
            balance: createMockBalance({ symbol: INIT_SYMBOL, denom: "uinit", value: 50 }),
          }),
        ]

        const groups = groupPositionsByDenom(positions)

        expect(groups[0].symbol).toBe(INIT_SYMBOL)
        expect(groups[1].symbol).toBe("ETH")
        expect(groups[2].symbol).toBe("USDC")
      })
    })
  })

  describe("Asset Group Utilities", () => {
    describe("applyFallbackPricing", () => {
      it("should keep existing Minity values", () => {
        const minityBalances = [
          createMockChainBalanceData({
            balances: [createMockBalance({ value: 100 })],
          }),
        ]
        const chainPrices = new Map()

        const result = applyFallbackPricing(minityBalances, chainPrices)

        const balance = result[0].balances[0]
        if (balance.type !== "unknown") {
          expect(balance.value).toBe(100)
        }
      })

      it("should calculate value from price API when missing", () => {
        const minityBalances = [
          createMockChainBalanceData({
            chainId: "chain-1",
            balances: [
              createMockBalance({
                denom: "uinit",
                value: undefined,
                formattedAmount: 10,
              }),
            ],
          }),
        ]
        const chainPrices = new Map([["chain-1", new Map([["uinit", 5]])]])

        const result = applyFallbackPricing(minityBalances, chainPrices)

        const balance = result[0].balances[0]
        if (balance.type !== "unknown") {
          expect(balance.value).toBe(50)
        }
      })

      it("should skip unknown type balances", () => {
        const minityBalances = [
          createMockChainBalanceData({
            balances: [createMockBalanceOfType("unknown", { value: undefined })],
          }),
        ]
        const chainPrices = new Map([["chain-1", new Map([["uinit", 5]])]])

        const result = applyFallbackPricing(minityBalances, chainPrices)

        const balance = result[0].balances[0]
        expect(balance.type).toBe("unknown")
      })

      it("should skip when no price available", () => {
        const minityBalances = [
          createMockChainBalanceData({
            balances: [createMockBalance({ value: undefined })],
          }),
        ]
        const chainPrices = new Map()

        const result = applyFallbackPricing(minityBalances, chainPrices)

        const balance = result[0].balances[0]
        if (balance.type !== "unknown") {
          expect(balance.value).toBeUndefined()
        }
      })
    })

    describe("compareAssetGroups", () => {
      it("should place INIT first", () => {
        const initGroup = createMockAssetGroup({ symbol: INIT_SYMBOL, totalValue: 50 })
        const usdcGroup = createMockAssetGroup({ symbol: "USDC", totalValue: 100 })

        expect(compareAssetGroups(initGroup, usdcGroup)).toBe(-1)
        expect(compareAssetGroups(usdcGroup, initGroup)).toBe(1)
      })

      it("should sort by value descending", () => {
        const group1 = createMockAssetGroup({ symbol: "USDC", totalValue: 100 })
        const group2 = createMockAssetGroup({ symbol: "ETH", totalValue: 200 })

        expect(compareAssetGroups(group1, group2)).toBeGreaterThan(0)
        expect(compareAssetGroups(group2, group1)).toBeLessThan(0)
      })

      it("should sort alphabetically for same value", () => {
        const groupA = createMockAssetGroup({ symbol: "AAA", totalValue: 100 })
        const groupB = createMockAssetGroup({ symbol: "BBB", totalValue: 100 })

        expect(compareAssetGroups(groupA, groupB)).toBeLessThan(0)
        expect(compareAssetGroups(groupB, groupA)).toBeGreaterThan(0)
      })
    })

    describe("groupBalancesBySymbol", () => {
      it("should group balances by symbol across chains", () => {
        const balances = [
          createMockChainBalanceData({
            chainName: "initia",
            balances: [createMockBalance({ symbol: "INIT", value: 100 })],
          }),
          createMockChainBalanceData({
            chainName: "minimove",
            balances: [createMockBalance({ symbol: "INIT", value: 50 })],
          }),
        ]
        const chainInfoMap = new Map([
          ["initia", createMockChainInfo({ chainName: "initia" })],
          ["minimove", createMockChainInfo({ chainName: "minimove" })],
        ])

        const groups = groupBalancesBySymbol(balances, chainInfoMap)
        const initGroup = groups.find((g) => g.symbol === "INIT")

        expect(initGroup?.assets.length).toBe(2)
        expect(initGroup?.totalValue).toBe(150)
      })

      it("should skip unknown type balances", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [createMockBalanceOfType("unknown", { value: 100 })],
          }),
        ]
        const chainInfoMap = new Map()

        const groups = groupBalancesBySymbol(balances, chainInfoMap)

        expect(groups.length).toBe(0)
      })

      it("should skip LP tokens", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [createMockBalanceOfType("lp", { value: 100 })],
          }),
        ]
        const chainInfoMap = new Map()

        const groups = groupBalancesBySymbol(balances, chainInfoMap)

        expect(groups.length).toBe(0)
      })

      it("should skip zero value and zero amount assets", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [createMockBalance({ value: 0, formattedAmount: 0 })],
          }),
        ]
        const chainInfoMap = new Map()

        const groups = groupBalancesBySymbol(balances, chainInfoMap)

        expect(groups.length).toBe(0)
      })

      it("should guard against non-array input", () => {
        // @ts-expect-error Testing invalid input
        const groups = groupBalancesBySymbol(null, new Map())

        expect(groups).toEqual([])
      })
    })

    describe("applyLogosToGroups", () => {
      it("should apply denom logos to assets using chainId:denom key", () => {
        const groups = [
          createMockAssetGroup({
            assets: [createMockAssetItem({ denom: "uinit", logoUrl: "" })],
          }),
        ]
        // Key format: chainId:denom (asset uses chainId "initiation-1" by default)
        const denomLogos = new Map([
          ["initiation-1:uinit", "https://registry.initia.xyz/images/init.png"],
        ])
        const symbolLogos = new Map()

        const result = applyLogosToGroups(groups, denomLogos, symbolLogos)

        expect(result[0].assets[0].logoUrl).toBe("https://registry.initia.xyz/images/init.png")
      })

      it("should fallback to symbol logos", () => {
        const groups = [
          createMockAssetGroup({
            symbol: "INIT",
            assets: [createMockAssetItem({ symbol: "INIT", denom: "uinit", logoUrl: "" })],
          }),
        ]
        const denomLogos = new Map()
        const symbolLogos = new Map([["INIT", "https://registry.initia.xyz/images/init.png"]])

        const result = applyLogosToGroups(groups, denomLogos, symbolLogos)

        expect(result[0].assets[0].logoUrl).toBe("https://registry.initia.xyz/images/init.png")
      })

      it("should set group logo from first asset with logo from denom map", () => {
        const groups = [
          createMockAssetGroup({
            symbol: "USDC",
            logoUrl: "",
            assets: [
              createMockAssetItem({ denom: "uinit", logoUrl: "" }),
              createMockAssetItem({ denom: "uusdc", logoUrl: "" }),
            ],
          }),
        ]
        // Key format: chainId:denom (asset uses chainId "initiation-1" by default)
        const denomLogos = new Map([
          ["initiation-1:uusdc", "https://registry.initia.xyz/images/usdc.png"],
        ])

        const result = applyLogosToGroups(groups, denomLogos, new Map())

        // First asset with logo from denom map should be used as group logo
        expect(result[0].assets[1].logoUrl).toBe("https://registry.initia.xyz/images/usdc.png")
        expect(result[0].logoUrl).toBe("https://registry.initia.xyz/images/usdc.png")
      })
    })

    describe("filterAssetGroups", () => {
      it("should filter by search query (symbol)", () => {
        const groups = [
          createMockAssetGroup({ symbol: "INIT" }),
          createMockAssetGroup({ symbol: "USDC" }),
        ]

        const { filteredAssets } = filterAssetGroups(groups, "init", "")

        expect(filteredAssets.length).toBe(1)
        expect(filteredAssets[0].symbol).toBe("INIT")
      })

      it("should filter by search query (denom)", () => {
        const groups = [
          createMockAssetGroup({
            symbol: "INIT",
            assets: [createMockAssetItem({ denom: "uinit" })],
          }),
        ]

        const { filteredAssets } = filterAssetGroups(groups, "uinit", "")

        expect(filteredAssets.length).toBe(1)
      })

      it("should filter by selected chain", () => {
        const groups = [
          createMockAssetGroup({
            assets: [
              createMockAssetItem({ chain: { chainId: "chain-1", name: "Chain 1", logoUrl: "" } }),
            ],
          }),
          createMockAssetGroup({
            assets: [
              createMockAssetItem({ chain: { chainId: "chain-2", name: "Chain 2", logoUrl: "" } }),
            ],
          }),
        ]

        const { filteredAssets } = filterAssetGroups(groups, "", "chain-1")

        expect(filteredAssets.length).toBe(1)
      })

      it("should calculate total value correctly", () => {
        const groups = [
          createMockAssetGroup({
            assets: [createMockAssetItem({ value: 100 }), createMockAssetItem({ value: 50 })],
          }),
        ]

        const { totalAssetsValue } = filterAssetGroups(groups, "", "")

        expect(totalAssetsValue).toBe(150)
      })

      it("should handle case-insensitive search", () => {
        const groups = [createMockAssetGroup({ symbol: "INIT" })]

        const { filteredAssets: upper } = filterAssetGroups(groups, "INIT", "")
        const { filteredAssets: lower } = filterAssetGroups(groups, "init", "")

        expect(upper.length).toBe(1)
        expect(lower.length).toBe(1)
      })
    })

    describe("filterUnlistedAssets", () => {
      it("should filter by search query (denom)", () => {
        const assets = [
          createMockAssetItem({ denom: "uinit" }),
          createMockAssetItem({ denom: "uusdc" }),
        ]

        const filtered = filterUnlistedAssets(assets, "init", "")

        expect(filtered.length).toBe(1)
        expect(filtered[0].denom).toBe("uinit")
      })

      it("should filter by search query (address)", () => {
        const assets = [
          createMockAssetItem({ address: "0x123" }),
          createMockAssetItem({ address: "0x456" }),
        ]

        const filtered = filterUnlistedAssets(assets, "123", "")

        expect(filtered.length).toBe(1)
      })

      it("should filter by selected chain", () => {
        const assets = [
          createMockAssetItem({ chain: { chainId: "chain-1", name: "Chain 1", logoUrl: "" } }),
          createMockAssetItem({ chain: { chainId: "chain-2", name: "Chain 2", logoUrl: "" } }),
        ]

        const filtered = filterUnlistedAssets(assets, "", "chain-1")

        expect(filtered.length).toBe(1)
      })
    })

    describe("filterAllAssets", () => {
      it("should filter both listed and unlisted assets", () => {
        const assetGroups = [createMockAssetGroup({ symbol: "INIT" })]
        const unlistedAssets = [createMockAssetItem({ denom: "uinit" })]

        const result = filterAllAssets(assetGroups, unlistedAssets, "init", "")

        expect(result.filteredAssets.length).toBe(1)
        expect(result.filteredUnlistedAssets.length).toBe(1)
      })
    })

    describe("processMinityBalances", () => {
      it("should extract listed and unlisted assets in one pass", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [
              createMockBalance({ symbol: "INIT", value: 100 }),
              createMockBalanceOfType("unknown", { denom: "unknown-denom", amount: "1000" }),
            ],
          }),
        ]
        const chainInfoMap = new Map([["initia", createMockChainInfo()]])
        const chainPrices = new Map()

        const { listedGroups, unlistedAssets } = processMinityBalances(
          balances,
          chainInfoMap,
          chainPrices,
        )

        expect(listedGroups.length).toBe(1)
        expect(unlistedAssets.length).toBe(1)
      })

      it("should apply fallback pricing inline", () => {
        const balances = [
          createMockChainBalanceData({
            chainId: "chain-1",
            balances: [
              createMockBalance({
                denom: "uinit",
                value: undefined,
                formattedAmount: 10,
              }),
            ],
          }),
        ]
        const chainInfoMap = new Map()
        const chainPrices = new Map([["chain-1", new Map([["uinit", 5]])]])

        const { listedGroups } = processMinityBalances(balances, chainInfoMap, chainPrices)

        expect(listedGroups[0].assets[0].value).toBe(50)
      })

      it("should skip LP tokens", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [createMockBalanceOfType("lp", { value: 100 })],
          }),
        ]

        const { listedGroups } = processMinityBalances(balances, new Map(), new Map())

        expect(listedGroups.length).toBe(0)
      })

      it("should skip unknown assets with zero amount", () => {
        const balances = [
          createMockChainBalanceData({
            balances: [createMockBalanceOfType("unknown", { amount: "0" })],
          }),
        ]

        const { unlistedAssets } = processMinityBalances(balances, new Map(), new Map())

        expect(unlistedAssets.length).toBe(0)
      })

      it("should guard against non-array input", () => {
        // @ts-expect-error Testing invalid input
        const result = processMinityBalances(null, new Map(), new Map())

        expect(result.listedGroups).toEqual([])
        expect(result.unlistedAssets).toEqual([])
      })
    })
  })
})
