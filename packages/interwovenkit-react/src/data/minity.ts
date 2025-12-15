import ky from "ky"
import { useMemo } from "react"
import { queryOptions, useQueries, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useInitiaRegistry } from "./chains"
import { useConfig } from "./config"
import { INIT_SYMBOL } from "./constants"
import { STALE_TIMES } from "./http"
import type { PortfolioAssetGroup } from "./portfolio"

// ============================================
// BALANCE TYPES (Discriminated Union)
// ============================================

/** Token Asset Balance */
export interface TokenAsset {
  type: "asset"
  denom: string
  symbol: string
  value?: number
  amount: string
  formattedAmount: number
  decimals: number
}

/** LP Token Balance with underlying coins */
export interface LpAsset {
  type: "lp"
  denom: string
  symbol: string
  value?: number
  amount: string
  formattedAmount: number
  decimals: number
  coins: Array<{
    denom: string
    symbol: string
    amount: string
    formattedAmount: number
    decimals: number
  }>
}

/** Unknown Asset (no metadata) */
export interface UnknownAsset {
  type: "unknown"
  denom: string
  amount: string
}

/** Balance Discriminated Union */
export type Balance = TokenAsset | LpAsset | UnknownAsset

// ============================================
// POSITION TYPES (Discriminated Union)
// ============================================

/** Staking Position (validator required for Initia, optional for general staking) */
export interface StakingPosition {
  type: "staking"
  validator?: string
  balance: Balance
}

/** Initia Unstaking Position (unbonding) */
export interface UnstakingPosition {
  type: "unstaking"
  validator: string
  completionTime?: number
  balance: Balance
}

/** Initia Lock-Staking Position */
export interface LockStakingPosition {
  type: "lockstaking"
  validator: string
  releaseTime?: number
  balance: Balance
}

/** General Lending Position (Echelon, Inertia) */
export interface LendingPosition {
  type: "lending"
  direction: "borrow" | "supply"
  balance: Balance
}

/** Fungible Position (NFT-like tokens) */
export interface FungiblePosition {
  type: "fungible-position"
  status?: "staked" | "owned"
  title: string
  value?: number
  amount: number
  imageUrl?: string
}

/** Position Discriminated Union */
export type Position =
  | StakingPosition
  | UnstakingPosition
  | LockStakingPosition
  | LendingPosition
  | FungiblePosition

// ============================================
// PROTOCOL POSITION TYPE
// ============================================

export interface ProtocolPosition {
  protocol: string
  manageUrl?: string
  positions: Position[]
}

// ============================================
// LIQUIDITY TYPES
// ============================================

/** Liquidity position breakdown by state */
export interface LiquidityPositionBreakdown {
  deposit: number // LP tokens in wallet
  staking: number // LP tokens staked
  lockStaking: number // LP tokens in lock staking
  unstaking: number // LP tokens unbonding
}

/** Pool types */
export type PoolType = "BALANCER" | "STABLE_SWAP" | "UOINIT"

/** Claimable INIT rewards breakdown */
export interface ClaimableInitBreakdown {
  staking: string // Claimable from regular staking
  lockStaking: string // Claimable from lock staking
  total: string // Total claimable INIT
  totalValue: number // Total value in USD
}

/** Liquidity table row (one per LP token) */
export interface LiquidityTableRow {
  denom: string
  symbol: string
  totalAmount: number
  totalValue: number
  decimals: number
  poolType?: PoolType
  coinLogos?: string[] // [logoUrl1, logoUrl2] for paired tokens
  breakdown: LiquidityPositionBreakdown
  claimableInit?: ClaimableInitBreakdown
}

/** Liquidity section data */
export interface LiquiditySectionData {
  totalValue: number
  rows: LiquidityTableRow[]
}

// ============================================
// MISCELLANEOUS TYPES
// ============================================

/** Supported Chains Response */
export type SupportedChains = string[]

/** Prices Response (array of [symbol, price] tuples) */
export type PriceEntry = [string, number]
export type Prices = PriceEntry[]

// ============================================
// PORTFOLIO SUMMARY TYPES
// ============================================

export interface ChainBreakdownItem {
  chainId: string
  chainName: string
  logoUrl: string
  totalBalance: number
  percentage: number
}

export interface ChainBalanceData {
  chainName: string
  balances: Balance[]
}

