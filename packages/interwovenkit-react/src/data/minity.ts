import ky from "ky"
import { useMemo } from "react"
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useInitiaRegistry } from "./chains"
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
// SSE EVENT TYPES
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
// SSE FETCHER
// ============================================

/** SSE connection timeout in milliseconds */
const SSE_TIMEOUT = 60000

type SSEEventType = "balances" | "positions"

interface SSEFetchConfig<T> {
  eventType: SSEEventType
  getEventData: (event: SSEEvent) => T[]
}

/**
 * Generic SSE fetcher that filters for a specific event type.
 * Resolves when stream completes with all collected data.
 */
function createSSEFetcher<TItem, TResult>(
  config: SSEFetchConfig<TItem>,
  mapToResult: (entries: Map<string, { chainId: string; items: TItem[] }>) => TResult[],
) {
  return (address: string, minityUrl?: string): Promise<TResult[]> => {
    const baseUrl = minityUrl || DEFAULT_MINITY_URL
    const url = `${baseUrl}/v1/chain/all/${encodeURIComponent(address)}`

    return new Promise((resolve, reject) => {
      const dataMap = new Map<string, { chainId: string; items: TItem[] }>()
      const eventSource = new EventSource(url)

      const timeout = setTimeout(() => {
        eventSource.close()
        reject(new Error("SSE connection timeout"))
      }, SSE_TIMEOUT)

      const resolveAndClose = () => {
        clearTimeout(timeout)
        eventSource.close()
        resolve(mapToResult(dataMap))
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEEvent
          if (data.type === config.eventType) {
            const items = config.getEventData(data)
            dataMap.set(data.chain, { chainId: data.chainId, items })
          }
        } catch {
          // Silently ignore parsing errors for individual SSE events
        }
      }

      eventSource.onerror = resolveAndClose
      eventSource.addEventListener("close", resolveAndClose)
    })
  }
}

/** Fetch all balances via SSE */
const fetchAllBalances = createSSEFetcher<Balance, ChainBalanceData>(
  {
    eventType: "balances",
    getEventData: (event) => (event as SSEBalanceEvent).balances,
  },
  (entries) =>
    Array.from(entries, ([chainName, { chainId, items }]) => ({
      chainName,
      chainId,
      balances: items,
    })),
)

/** Fetch all positions via SSE */
const fetchAllPositions = createSSEFetcher<ProtocolPosition, ChainPositionData>(
  {
    eventType: "positions",
    getEventData: (event) => (event as SSEPositionEvent).positions,
  },
  (entries) =>
    Array.from(entries, ([chainName, { chainId, items }]) => ({
      chainName,
      chainId,
      positions: items,
    })),
)

// ============================================
// SSE QUERY OPTIONS
// ============================================

export const minitySSEQueryOptions = {
  /** SSE endpoint for all balances */
  allBalances: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: [...minityQueryKeys.supportedChains(minityUrl).queryKey, address, "sse-balances"],
      queryFn: () => fetchAllBalances(address, minityUrl),
      staleTime: STALE_TIMES.MINUTE,
      retry: 2,
    }),

  /** SSE endpoint for all positions */
  allPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: [...minityQueryKeys.supportedChains(minityUrl).queryKey, address, "sse-positions"],
      queryFn: () => fetchAllPositions(address, minityUrl),
      staleTime: STALE_TIMES.MINUTE,
      retry: 2,
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
  if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue
  return a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
}

/** Group Minity balances by symbol across all chains into PortfolioAssetGroups */
export function groupBalancesBySymbol(
  minityBalances: ChainBalanceData[],
  chainInfoMap: Map<string, ChainInfo>,
): PortfolioAssetGroup[] {
  const groupMap = new Map<string, PortfolioAssetItem[]>()

  for (const { chainName, balances } of minityBalances) {
    const chainInfo = chainInfoMap.get(chainName.toLowerCase())
    const chainId = chainInfo?.chainId ?? chainName

    for (const balance of balances) {
      // Skip unknown types, LP tokens, and zero/negative values
      if (balance.type === "unknown" || balance.type === "lp" || (balance.value ?? 0) <= 0) continue

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
 * Fetches balance data for all supported chains via SSE.
 * Independent from positions - can render as soon as balances stream in.
 */
export function useMinityBalances(): ChainBalanceData[] {
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()

  if (!address) {
    throw new Error("useMinityBalances requires a connected wallet")
  }

  const { data } = useSuspenseQuery(minitySSEQueryOptions.allBalances(address, minityUrl))

  return data
}

/**
 * Fetches position data for all supported chains via SSE.
 * Independent from balances - can render as soon as positions stream in.
 */
export function useMinityPositions(): ChainPositionData[] {
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()

  if (!address) {
    throw new Error("useMinityPositions requires a connected wallet")
  }

  const { data } = useSuspenseQuery(minitySSEQueryOptions.allPositions(address, minityUrl))

  return data
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
 * Uses Suspense - loading states handled by React Suspense boundaries.
 */
export function useMinityChainBreakdown(): ChainBreakdownItem[] {
  const balances = useMinityBalances()
  const positions = useMinityPositions()
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
 * Independent from positions - can render as soon as balances arrive.
 * Uses Suspense - loading states handled by React Suspense boundaries.
 */
export function useLiquidAssetsBalance(): number {
  const balances = useMinityBalances()

  return useMemo(() => {
    let total = 0
    const safeBalances = Array.isArray(balances) ? balances : []
    for (const { balances: chainBalances } of safeBalances) {
      if (!Array.isArray(chainBalances)) continue // Skip if balances is not an array
      total += chainBalances.reduce((sum, b) => {
        if (b.type === "lp") return sum // Skip LP tokens, counted in L1 liquidity positions
        return sum + getBalanceValue(b)
      }, 0)
    }
    return total
  }, [balances])
}

/**
 * Computes appchain positions total from positions only.
 * Independent from balances - can render as soon as positions arrive.
 * Excludes Civitia which has no USD values.
 * Uses Suspense - loading states handled by React Suspense boundaries.
 */
export function useAppchainPositionsBalance(): number {
  const positions = useMinityPositions()

  return useMemo(() => {
    let total = 0
    const safePositions = Array.isArray(positions) ? positions : []
    for (const { chainName, positions: chainPositions } of safePositions) {
      const lowerChainName = chainName.toLowerCase()
      // Only count non-Initia chains (appchains), excluding Civitia (no USD values)
      if (lowerChainName !== "initia" && lowerChainName !== "civitia") {
        if (!Array.isArray(chainPositions)) continue // Skip if positions is not an array
        total += chainPositions.reduce((sum, p) => sum + getProtocolPositionValue(p), 0)
      }
    }
    return total
  }, [positions])
}
