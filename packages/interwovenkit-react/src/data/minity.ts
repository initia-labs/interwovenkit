import ky from "ky"
import { useEffect, useEffectEvent, useMemo } from "react"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAllChainPriceQueries, useInitiaRegistry } from "./chains"
import { useConfig } from "./config"
import { INIT_SYMBOL } from "./constants"
import { STALE_TIMES } from "./http"
import type { PortfolioAssetGroup, PortfolioAssetItem } from "./portfolio"

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
// POSITION GROUPING TYPES
// ============================================

/** Section group with positions and pre-calculated total value */
export interface SectionGroup {
  positions: Position[]
  totalValue: number // Actual value (negative for borrowing)
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
  logoUrl?: string // LP token's own logo (for tokens without coinLogos like omniINIT)
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

/** Chain info for display (logo, name) - independent from balances/positions */
export interface ChainInfo {
  chainId: string
  chainName: string
  prettyName: string
  logoUrl: string
}

export interface ChainBalanceData {
  chainName: string
  chainId: string
  balances: Balance[]
}

export interface ChainPositionData {
  chainId: string
  chainName: string
  positions: ProtocolPosition[]
}

// ============================================
// SSE TYPES
// ============================================

/** SSE event data for balances */
export interface SSEBalanceEvent {
  type: "balances"
  chain: string
  chainId: string
  balances: Balance[]
}

/** SSE event data for positions */
export interface SSEPositionEvent {
  type: "positions"
  chain: string
  chainId: string
  positions: ProtocolPosition[]
}

/** SSE event union type */
export type SSEEvent = SSEBalanceEvent | SSEPositionEvent

/** Portfolio data from SSE stream */
export interface SSEPortfolioData {
  balances: ChainBalanceData[]
  positions: ChainPositionData[]
  isLoading: boolean
  isComplete: boolean
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
  totalValue: number
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_MINITY_URL = "https://portfolio-api.minity.xyz"

// ============================================
// CLIENT
// ============================================

function createMinityClient(minityUrl?: string) {
  return ky.create({
    prefixUrl: minityUrl || DEFAULT_MINITY_URL,
    timeout: 30000, // 30 seconds timeout for portfolio API
  })
}

// ============================================
// QUERY KEYS FACTORY
// ============================================

export const minityQueryKeys = createQueryKeys("interwovenkit:minity", {
  // Miscellaneous
  supportedChains: (minityUrl?: string) => [minityUrl],
  prices: (minityUrl?: string) => [minityUrl],

  // SSE Portfolio (balances + positions streamed together)
  ssePortfolio: (address: string, minityUrl?: string) => [address, minityUrl],

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
// SSE CONSTANTS
// ============================================

/** SSE reconnection backoff settings (milliseconds) */
const SSE_RECONNECT_BASE_DELAY = 1000
const SSE_RECONNECT_MAX_DELAY = 10000

const DEFAULT_SSE_DATA: SSEPortfolioData = {
  balances: [],
  positions: [],
  isLoading: false,
  isComplete: false,
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getBalanceValue(balance: Balance): number {
  if (balance.type === "unknown") return 0
  return balance.value ?? 0
}

function getProtocolPositionValue(position: ProtocolPosition): number {
  return position.positions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
}

// ============================================
// MAP BUILDERS
// ============================================

interface AssetQueryResult {
  data?: Array<{ denom: string; symbol: string; logoUrl?: string }>
}

/** Build denom -> logo and symbol -> logo maps from asset queries (fast, no balance dependency) */
export function buildAssetLogoMaps(assetQueries: AssetQueryResult[]): {
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
} {
  const denomMap = new Map<string, string>()
  const symbolMap = new Map<string, string>()

  for (const query of assetQueries) {
    const assets = query.data
    if (!assets) continue

    for (const asset of assets) {
      if (asset.logoUrl && !asset.logoUrl.includes("undefined")) {
        if (!denomMap.has(asset.denom)) {
          denomMap.set(asset.denom, asset.logoUrl)
        }
        const upperSymbol = asset.symbol.toUpperCase()
        if (!symbolMap.has(upperSymbol)) {
          symbolMap.set(upperSymbol, asset.logoUrl)
        }
      }
    }
  }

  return { denomLogos: denomMap, symbolLogos: symbolMap }
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
  const value = position.balance.value ?? 0
  // Borrowing positions should subtract from total (debt/liability)
  if (position.type === "lending" && position.direction === "borrow") {
    return -value
  }
  return value
}

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
export function getSectionLabel(sectionKey: string, isInitia = false): string {
  switch (sectionKey) {
    case "staking":
      return isInitia ? "INIT staking" : "Staking"
    case "borrowing":
      return "Borrowing"
    case "lending":
      return "Lending"
    default:
      return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1)
  }
}

/** Group positions by section (staking, borrowing, lending) - sorted by total value descending */
export function groupPositionsBySection(positions: Position[]): Map<string, SectionGroup> {
  // 1. Group by section key
  const groups = new Map<string, Position[]>()
  for (const pos of positions) {
    const sectionKey = getSectionKey(pos)
    if (!sectionKey) continue
    if (!groups.has(sectionKey)) {
      groups.set(sectionKey, [])
    }
    groups.get(sectionKey)!.push(pos)
  }

  // 2. Calculate total values (actual values - negative for borrowing)
  const sectionValues = new Map<string, number>()
  const sectionAbsValues = new Map<string, number>()
  for (const [key, positions] of groups) {
    const totalValue = positions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
    const totalAbsValue = positions.reduce((sum, pos) => sum + Math.abs(getPositionValue(pos)), 0)
    sectionValues.set(key, totalValue)
    sectionAbsValues.set(key, totalAbsValue)
  }

  // 3. Combine lending + borrowing absolute value for sorting
  const lendingAbsValue = sectionAbsValues.get("lending") ?? 0
  const borrowingAbsValue = sectionAbsValues.get("borrowing") ?? 0
  const combinedLendingBorrowingAbsValue = lendingAbsValue + borrowingAbsValue

  // 4. Sort sections by absolute value descending
  const sortedKeys = Array.from(groups.keys()).toSorted((a, b) => {
    const aValue =
      a === "lending" || a === "borrowing"
        ? combinedLendingBorrowingAbsValue
        : (sectionAbsValues.get(a) ?? 0)
    const bValue =
      b === "lending" || b === "borrowing"
        ? combinedLendingBorrowingAbsValue
        : (sectionAbsValues.get(b) ?? 0)

    // If both are lending/borrowing, maintain internal order (lending before borrowing)
    if ((a === "lending" || a === "borrowing") && (b === "lending" || b === "borrowing")) {
      return a === "lending" ? -1 : 1
    }

    // Sort by value descending
    return bValue - aValue
  })

  // 5. Rebuild Map in sorted order with SectionGroup objects
  const sortedGroups = new Map<string, SectionGroup>()
  for (const key of sortedKeys) {
    sortedGroups.set(key, {
      positions: groups.get(key)!,
      totalValue: sectionValues.get(key) ?? 0,
    })
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
      return "Staking"
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

/** Sort comparator for denom groups: INIT first, then by value desc, then alphabetically */
function compareDenomGroups(a: DenomGroup, b: DenomGroup): number {
  if (a.symbol === INIT_SYMBOL) return -1
  if (b.symbol === INIT_SYMBOL) return 1
  if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue
  return a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
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

  const denomGroups = Array.from(groups.entries()).map(([denom, positions]) => {
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

  return denomGroups.toSorted(compareDenomGroups)
}

// ============================================
// ASSET GROUP UTILITIES
// ============================================

/**
 * Build price map from price queries result.
 * Returns Map<chainId, Map<denom, price>> for O(1) lookups.
 */
export function buildPriceMap(
  chains: { chainId: string }[],
  priceQueries: Array<{ data?: { id: string; price: number }[] }>,
): Map<string, Map<string, number>> {
  const priceMap = new Map<string, Map<string, number>>()

  chains.forEach((chain, index) => {
    const prices = priceQueries[index]?.data
    if (prices && prices.length > 0) {
      const denomPriceMap = new Map(prices.map((p) => [p.id, p.price] as [string, number]))
      priceMap.set(chain.chainId, denomPriceMap)
    }
  })

  return priceMap
}

/**
 * Apply fallback pricing to Minity balances.
 * If Minity doesn't provide a value, calculate it from the price API.
 */
export function applyFallbackPricing(
  minityBalances: ChainBalanceData[],
  chainPrices: Map<string, Map<string, number>>,
): ChainBalanceData[] {
  return minityBalances.map((chainBalance) => ({
    ...chainBalance,
    balances: chainBalance.balances.map((balance) => {
      // Skip unknown type - no value calculation possible
      if (balance.type === "unknown") {
        return balance
      }

      // If Minity already provided a value, use it
      if (balance.value != null && balance.value > 0) {
        return balance
      }

      // Fallback: Calculate value from price API
      const prices = chainPrices.get(chainBalance.chainId)
      if (prices) {
        const price = prices.get(balance.denom) ?? 0
        if (price > 0) {
          return {
            ...balance,
            value: balance.formattedAmount * price,
          }
        }
      }

      // No value available - return balance as is
      return balance
    }),
  }))
}

/** Sort comparator for asset groups: INIT first, then by value desc, then alphabetically */
export function compareAssetGroups(a: PortfolioAssetGroup, b: PortfolioAssetGroup): number {
  if (a.symbol === INIT_SYMBOL) return -1
  if (b.symbol === INIT_SYMBOL) return 1
  if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue
  return a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
}

/** Group Minity balances by symbol across all chains into PortfolioAssetGroups */
export function groupBalancesBySymbol(
  minityBalances: ChainBalanceData[],
  chainInfoMap: Map<string, ChainInfo>,
): PortfolioAssetGroup[] {
  const groupMap = new Map<string, PortfolioAssetItem[]>()

  // Guard against non-array input (e.g., during SSE loading/error)
  if (!Array.isArray(minityBalances)) {
    return []
  }

  for (const { chainName, balances } of minityBalances) {
    // Guard against non-array balances (e.g., during SSE loading/error)
    if (!Array.isArray(balances)) continue

    const chainInfo = chainInfoMap.get(chainName.toLowerCase())
    const chainId = chainInfo?.chainId ?? chainName

    for (const balance of balances) {
      // Skip unknown types, LP tokens, and assets with no value AND no amount
      if (
        balance.type === "unknown" ||
        balance.type === "lp" ||
        ((balance.value ?? 0) <= 0 && (balance.formattedAmount ?? 0) <= 0)
      )
        continue

      const item: PortfolioAssetItem = {
        symbol: balance.symbol,
        logoUrl: "",
        denom: balance.denom,
        amount: balance.amount,
        decimals: balance.decimals,
        quantity: String(balance.formattedAmount),
        value: balance.value,
        chain: {
          chainId,
          name: chainInfo?.prettyName ?? chainName,
          logoUrl: chainInfo?.logoUrl ?? "",
        },
      }

      const existing = groupMap.get(balance.symbol)
      if (existing) {
        existing.push(item)
      } else {
        groupMap.set(balance.symbol, [item])
      }
    }
  }

  const groups: PortfolioAssetGroup[] = []

  for (const [symbol, assets] of groupMap) {
    const sortedAssets = assets.toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))
    const totalValue = sortedAssets.reduce((sum, a) => sum + (a.value ?? 0), 0)
    const totalAmount = sortedAssets.reduce((sum, a) => sum + Number(a.quantity), 0)

    groups.push({
      symbol,
      logoUrl: "",
      assets: sortedAssets,
      totalValue,
      totalAmount,
    })
  }

  return groups.toSorted(compareAssetGroups)
}

/** Apply logos to asset groups from denom and symbol logo maps */
export function applyLogosToGroups(
  groups: PortfolioAssetGroup[],
  denomLogos: Map<string, string>,
  symbolLogos: Map<string, string>,
): PortfolioAssetGroup[] {
  return groups.map((group) => {
    const assetsWithLogos = group.assets.map((asset) => {
      const upperSymbol = asset.symbol.toUpperCase()
      const logoUrl = denomLogos.get(asset.denom) ?? symbolLogos.get(upperSymbol) ?? ""
      return logoUrl !== asset.logoUrl ? { ...asset, logoUrl } : asset
    })

    let groupLogo = ""
    for (const asset of assetsWithLogos) {
      if (asset.logoUrl) {
        groupLogo = asset.logoUrl
        break
      }
    }
    if (!groupLogo) {
      groupLogo = symbolLogos.get(group.symbol.toUpperCase()) ?? ""
    }

    return groupLogo !== group.logoUrl || assetsWithLogos !== group.assets
      ? { ...group, logoUrl: groupLogo, assets: assetsWithLogos }
      : group
  })
}

/** Filter asset groups by search query and chain, returns filtered groups and total value */
export function filterAssetGroups(
  assetGroups: PortfolioAssetGroup[],
  searchQuery: string,
  selectedChainId: string,
): { filteredAssets: PortfolioAssetGroup[]; totalAssetsValue: number } {
  // Filter by search query
  const searchFilteredAssets = !searchQuery
    ? assetGroups
    : assetGroups.filter((assetGroup) => {
        const { symbol, assets } = assetGroup
        const query = searchQuery.toLowerCase()
        return (
          symbol.toLowerCase().includes(query) ||
          assets.some(({ denom }) => denom.toLowerCase().includes(query))
        )
      })

  // Filter by selected chain
  const chainFilteredAssets = !selectedChainId
    ? searchFilteredAssets
    : searchFilteredAssets
        .map((assetGroup) => ({
          ...assetGroup,
          assets: assetGroup.assets.filter(({ chain }) => chain.chainId === selectedChainId),
        }))
        .filter((assetGroup) => assetGroup.assets.length > 0)

  // Calculate total value
  const totalAssetsValue = chainFilteredAssets.reduce((total, group) => {
    return total + group.assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0)
  }, 0)

  return { filteredAssets: chainFilteredAssets, totalAssetsValue }
}

/** Filter unlisted assets by search query and selected chain */
export function filterUnlistedAssets(
  unlistedAssets: PortfolioAssetItem[],
  searchQuery: string,
  selectedChainId: string,
): PortfolioAssetItem[] {
  // Filter by search query
  const searchFiltered = !searchQuery
    ? unlistedAssets
    : unlistedAssets.filter(({ denom, address }) => {
        const query = searchQuery.toLowerCase()
        return denom.toLowerCase().includes(query) || address?.toLowerCase().includes(query)
      })

  // Filter by selected chain
  return !selectedChainId
    ? searchFiltered
    : searchFiltered.filter(({ chain }) => chain.chainId === selectedChainId)
}

/** Filter both listed and unlisted assets in one operation */
export function filterAllAssets(
  assetGroups: PortfolioAssetGroup[],
  unlistedAssets: PortfolioAssetItem[],
  searchQuery: string,
  selectedChainId: string,
): {
  filteredAssets: PortfolioAssetGroup[]
  totalAssetsValue: number
  filteredUnlistedAssets: PortfolioAssetItem[]
} {
  // Filter listed assets
  const { filteredAssets, totalAssetsValue } = filterAssetGroups(
    assetGroups,
    searchQuery,
    selectedChainId,
  )

  // Filter unlisted assets
  const filteredUnlistedAssets = filterUnlistedAssets(unlistedAssets, searchQuery, selectedChainId)

  return { filteredAssets, totalAssetsValue, filteredUnlistedAssets }
}

/**
 * Optimized single-pass processing of Minity balances.
 * Extracts both listed and unlisted assets in one iteration.
 * Applies fallback pricing inline to avoid extra array allocations.
 */
export function processMinityBalances(
  minityBalances: ChainBalanceData[],
  chainInfoMap: Map<string, ChainInfo>,
  chainPrices: Map<string, Map<string, number>>,
  l1ChainId?: string,
): {
  listedGroups: PortfolioAssetGroup[]
  unlistedAssets: PortfolioAssetItem[]
} {
  // Guard against non-array input
  if (!Array.isArray(minityBalances)) {
    return { listedGroups: [], unlistedAssets: [] }
  }

  const groupMap = new Map<string, PortfolioAssetItem[]>()
  const unlistedAssets: PortfolioAssetItem[] = []

  // Single pass through all balances
  for (const chainBalance of minityBalances) {
    const { chainName, chainId, balances } = chainBalance

    // Guard against non-array balances
    if (!Array.isArray(balances)) continue

    // Look up chain info once per chain
    const chainInfo = chainInfoMap.get(chainName.toLowerCase())
    const resolvedChainId = chainInfo?.chainId ?? chainId ?? chainName
    const chainPrettyName = chainInfo?.prettyName ?? chainName
    const chainLogoUrl = chainInfo?.logoUrl ?? ""

    // Look up prices once per chain
    const prices = chainPrices.get(resolvedChainId)

    for (const balance of balances) {
      // Process unknown assets (unlisted)
      if (balance.type === "unknown") {
        if (!balance.amount || balance.amount === "0") continue

        unlistedAssets.push({
          symbol: balance.denom,
          logoUrl: "",
          denom: balance.denom,
          amount: balance.amount,
          decimals: 0,
          quantity: balance.amount,
          value: undefined,
          unlisted: true,
          chain: {
            chainId: resolvedChainId,
            name: chainPrettyName,
            logoUrl: chainLogoUrl,
          },
        })
        continue
      }

      // Skip LP tokens and zero-value/zero-amount assets
      if (
        balance.type === "lp" ||
        ((balance.value ?? 0) <= 0 && (balance.formattedAmount ?? 0) <= 0)
      ) {
        continue
      }

      // Apply fallback pricing inline (no extra allocation)
      let finalValue = balance.value
      if ((finalValue == null || finalValue <= 0) && prices) {
        const price = prices.get(balance.denom) ?? 0
        if (price > 0) {
          finalValue = balance.formattedAmount * price
        }
      }

      // Process listed assets
      const item: PortfolioAssetItem = {
        symbol: balance.symbol,
        logoUrl: "",
        denom: balance.denom,
        amount: balance.amount,
        decimals: balance.decimals,
        quantity: String(balance.formattedAmount),
        value: finalValue,
        chain: {
          chainId: resolvedChainId,
          name: chainPrettyName,
          logoUrl: chainLogoUrl,
        },
      }

      const existing = groupMap.get(balance.symbol)
      if (existing) {
        existing.push(item)
      } else {
        groupMap.set(balance.symbol, [item])
      }
    }
  }

  // Sort unlisted assets
  unlistedAssets.sort((a, b) => {
    // Initia first
    const aIsL1 = a.chain.chainId === l1ChainId
    const bIsL1 = b.chain.chainId === l1ChainId
    if (aIsL1 && !bIsL1) return -1
    if (!aIsL1 && bIsL1) return 1

    // Then by chain name
    const chainCompare = a.chain.name.localeCompare(b.chain.name)
    if (chainCompare !== 0) return chainCompare

    // Within same chain, by amount descending
    const aAmount = BigInt(a.amount)
    const bAmount = BigInt(b.amount)
    if (aAmount > bAmount) return -1
    if (aAmount < bAmount) return 1

    // Fallback to denom
    return a.denom.localeCompare(b.denom)
  })

  // Build listed asset groups
  const listedGroups: PortfolioAssetGroup[] = []
  for (const [symbol, assets] of groupMap) {
    // Sort assets by value and calculate totals in one pass
    assets.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    let totalValue = 0
    let totalAmount = 0
    for (const asset of assets) {
      totalValue += asset.value ?? 0
      totalAmount += Number(asset.quantity)
    }

    listedGroups.push({
      symbol,
      logoUrl: "",
      assets,
      totalValue,
      totalAmount,
    })
  }

  // Sort groups
  listedGroups.sort(compareAssetGroups)

  return { listedGroups, unlistedAssets }
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
 * Hook to establish SSE connection for portfolio data streaming.
 * Should be called ONCE at the app level (e.g., in a provider or layout).
 * Uses useEffectEvent to ensure handlers read latest values without causing reconnection.
 */
export function usePortfolioSSE() {
  const queryClient = useQueryClient()
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()

  /**
   * Handle balance events from SSE
   */
  const handleBalances = useEffectEvent(
    (event: SSEBalanceEvent, balancesMap: Map<string, ChainBalanceData>) => {
      const qk = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      // Ensure balances is always an array (defensive check for malformed API response)
      const balances = Array.isArray(event.balances) ? event.balances : []
      balancesMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        balances,
      })
      const current = queryClient.getQueryData<SSEPortfolioData>(qk) ?? DEFAULT_SSE_DATA
      queryClient.setQueryData(qk, {
        ...current,
        balances: Array.from(balancesMap.values()),
      })
    },
  )

  /**
   * Handle position events from SSE
   */
  const handlePositions = useEffectEvent(
    (event: SSEPositionEvent, positionsMap: Map<string, ChainPositionData>) => {
      const qk = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      // Ensure positions is always an array (defensive check for malformed API response)
      const positions = Array.isArray(event.positions) ? event.positions : []
      positionsMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        positions,
      })
      const current = queryClient.getQueryData<SSEPortfolioData>(qk) ?? DEFAULT_SSE_DATA
      queryClient.setQueryData(qk, {
        ...current,
        positions: Array.from(positionsMap.values()),
      })
    },
  )

  /**
   * Update cache with latest streamed data.
   * Stream is long-lived; we no longer try to mark completion. isLoading flips
   * to false once we have seen any data chunk (balances or positions).
   */
  const updateAggregated = useEffectEvent(
    (balancesMap: Map<string, ChainBalanceData>, positionsMap: Map<string, ChainPositionData>) => {
      const qk = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      const current = queryClient.getQueryData<SSEPortfolioData>(qk) ?? DEFAULT_SSE_DATA
      const hasData = balancesMap.size > 0 || positionsMap.size > 0
      queryClient.setQueryData(qk, {
        ...current,
        balances: Array.from(balancesMap.values()),
        positions: Array.from(positionsMap.values()),
        isLoading: hasData ? false : current.isLoading,
        isComplete: false,
        completedAt: undefined,
      })
    },
  )

  useEffect(() => {
    if (!address) {
      return
    }

    const qk = minityQueryKeys.ssePortfolio(address, minityUrl).queryKey

    // Seed maps with existing cached data so chains don't disappear during reconnects
    const existingData = queryClient.getQueryData<SSEPortfolioData>(qk)
    const balancesMap = new Map<string, ChainBalanceData>()
    const positionsMap = new Map<string, ChainPositionData>()

    for (const b of existingData?.balances ?? []) {
      balancesMap.set(b.chainName, b)
    }

    for (const p of existingData?.positions ?? []) {
      positionsMap.set(p.chainName, p)
    }

    const baseUrl = minityUrl || DEFAULT_MINITY_URL
    const url = `${baseUrl}/v1/chain/all/${encodeURIComponent(address)}`

    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let stopped = false
    let hasLoggedParseError = false

    const setConnectingState = () => {
      const existing = queryClient.getQueryData<SSEPortfolioData>(qk)
      queryClient.setQueryData(qk, {
        balances: existing?.balances ?? [],
        positions: existing?.positions ?? [],
        isLoading: true,
        isComplete: false,
        completedAt: undefined,
      })
    }

    const cleanup = () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      if (reconnectTimer) return
      setConnectingState()
      const delay = Math.min(
        SSE_RECONNECT_MAX_DELAY,
        SSE_RECONNECT_BASE_DELAY * 2 ** reconnectAttempt,
      )
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (stopped) return
      setConnectingState()

      if (eventSource) {
        eventSource.close()
      }

      eventSource = new EventSource(url)

      eventSource.onopen = () => {
        reconnectAttempt = 0
        hasLoggedParseError = false
      }

      eventSource.onmessage = (event) => {
        if (stopped) return
        try {
          const parsed = JSON.parse(event.data) as SSEEvent
          if (parsed.type === "balances") {
            handleBalances(parsed as SSEBalanceEvent, balancesMap)
          } else if (parsed.type === "positions") {
            handlePositions(parsed as SSEPositionEvent, positionsMap)
          }
          updateAggregated(balancesMap, positionsMap)
        } catch {
          if (!hasLoggedParseError) {
            hasLoggedParseError = true
          }
          scheduleReconnect()
        }
      }

      eventSource.onerror = () => {
        scheduleReconnect()
      }

      eventSource.addEventListener("close", () => {
        scheduleReconnect()
      })
    }

    connect()

    return () => {
      cleanup()
    }
    // Re-run when address changes (user connects/disconnects wallet)
    // minityUrl and queryClient accessed via useEffectEvent handlers (always read latest values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])
}

/**
 * Fetches portfolio data (balances + positions) from cache.
 * Data is populated by usePortfolioSSE hook which should be called once at app level.
 */
export function useMinityPortfolio(): SSEPortfolioData {
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()
  const queryKey = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey

  const { data } = useQuery({
    queryKey,
    queryFn: () => DEFAULT_SSE_DATA,
    enabled: !!address,
    staleTime: STALE_TIMES.MINUTE,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return data ?? DEFAULT_SSE_DATA
}

// ============================================
// COMPUTED HOOKS
// ============================================

/**
 * Provides chain info (logo, prettyName) from registry.
 * Does NOT depend on balances or positions - can be used immediately.
 * Returns a Map for O(1) lookups by chainName (lowercase).
 */
export function useChainInfoMap(): Map<string, ChainInfo> {
  const registry = useInitiaRegistry()

  return useMemo(() => {
    const chainInfoMap = new Map<string, ChainInfo>()

    // Add all chains from registry
    for (const r of registry) {
      const chainKey = r.chain_name.toLowerCase()
      chainInfoMap.set(chainKey, {
        chainId: r.chainId,
        chainName: r.chain_name,
        prettyName: r.name || r.chain_name,
        logoUrl: r.logoUrl || "",
      })
    }

    return chainInfoMap
  }, [registry])
}

/**
 * Computes chain breakdown with logos and percentages from Minity data.
 * Updates progressively as SSE data streams in.
 */
export function useMinityChainBreakdown(): ChainBreakdownItem[] {
  const { balances, positions } = useMinityPortfolio()
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

    const safeBalances = Array.isArray(balances) ? balances : []
    const safePositions = Array.isArray(positions) ? positions : []

    for (const { chainName, balances: chainBalances } of safeBalances) {
      if (!Array.isArray(chainBalances)) continue
      const balanceTotal = chainBalances.reduce((sum, b) => sum + getBalanceValue(b), 0)
      chainTotals.set(chainName, (chainTotals.get(chainName) || 0) + balanceTotal)
    }

    for (const { chainName, positions: chainPositions } of safePositions) {
      if (!Array.isArray(chainPositions)) continue
      const positionTotal = chainPositions.reduce((sum, p) => sum + getProtocolPositionValue(p), 0)
      chainTotals.set(chainName, (chainTotals.get(chainName) || 0) + positionTotal)
    }

    const totalBalance = Array.from(chainTotals.values()).reduce((sum, v) => sum + v, 0)

    return Array.from(chainTotals.entries())
      .filter(([, total]) => total > 0) // Filter out zero-balance chains
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

  return data
}

/**
 * Computes liquid assets total from balances only (excludes LP tokens).
 * Updates progressively as SSE balance data streams in.
 * Applies fallback pricing for balances without values from Minity.
 */
export function useLiquidAssetsBalance(): number {
  const { balances } = useMinityPortfolio()
  const chains = useInitiaRegistry()
  const priceQueries = useAllChainPriceQueries()
  const chainPrices = useMemo(() => buildPriceMap(chains, priceQueries), [chains, priceQueries])

  return useMemo(() => {
    let total = 0
    const safeBalances = Array.isArray(balances) ? balances : []

    // Apply fallback pricing first (same as Assets display)
    const balancesWithPricing = applyFallbackPricing(safeBalances, chainPrices)

    for (const { balances: chainBalances } of balancesWithPricing) {
      if (!Array.isArray(chainBalances)) continue // Skip if balances is not an array
      for (const b of chainBalances) {
        if (b.type === "lp") {
          continue // Skip LP tokens, counted in L1 liquidity positions
        }
        total += getBalanceValue(b)
      }
    }
    return total
  }, [balances, chainPrices])
}

/**
 * Computes appchain positions total from positions only.
 * Excludes Civitia and Yominet which have no USD values (fungible NFTs only).
 * Updates progressively as SSE position data streams in.
 */
export function useAppchainPositionsBalance(): number {
  const { positions } = useMinityPortfolio()

  return useMemo(() => {
    // Chains to exclude from value calculations (fungible NFTs only, no USD values)
    const excludedChains = ["initia", "civitia", "yominet"]

    let total = 0
    const safePositions = Array.isArray(positions) ? positions : []
    for (const { chainName, positions: chainPositions } of safePositions) {
      const lowerChainName = chainName.toLowerCase()

      // Only count appchains, excluding Initia (L1) and chains with no USD values
      if (excludedChains.includes(lowerChainName)) continue
      if (!Array.isArray(chainPositions)) continue

      total += chainPositions.reduce((sum, p) => sum + getProtocolPositionValue(p), 0)
    }
    return total
  }, [positions])
}