export interface ChainPositionData {
  chainId: string
  chainName: string
  positions: ProtocolPosition[]
}

// ============================================
// PORTFOLIO TOTALS TYPE
// ============================================

export interface PortfolioTotals {
  totalBalance: number
  liquidAssetsBalance: number
  l1PositionsBalance: number
  appchainPositionsBalance: number
}

// ============================================
// PORTFOLIO POSITION GROUPING TYPES
// ============================================

/** Position group by chain */
export interface PortfolioChainPositionGroup {
  chainName: string
  chainLogo: string
  protocols: ProtocolPosition[]
  isInitia?: boolean
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_MINITY_URL = "https://portfolio-api.minity.xyz"

// ============================================
// CLIENT
// ============================================

function createMinityClient(minityUrl?: string) {
  return ky.create({ prefixUrl: minityUrl || DEFAULT_MINITY_URL })
}

// ============================================
// QUERY KEYS FACTORY
// ============================================

export const minityQueryKeys = createQueryKeys("interwovenkit:minity", {
  // Miscellaneous
  supportedChains: (minityUrl?: string) => [minityUrl],
  prices: (minityUrl?: string) => [minityUrl],

  // Balances
  balances: (address: string, chainName: string, minityUrl?: string) => [
    address,
    chainName,
    minityUrl,
  ],

  // Positions
  initiaPositions: (address: string, minityUrl?: string) => [address, "initia", minityUrl],
  echelonPositions: (address: string, minityUrl?: string) => [address, "echelon", minityUrl],
  inertiaPositions: (address: string, minityUrl?: string) => [address, "inertia", minityUrl],
  ravePositions: (address: string, includeYield: boolean, minityUrl?: string) => [
    address,
    "rave",
    includeYield,
    minityUrl,
  ],
  civitiaPositions: (address: string, minityUrl?: string) => [address, "civitia", minityUrl],
  yominetPositions: (address: string, minityUrl?: string) => [address, "yominet", minityUrl],
  chainPositions: (address: string, chainName: string, minityUrl?: string) => [
    address,
    chainName,
    minityUrl,
  ],
})

// ============================================
// QUERY OPTIONS
// ============================================

export const minityQueryOptions = {
  // Miscellaneous Endpoints

  supportedChains: (minityUrl?: string) =>
    queryOptions({
      queryKey: minityQueryKeys.supportedChains(minityUrl).queryKey,
      queryFn: async (): Promise<SupportedChains> => {
        return createMinityClient(minityUrl).get("v1/supported-chains").json()
      },
      staleTime: STALE_TIMES.INFINITY,
    }),

  prices: (minityUrl?: string) =>
    queryOptions({
      queryKey: minityQueryKeys.prices(minityUrl).queryKey,
      queryFn: async (): Promise<Prices> => {
        return createMinityClient(minityUrl).get("v1/prices").json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  // Balance Endpoints

  balances: (address: string, chainName: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.balances(address, chainName, minityUrl).queryKey,
      queryFn: async (): Promise<Balance[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/${chainName}/${address}/balances`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  // Position Endpoints

  initiaPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.initiaPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/initia/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  echelonPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.echelonPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/echelon/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  inertiaPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.inertiaPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/inertia/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  ravePositions: (address: string, includeYield = true, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.ravePositions(address, includeYield, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl)
          .get(`v1/chain/rave/${address}/positions`, {
            searchParams: { includeYield: String(includeYield) },
          })
          .json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  civitiaPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.civitiaPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/civitia/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  yominetPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.yominetPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/yominet/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  chainPositions: (address: string, chainName: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.chainPositions(address, chainName, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl)
          .get(`v1/chain/${chainName}/${address}/positions`)
          .json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getBalanceValue(balance: Balance): number {
  if (balance.type === "unknown") return 0
  return balance.value ?? 0
}

function getProtocolPositionValue(position: ProtocolPosition): number {
  return position.positions.reduce((sum, pos) => {
    if (pos.type === "fungible-position") {
      return sum + (pos.value || 0)
    }
    return sum + getBalanceValue(pos.balance)
  }, 0)
}

// ============================================
// MAP BUILDERS
// ============================================

/** Build a map of denom -> logo URLs from InterwovenKit asset groups */
export function buildDenomLogoMap(
  assetGroups: PortfolioAssetGroup[],
): Map<string, { assetLogo: string; chainLogo: string }> {
  const map = new Map<string, { assetLogo: string; chainLogo: string }>()
  for (const group of assetGroups) {
    for (const asset of group.assets) {
      map.set(asset.denom, {
        assetLogo: asset.logoUrl,
        chainLogo: asset.chain.logoUrl,
      })
    }
  }
  return map
}

/** Build a map of chainName (lowercase) -> chain info for O(1) lookups */
export function buildChainInfoMap(
  chainBreakdown: ChainBreakdownItem[],
): Map<string, ChainBreakdownItem> {
  const map = new Map<string, ChainBreakdownItem>()
  for (const chain of chainBreakdown) {
    map.set(chain.chainName.toLowerCase(), chain)
  }
  return map
}

// ============================================
// STAKING TYPE UTILITIES
// ============================================

/** Staking position types */
export const STAKING_TYPES = ["staking", "lockstaking", "unstaking"] as const
export type StakingType = (typeof STAKING_TYPES)[number]

/** Check if a position type is a staking type */
export function isStakingType(type: string): type is StakingType {
  return STAKING_TYPES.includes(type as StakingType)
}

/** Check if a protocol contains staking-type positions (staking, lockstaking, unstaking) */
export function isStakingProtocol(protocol: ProtocolPosition): boolean {
  return protocol.positions.some((pos) => isStakingType(pos.type))
}

// ============================================
// POSITION VALUE UTILITIES
// ============================================

/** Get value from a position based on its type */
export function getPositionValue(position: Position): number {
  if (position.type === "fungible-position") {
    return position.value ?? 0
  }
  if (position.balance.type === "unknown") return 0
  return position.balance.value ?? 0
}

/** Section order for sorting */
const SECTION_ORDER = ["staking", "lending", "borrowing"]

/** Get section key for position - groups staking types and separates lending by direction */
export function getSectionKey(position: Position): string | null {
  if (position.type === "fungible-position") return null
  if (
    position.type === "staking" ||
    position.type === "unstaking" ||
    position.type === "lockstaking"
  ) {
    return "staking"
  }
  if (position.type === "lending") {
    return position.direction === "supply" ? "lending" : "borrowing"
  }
  return null
}

/** Get display label for section key */
export function getSectionLabel(sectionKey: string): string {
  switch (sectionKey) {
    case "staking":
      return "Staking"
    case "borrowing":
      return "Borrowing"
    case "lending":
      return "Lending"
    default:
      return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1)
  }
}

/** Get section order index for sorting */
export function getSectionOrder(sectionKey: string): number {
  const index = SECTION_ORDER.indexOf(sectionKey)
  return index === -1 ? SECTION_ORDER.length : index
}

/** Group positions by section (staking, borrowing, lending) - sorted by section order */
export function groupPositionsBySection(positions: Position[]): Map<string, Position[]> {
  const groups = new Map<string, Position[]>()
  for (const pos of positions) {
    const sectionKey = getSectionKey(pos)
    if (!sectionKey) continue
    if (!groups.has(sectionKey)) {
      groups.set(sectionKey, [])
    }
    groups.get(sectionKey)!.push(pos)
  }

  const sortedGroups = new Map<string, Position[]>()
  const sortedKeys = Array.from(groups.keys()).toSorted(
    (a, b) => getSectionOrder(a) - getSectionOrder(b),
  )
  for (const key of sortedKeys) {
    sortedGroups.set(key, groups.get(key)!)
  }
  return sortedGroups
}

/** Get denom key for grouping positions */
export function getPositionDenom(position: Position): string {
  if (position.type === "fungible-position") {
    return position.title
  }
  return position.balance.denom
}

/** Get symbol for display */
export function getPositionSymbol(position: Position): string {
  if (position.type === "fungible-position") {
    return position.title
  }
  if (position.balance.type === "unknown") {
    return position.balance.denom
  }
  return position.balance.symbol
}

/** Get balance from position (returns null for fungible positions) */
export function getPositionBalance(position: Position): Balance | null {
  if (position.type === "fungible-position") {
    return null
  }
  return position.balance
}

/** Get display label for position type */
export function getPositionTypeLabel(type: Position["type"]): string {
  switch (type) {
    case "staking":
      return "Staked"
    case "unstaking":
      return "Unstaking"
    case "lockstaking":
      return "Lock staking"
    case "lending":
      return "Lending"
    case "fungible-position":
      return "Position"
    default:
      return ""
  }
}

/** Group positions by their type */
export function groupPositionsByType(positions: Position[]): Map<Position["type"], Position[]> {
  const groups = new Map<Position["type"], Position[]>()
  for (const pos of positions) {
    if (!groups.has(pos.type)) {
      groups.set(pos.type, [])
    }
    groups.get(pos.type)!.push(pos)
  }
  return groups
}

/** Denom group with aggregated values */
export interface DenomGroup {
  denom: string
  symbol: string
  positions: Position[]
  totalValue: number
  totalAmount: number
  balance: Balance | null
}

/** Group positions by denom */
export function groupPositionsByDenom(positions: Position[]): DenomGroup[] {
  const groups = new Map<string, Position[]>()

  for (const pos of positions) {
    const denom = getPositionDenom(pos)
    if (!groups.has(denom)) {
      groups.set(denom, [])
    }
    groups.get(denom)!.push(pos)
  }

  return Array.from(groups.entries()).map(([denom, positions]) => {
    const balance = getPositionBalance(positions[0])
    let totalAmount = 0

    for (const pos of positions) {
      if (pos.type !== "fungible-position" && pos.balance.type !== "unknown") {
        totalAmount += pos.balance.formattedAmount
      }
    }

    return {
      denom,
      symbol: getPositionSymbol(positions[0]),
      positions,
      totalValue: positions.reduce((sum, pos) => sum + getPositionValue(pos), 0),
      totalAmount,
      balance,
    }
  })
}

// ============================================
// ASSET GROUP UTILITIES
// ============================================

/** Sort comparator for asset groups: INIT first, then by value desc, then alphabetically */
export function compareAssetGroups(a: PortfolioAssetGroup, b: PortfolioAssetGroup): number {
  if (a.symbol === INIT_SYMBOL) return -1
  if (b.symbol === INIT_SYMBOL) return 1
  const aValue = a.assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0)
  const bValue = b.assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0)
  if (bValue !== aValue) return bValue - aValue
  return a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
}

// ============================================
// BASE DATA HOOKS
// ============================================

/**
 * Fetches supported chains from Minity API
 */
export function useMinitySupportedChains() {
  const { minityUrl } = useConfig()
  return useQuery(minityQueryOptions.supportedChains(minityUrl))
}

/**
 * Fetches prices from Minity API
 */
export function useMinityPrices() {
  const { minityUrl } = useConfig()
  return useQuery(minityQueryOptions.prices(minityUrl))
}

/**
 * Fetches balance data for all supported chains from Minity API
 */
export function useMinityBalances(): {
  data: ChainBalanceData[]
  isLoading: boolean
} {
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()
  const { data: supportedChains, isLoading: isChainsLoading } = useMinitySupportedChains()

  const balanceQueries = useQueries({
    queries:
      address && supportedChains
        ? supportedChains.map((chainName) =>
            minityQueryOptions.balances(address, chainName, minityUrl),
          )
        : [],
  })

  const isLoading = isChainsLoading || balanceQueries.some((q) => q.isLoading)
  const balancesData = balanceQueries.map((q) => q.data)

  const data = useMemo(() => {
    if (!address || !supportedChains) return []
    return supportedChains.map((chainName, index) => ({
      chainName,
      balances: balancesData[index] || [],
    }))
  }, [address, supportedChains, balancesData])

  return { data, isLoading }
}

/**
 * Fetches position data for all supported chains from Minity API
 */
export function useMinityPositions(): {
  data: ChainPositionData[]
  isLoading: boolean
} {
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()
  const { data: supportedChains, isLoading: isChainsLoading } = useMinitySupportedChains()
  const registry = useInitiaRegistry()

  const registryMap = useMemo(() => {
    const map = new Map<string, (typeof registry)[number]>()
    for (const r of registry) {
      map.set(r.chain_name.toLowerCase(), r)
    }
    return map
  }, [registry])

  const positionQueries = useQueries({
    queries:
      address && supportedChains
        ? supportedChains.map((chainName) =>
            minityQueryOptions.chainPositions(address, chainName, minityUrl),
          )
        : [],
  })

  const isLoading = isChainsLoading || positionQueries.some((q) => q.isLoading)
  const positionsData = positionQueries.map((q) => q.data)

  const data = useMemo(() => {
    if (!address || !supportedChains) return []
    return supportedChains.map((chainName, index) => {
      const registryChain = registryMap.get(chainName.toLowerCase())
      return {
        chainId: registryChain?.chainId || "",
        chainName,
        positions: positionsData[index] || [],
      }
    })
  }, [address, supportedChains, positionsData, registryMap])

  return { data, isLoading }
}

// ============================================
// COMPUTED HOOKS
// ============================================

/**
 * Computes chain breakdown with logos and percentages from Minity data
 */
export function useMinityChainBreakdown(): {
  data: ChainBreakdownItem[]
  isLoading: boolean
} {
  const { data: balances, isLoading: isBalancesLoading } = useMinityBalances()
  const { data: positions, isLoading: isPositionsLoading } = useMinityPositions()
  const registry = useInitiaRegistry()

  const registryMap = useMemo(() => {
    const map = new Map<string, (typeof registry)[number]>()
    for (const r of registry) {
      map.set(r.chain_name.toLowerCase(), r)
    }
    return map
  }, [registry])

  const data = useMemo(() => {
    // Calculate totals per chain
    const chainTotals = new Map<string, number>()

    for (const { chainName, balances: chainBalances } of balances) {
      const balanceTotal = chainBalances.reduce((sum, b) => sum + getBalanceValue(b), 0)
      chainTotals.set(chainName, (chainTotals.get(chainName) || 0) + balanceTotal)
    }

    for (const { chainName, positions: chainPositions } of positions) {
      const positionTotal = chainPositions.reduce((sum, p) => sum + getProtocolPositionValue(p), 0)
      chainTotals.set(chainName, (chainTotals.get(chainName) || 0) + positionTotal)
    }

    const totalBalance = Array.from(chainTotals.values()).reduce((sum, v) => sum + v, 0)

    return Array.from(chainTotals.entries())
      .map(([chainName, total]) => {
        const registryChain = registryMap.get(chainName.toLowerCase())
        return {
          chainId: registryChain?.chainId || "",
          chainName: registryChain?.name || chainName,
          logoUrl: registryChain?.logoUrl || "",
          totalBalance: total,
          percentage: totalBalance > 0 ? total / totalBalance : 0,
        }
      })
      .filter((item) => item.chainId !== "") // Filter out chains not in registry
      .toSorted((a, b) => {
        if (a.chainName.toLowerCase() === "initia") return -1
        if (b.chainName.toLowerCase() === "initia") return 1
        return b.totalBalance - a.totalBalance
      })
  }, [balances, positions, registryMap])

  return { data, isLoading: isBalancesLoading || isPositionsLoading }
}

/**
 * Computes portfolio totals from Minity data
 * (total balance, liquid assets, L1 positions, appchain positions)
 */
export function useMinityPortfolioTotals(): {
  data: PortfolioTotals
  isLoading: boolean
} {
  const { data: balances, isLoading: isBalancesLoading } = useMinityBalances()
  const { data: positions, isLoading: isPositionsLoading } = useMinityPositions()

  const data = useMemo(() => {
    let liquidAssetsBalance = 0
    let l1PositionsBalance = 0
    let appchainPositionsBalance = 0

    // Sum up liquid assets from all chains
    for (const { balances: chainBalances } of balances) {
      liquidAssetsBalance += chainBalances.reduce((sum, b) => sum + getBalanceValue(b), 0)
    }

    // Sum up positions, separating L1 from appchains
    for (const { chainName, positions: chainPositions } of positions) {
      const positionTotal = chainPositions.reduce((sum, p) => sum + getProtocolPositionValue(p), 0)
      if (chainName.toLowerCase() === "initia") {
        l1PositionsBalance += positionTotal
      } else {
        appchainPositionsBalance += positionTotal
      }
    }

    const totalBalance = liquidAssetsBalance + l1PositionsBalance + appchainPositionsBalance

    return {
      totalBalance,
      liquidAssetsBalance,
      l1PositionsBalance,
      appchainPositionsBalance,
    }
  }, [balances, positions])

  return { data, isLoading: isBalancesLoading || isPositionsLoading }
}
