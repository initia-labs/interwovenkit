import { descend, prop, sortWith } from "ramda"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAllChainPriceQueries, useInitiaRegistry } from "../chains"
import { useConfig } from "../config"
import { STALE_TIMES } from "../http"
import { minityQueryKeys, minityQueryOptions } from "./query-keys"
import type {
  Balance,
  ChainBreakdownItem,
  ChainInfo,
  Position,
  ProtocolPosition,
  SSEPortfolioData,
} from "./types"
import { applyFallbackPricing, buildPriceMap } from "./utilities"

// ============================================
// DEFAULT DATA
// ============================================

const DEFAULT_SSE_DATA: SSEPortfolioData = {
  balances: [],
  positions: [],
  isLoading: true,
  isComplete: false,
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
    for (const registryItem of registry) {
      const chainKey = registryItem.chain_name.toLowerCase()
      chainInfoMap.set(chainKey, {
        chainId: registryItem.chainId,
        chainName: registryItem.chain_name,
        prettyName: registryItem.name || registryItem.chain_name,
        logoUrl: registryItem.logoUrl || "",
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
    for (const registryItem of registry) {
      map.set(registryItem.chain_name.toLowerCase(), registryItem)
    }
    return map
  }, [registry])

  const data = useMemo(() => {
    // Helper function to get balance value
    const getBalanceValue = (balance: Balance): number => {
      if (balance.type === "unknown") return 0
      return balance.value ?? 0
    }

    // Helper function to get protocol position value
    const getProtocolPositionValue = (position: ProtocolPosition): number => {
      return position.positions.reduce((sum: number, currentPosition: Position) => {
        if (currentPosition.type === "fungible-position") {
          return sum + (currentPosition.value ?? 0)
        }
        if (currentPosition.balance.type === "unknown") return sum
        const value = currentPosition.balance.value ?? 0
        // Borrowing positions should subtract from total (debt/liability)
        if (currentPosition.type === "lending" && currentPosition.direction === "borrow") {
          return sum - value
        }
        return sum + value
      }, 0)
    }

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

    const filtered = Array.from(chainTotals.entries())
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

    const isInitia = (item: ChainBreakdownItem) => item.chainName.toLowerCase() === "initia"
    return sortWith([descend(isInitia), descend(prop("totalBalance"))], filtered)
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
    // Helper to get balance value
    const getBalanceValue = (balance: Balance): number => {
      if (balance.type === "unknown") return 0
      return balance.value ?? 0
    }

    let total = 0
    const safeBalances = Array.isArray(balances) ? balances : []

    // Apply fallback pricing first (same as Assets display)
    const balancesWithPricing = applyFallbackPricing(safeBalances, chainPrices)

    for (const { balances: chainBalances } of balancesWithPricing) {
      if (!Array.isArray(chainBalances)) continue // Skip if balances is not an array
      for (const balance of chainBalances) {
        if (balance.type === "lp") {
          continue // Skip LP tokens, counted in L1 liquidity positions
        }
        total += getBalanceValue(balance)
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
    // Helper to get protocol position value
    const getProtocolPositionValue = (position: ProtocolPosition): number => {
      return position.positions.reduce((sum: number, pos: Position) => {
        if (pos.type === "fungible-position") {
          return sum + (pos.value ?? 0)
        }
        if (pos.balance.type === "unknown") return sum
        const value = pos.balance.value ?? 0
        // Borrowing positions should subtract from total (debt/liability)
        if (pos.type === "lending" && pos.direction === "borrow") {
          return sum - value
        }
        return sum + value
      }, 0)
    }

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
