import BigNumber from "bignumber.js"
import { formatNumber as formatNumberUtil } from "@initia/utils"
import { INIT_SYMBOL, IUSD_SYMBOL, STRAT_CHAIN_NAME } from "../constants"
import type { PortfolioAssetGroup, PortfolioAssetItem } from "../portfolio"
import type {
  Balance,
  ChainBalanceData,
  ChainInfo,
  DenomGroup,
  PerpPosition,
  Position,
  ProtocolPosition,
  SectionGroup,
} from "./types"

// ============================================
// MAP BUILDERS
// ============================================

interface AssetQueryResult {
  data?: Array<{ denom: string; symbol: string; logoUrl?: string }>
}

interface ChainWithId {
  chainId: string
}

/** Build chainId:denom -> logo and symbol -> logo maps from asset queries (fast, no balance dependency) */
export function buildAssetLogoMaps(
  assetQueries: AssetQueryResult[],
  chains: ChainWithId[],
): {
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
} {
  const denomMap = new Map<string, string>()
  const symbolMap = new Map<string, string>()

  for (let i = 0; i < assetQueries.length; i++) {
    const query = assetQueries[i]
    const chain = chains[i]
    const assets = query.data
    if (!chain || !assets) continue

    for (const asset of assets) {
      if (asset.logoUrl && !asset.logoUrl.includes("undefined")) {
        // Use chainId:denom as key (prevents cross-chain denom collision)
        const chainDenomKey = `${chain.chainId}:${asset.denom}`
        if (!denomMap.has(chainDenomKey)) {
          denomMap.set(chainDenomKey, asset.logoUrl)
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

/** Returns null when the API didn't supply PnL so callers can distinguish "unknown" from "exactly zero". */
export function getPerpPnl(position: PerpPosition): number | null {
  return position.pnl ?? null
}

/** Returns null when collateral can't be priced (unknown asset type or missing value). */
export function getPerpCollateralValue(position: PerpPosition): number | null {
  if (position.balance.type === "unknown") return null
  return position.balance.value ?? null
}

/** True when the perp position lacks a priced collateral basis — UI should surface an "Unpriced" affordance rather than rendering as $0. */
export function isPerpUnpriced(position: PerpPosition): boolean {
  return getPerpCollateralValue(position) == null
}

/** "+$2.12" / "-$7.24" / "$0.00" / "—" when null — sub-cent magnitudes round to 0 (no sign). */
export function formatPerpPnl(pnl: number | null): string {
  if (pnl == null || !Number.isFinite(pnl)) return "—"
  const rounded = BigNumber(pnl).decimalPlaces(2, BigNumber.ROUND_HALF_UP)
  if (rounded.isZero()) return "$0.00"
  const sign = rounded.gt(0) ? "+" : "-"
  return `${sign}$${formatNumberUtil(rounded.abs().toNumber(), { dp: 2 })}`
}

/** "(+0.04%)" / "(-0.68%)" / "(0.00%)" / "" when no basis — sub-cent magnitudes round to 0. */
export function formatPerpPnlPercent(pnl: number | null, collateralValue: number | null): string {
  if (
    pnl == null ||
    collateralValue == null ||
    !Number.isFinite(pnl) ||
    !Number.isFinite(collateralValue) ||
    collateralValue <= 0
  ) {
    return ""
  }
  const rounded = BigNumber(pnl)
    .div(collateralValue)
    .times(100)
    .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
  if (rounded.isZero()) return "(0.00%)"
  const sign = rounded.gt(0) ? "+" : "-"
  return `(${sign}${rounded.abs().toFixed(2)}%)`
}

/** Truncate fractional leverage so "7.99X" reads as "7". Returns "" for non-finite or sub-1 values so callers can drop the leverage label entirely. */
export function formatPerpLeverage(leverage: number): string {
  if (!Number.isFinite(leverage) || leverage < 1) return ""
  return BigNumber(leverage).decimalPlaces(0, BigNumber.ROUND_DOWN).toString()
}

/** Get value from a position based on its type */
export function getPositionValue(position: Position): number {
  if (position.type === "fungible-position") {
    return position.value ?? 0
  }

  // Perp equity = collateral + PnL; collateral lives in the protocol so no wallet double-count. Return 0 when collateral can't be priced rather than PnL alone — callers should pair this with isPerpUnpriced() to surface "Unpriced" affordances.
  if (position.type === "perp-position") {
    const collateralValue = getPerpCollateralValue(position)
    if (collateralValue == null) return 0
    const pnl = getPerpPnl(position)
    return BigNumber(collateralValue)
      .plus(pnl ?? 0)
      .toNumber()
  }

  if (position.balance.type === "unknown") return 0
  const value = position.balance.value ?? 0
  // Borrowing positions should subtract from total (debt/liability)
  if (position.type === "lending" && position.direction === "borrow") {
    return -value
  }
  return value
}

/** Get section key for position - groups staking types, perp, and separates lending by direction */
export function getSectionKey(position: Position): string | null {
  switch (position.type) {
    case "fungible-position":
      return null
    case "perp-position":
      return "perp"
    case "staking":
    case "unstaking":
    case "lockstaking":
      return "staking"
    case "lending":
      return position.direction === "supply" ? "lending" : "borrowing"
    default: {
      // Compile-time exhaustiveness — adding a new Position variant must surface here.
      const _exhaustive: never = position
      return _exhaustive
    }
  }
}

interface SectionLabelContext {
  isInitia?: boolean
  chainName?: string
}

/** Get display label for section key */
export function getSectionLabel(sectionKey: string, context: SectionLabelContext = {}): string {
  const { isInitia = false, chainName } = context
  const isStratChain = chainName?.toLowerCase() === STRAT_CHAIN_NAME

  switch (sectionKey) {
    case "staking":
      // Strat reuses the generic `staking` type for vault deposits — relabel so it isn't read as validator staking.
      if (isStratChain) return "Vault"
      return isInitia ? "INIT staking" : "Staking"
    case "perp":
      return "Perpetuals"
    case "borrowing":
      return "Borrowing"
    case "lending":
      return "Lending"
    default:
      return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1)
  }
}

/** Group positions by section (staking, perp, borrowing, lending) - sorted by total value descending */
export function groupPositionsBySection(positions: Position[]): Map<string, SectionGroup> {
  // 1. Group by section key
  const groups = new Map<string, Position[]>()
  for (const pos of positions) {
    const sectionKey = getSectionKey(pos)
    if (!sectionKey) continue
    const existing = groups.get(sectionKey) ?? []
    existing.push(pos)
    groups.set(sectionKey, existing)
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
  const sortedKeys = [...groups.keys()].sort((a, b) => {
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
  if (position.type === "perp-position") {
    return position.pair
  }
  return position.balance.denom
}

/** Get symbol for display */
export function getPositionSymbol(position: Position): string {
  if (position.type === "fungible-position") {
    return position.title
  }
  if (position.type === "perp-position") {
    return position.pair
  }
  if (position.balance.type === "unknown") {
    return position.balance.denom
  }
  return position.balance.symbol
}

/** Get balance from position (returns null for fungible/perp positions) */
export function getPositionBalance(position: Position): Balance | null {
  if (position.type === "fungible-position") {
    return null
  }
  if (position.type === "perp-position") {
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
    case "perp-position":
      return "Perpetuals"
    default:
      return ""
  }
}

/** Group positions by their type */
export function groupPositionsByType(positions: Position[]): Map<Position["type"], Position[]> {
  const groups = new Map<Position["type"], Position[]>()
  for (const pos of positions) {
    const existing = groups.get(pos.type) ?? []
    existing.push(pos)
    groups.set(pos.type, existing)
  }
  return groups
}

/** Pinned symbols in display order; lower rank sorts first. */
const PINNED_SYMBOLS = [INIT_SYMBOL, IUSD_SYMBOL]

/** Returns the pinned rank for a symbol, or Infinity if it isn't pinned. */
function getPinnedRank(symbol: string): number {
  const index = PINNED_SYMBOLS.indexOf(symbol)
  return index === -1 ? Infinity : index
}

/** Sort comparator for denom groups: INIT then iUSD first, then by value desc, then alphabetically */
function compareDenomGroups(a: DenomGroup, b: DenomGroup): number {
  const rankA = getPinnedRank(a.symbol)
  const rankB = getPinnedRank(b.symbol)
  if (rankA !== rankB) return rankA - rankB
  if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue
  return a.symbol.localeCompare(b.symbol, undefined, { sensitivity: "base" })
}

/** Group positions by denom */
export function groupPositionsByDenom(positions: Position[]): DenomGroup[] {
  const groups = new Map<string, Position[]>()

  for (const pos of positions) {
    const denom = getPositionDenom(pos)
    const existing = groups.get(denom) ?? []
    existing.push(pos)
    groups.set(denom, existing)
  }

  const denomGroups = Array.from(groups.entries()).map(([denom, positions]) => {
    const balance = getPositionBalance(positions[0])
    let totalAmount = 0

    for (const pos of positions) {
      if (pos.type === "fungible-position" || pos.type === "perp-position") continue
      if (pos.balance.type === "unknown") continue
      totalAmount += pos.balance.formattedAmount
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

  return denomGroups.sort(compareDenomGroups)
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

/** Sort comparator for asset groups: INIT then iUSD first, then by value desc, then alphabetically */
export function compareAssetGroups(a: PortfolioAssetGroup, b: PortfolioAssetGroup): number {
  const rankA = getPinnedRank(a.symbol)
  const rankB = getPinnedRank(b.symbol)
  if (rankA !== rankB) return rankA - rankB
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
    const sortedAssets = [...assets].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
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

  return groups.sort(compareAssetGroups)
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
      // Try chainId:denom key first (for chain-specific logos), then fall back to denom-only and symbol
      const chainDenomKey = `${asset.chain.chainId}:${asset.denom}`
      const logoUrl = denomLogos.get(chainDenomKey) ?? symbolLogos.get(upperSymbol) ?? ""
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

  // Filter by selected chain and recompute group totals
  const chainFilteredAssets = !selectedChainId
    ? searchFilteredAssets
    : searchFilteredAssets
        .map((assetGroup) => {
          const filteredAssets = assetGroup.assets.filter(
            ({ chain }) => chain.chainId === selectedChainId,
          )
          return {
            ...assetGroup,
            assets: filteredAssets,
            totalValue: filteredAssets.reduce((sum, a) => sum + (a.value ?? 0), 0),
            totalAmount: filteredAssets.reduce((sum, a) => sum + Number(a.quantity), 0),
          }
        })
        .filter((assetGroup) => assetGroup.assets.length > 0)

  // Calculate total value from individual assets
  const totalAssetsValue = chainFilteredAssets.reduce(
    (total, group) => total + group.assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0),
    0,
  )

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
    try {
      const aAmount = BigInt(a.amount)
      const bAmount = BigInt(b.amount)
      if (aAmount > bAmount) return -1
      if (aAmount < bAmount) return 1
    } catch {
      // Fallback to string comparison if amounts are not valid integers
      const amountCompare = a.amount.localeCompare(b.amount)
      if (amountCompare !== 0) return -amountCompare
    }

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
