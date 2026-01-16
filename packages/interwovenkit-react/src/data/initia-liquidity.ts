import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { denomToMetadata, fromBaseUnit } from "@initia/utils"
import { useBalances } from "./account"
import { useAssets, useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import { useConfig } from "./config"
import { INIT_DECIMALS, INIT_DENOM, OMNI_INIT_DENOM, OMNI_INIT_SYMBOL } from "./constants"
import { STALE_TIMES } from "./http"
import {
  useInitiaDelegations,
  useInitiaLockStaking,
  useInitiaLockStakingRewards,
  useInitiaStakingRewards,
  useInitiaUndelegations,
} from "./initia-staking"
import type { LiquiditySectionData, LiquidityTableRow, PoolType } from "./minity"

// ============================================
// QUERY KEYS
// ============================================

export const initiaLiquidityQueryKeys = createQueryKeys("interwovenkit:initia-liquidity", {
  checkLpTokens: (dexUrl: string, denoms: string[]) => [dexUrl, denoms],
  lpPrices: (dexUrl: string, denoms: string[]) => [dexUrl, denoms],
  pool: (dexUrl: string, metadata: string) => [dexUrl, metadata],
})

// ============================================
// TYPES
// ============================================

interface Coin {
  denom: string
  amount: string
}

interface CoinWithMetadata extends Coin {
  metadata: string
}

interface CheckLpTokensResponse {
  data: Record<string, boolean>
}

interface LpPricesResponse {
  prices: Record<string, number> | Array<{ denom: string; price: number }>
}

interface PoolResponse {
  lp: string
  lp_metadata: string
  pool_type: PoolType
  symbol?: string
  coins: Array<{ denom: string; weight?: string }>
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function normalizeLps(coins: Coin[]): Map<string, CoinWithMetadata[]> {
  const result = new Map<string, CoinWithMetadata[]>()

  for (const coin of coins) {
    const metadata = denomToMetadata(coin.denom)
    const coinWithMetadata: CoinWithMetadata = { ...coin, metadata }

    const existing = result.get(metadata) ?? []
    existing.push(coinWithMetadata)
    result.set(metadata, existing)
  }

  return result
}

// ============================================
// HOOKS
// ============================================

/** Check which denoms are LP tokens */
export function useCheckLpTokens(denoms: string[]) {
  const { dexUrl } = useConfig()

  return useSuspenseQuery({
    queryKey: initiaLiquidityQueryKeys.checkLpTokens(dexUrl, denoms).queryKey,
    queryFn: async () => {
      if (denoms.length === 0) return new Map<string, boolean>()
      const response = await ky
        .post(`${dexUrl}/indexer/dex/v1/check_lp_tokens`, { json: { denoms } })
        .json<CheckLpTokensResponse>()
      return new Map(Object.entries(response.data))
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Get LP tokens from wallet (deposit state) */
export function useLps() {
  const layer1 = useLayer1()
  const balances = useBalances(layer1)
  const denoms = useMemo(() => balances.map((b) => b.denom), [balances])
  const { data: lpCheck } = useCheckLpTokens(denoms)

  return useMemo(() => {
    const lpCoins = balances.filter((coin) => lpCheck.get(coin.denom) === true)
    return normalizeLps(lpCoins)
  }, [balances, lpCheck])
}

/** Fetch LP token prices */
export function useLpPrices(denoms: string[]) {
  const { dexUrl } = useConfig()

  return useSuspenseQuery({
    queryKey: initiaLiquidityQueryKeys.lpPrices(dexUrl, denoms).queryKey,
    queryFn: async () => {
      if (denoms.length === 0) {
        return new Map<string, number>()
      }

      const response = await ky
        .get(`${dexUrl}/indexer/price/v1/lp_prices/${encodeURIComponent(denoms.join(","))}`)
        .json<LpPricesResponse>()

      const { prices } = response
      if (Array.isArray(prices)) {
        return new Map(prices.map(({ denom, price }) => [denom, price]))
      }
      return new Map(Object.entries(prices))
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Fetch pool info for multiple LP tokens */
export function useLiquidityPoolList(denoms: string[]) {
  const { dexUrl } = useConfig()

  // Fetch L1 assets internally for symbol resolution
  const layer1 = useLayer1()
  const assets = useAssets(layer1)

  // Build asset lookup map for O(1) access
  const assetByDenom = useMemo(() => {
    const map = new Map<string, { symbol?: string }>()
    for (const asset of assets) {
      map.set(asset.denom, asset)
    }
    return map
  }, [assets])

  const queries = useSuspenseQueries({
    queries: denoms.map((denom) => ({
      queryKey: initiaLiquidityQueryKeys.pool(dexUrl, denom).queryKey,
      queryFn: async () => {
        try {
          const metadata = denomToMetadata(denom)
          const response = await ky
            .get(`${dexUrl}/indexer/dex/v2/pools/${encodeURIComponent(metadata)}`)
            .json<{ pool: PoolResponse }>()
          return response.pool
        } catch {
          // Pool info may not be available for all LP tokens
          return null
        }
      },
      staleTime: STALE_TIMES.MINUTE,
    })),
  })

  // Extract data from each query result for stable dependency
  const queryData = queries.map((q) => q.data)

  return useMemo(() => {
    const map = new Map<string, PoolResponse | null>()
    denoms.forEach((denom, i) => {
      const pool = queryData[i]
      if (!pool) {
        map.set(denom, null)
        return
      }

      // Special case for omniINIT (Minitswap LP token)
      if (denom === OMNI_INIT_DENOM) {
        map.set(denom, { ...pool, symbol: OMNI_INIT_SYMBOL })
        return
      }

      // Generate symbol from pool coins (same as app-v2)
      const symbol = pool.coins
        .map((coin) => {
          const asset = assetByDenom.get(coin.denom)
          return asset?.symbol || coin.denom
        })
        .join("-")

      map.set(denom, { ...pool, symbol })
    })
    return map
  }, [denoms, queryData, assetByDenom])
}

// ============================================
// HELPER FUNCTIONS FOR AGGREGATION
// ============================================

function collectMetadataKeys(
  lps: Map<string, CoinWithMetadata[]>,
  delegations: Map<string, Coin[]>,
  lockStaking: Map<string, { amount: string }[]>,
  undelegations: Map<string, Coin[]>,
): string[] {
  const keys = new Set<string>()

  for (const metadata of lps.keys()) {
    keys.add(metadata)
  }

  for (const [metadata, stakingList] of delegations) {
    const denom = stakingList[0]?.denom
    if (denom && denom !== INIT_DENOM) {
      keys.add(metadata)
    }
  }

  for (const metadata of lockStaking.keys()) {
    keys.add(metadata)
  }

  for (const [metadata, unstakingList] of undelegations) {
    const denom = unstakingList[0]?.denom
    if (denom && denom !== INIT_DENOM) {
      keys.add(metadata)
    }
  }

  return Array.from(keys)
}

function getLpDenomList(denomsMap: Map<string, string>): string[] {
  const denoms: string[] = []
  for (const [, denom] of denomsMap) {
    if (denom && denom !== INIT_DENOM) {
      denoms.push(denom)
    }
  }
  return denoms
}

function getCoinLogos(
  pool: PoolResponse | null,
  assetByDenom: Map<string, { logoUrl?: string }>,
): string[] {
  if (!pool?.coins || pool.coins.length === 0) return []
  return pool.coins.map((coin) => {
    const asset = assetByDenom.get(coin.denom)
    return asset?.logoUrl || ""
  })
}

function createRow(
  denom: string,
  pools: Map<string, PoolResponse | null>,
  assetByDenom: Map<string, { decimals?: number; logoUrl?: string }>,
): LiquidityTableRow {
  const pool = pools.get(denom) ?? null
  const symbol = pool?.symbol || denom
  const coinLogos = getCoinLogos(pool, assetByDenom)
  const hasCoinLogos = coinLogos.length > 0 && coinLogos.some((logo) => logo)
  const logoUrl = hasCoinLogos ? undefined : assetByDenom.get(denom)?.logoUrl

  return {
    denom,
    symbol,
    totalAmount: 0,
    totalValue: 0,
    decimals: assetByDenom.get(denom)?.decimals ?? 6,
    poolType: pool?.pool_type,
    logoUrl,
    coinLogos: hasCoinLogos ? coinLogos : undefined,
    breakdown: {
      deposit: 0,
      staking: 0,
      lockStaking: 0,
      unstaking: 0,
    },
  }
}

function processPositionsWithDenom(
  positions: Map<string, Coin[]>,
  denomsMap: Map<string, string>,
  prices: Map<string, number>,
  rowMap: Map<string, LiquidityTableRow>,
  type: keyof LiquidityTableRow["breakdown"],
) {
  for (const [metadata, positionList] of positions) {
    const denom = denomsMap.get(metadata) ?? positionList[0]?.denom
    if (!denom || denom === INIT_DENOM) continue

    const row = rowMap.get(denom)
    if (!row) continue

    for (const position of positionList) {
      const amountStr = String(position.amount)
      const decimals = row.decimals
      const formattedAmount = Number(fromBaseUnit(amountStr, { decimals }))
      const price = prices.get(denom) ?? 0
      const value = formattedAmount * price

      row.breakdown[type] += formattedAmount
      row.totalAmount += formattedAmount
      row.totalValue += value
    }
  }
}

function processPositionsWithMetadata(
  positions: Map<string, Array<{ amount: string }>>,
  denomsMap: Map<string, string>,
  prices: Map<string, number>,
  rowMap: Map<string, LiquidityTableRow>,
  type: keyof LiquidityTableRow["breakdown"],
) {
  for (const [metadata, positionList] of positions) {
    const denom = denomsMap.get(metadata)
    if (!denom || denom === INIT_DENOM) continue

    const row = rowMap.get(denom)
    if (!row) continue

    for (const position of positionList) {
      const amountStr = String(position.amount)
      const decimals = row.decimals
      const formattedAmount = Number(fromBaseUnit(amountStr, { decimals }))
      const price = prices.get(denom) ?? 0
      const value = formattedAmount * price

      row.breakdown[type] += formattedAmount
      row.totalAmount += formattedAmount
      row.totalValue += value
    }
  }
}

function addClaimableRewards(
  rowMap: Map<string, LiquidityTableRow>,
  stakingRewards: Map<string, { denom: string; amount: string }> | undefined,
  lockStakingRewards: Map<string, { denom: string; amount: string }> | undefined,
  initPrice: number,
) {
  for (const [denom, row] of rowMap) {
    const metadata = denomToMetadata(denom)

    const stakingReward = stakingRewards?.get(metadata)
    const stakingAmount = stakingReward
      ? fromBaseUnit(stakingReward.amount, { decimals: INIT_DECIMALS })
      : "0"

    const lockReward = lockStakingRewards?.get(metadata)
    const lockAmount = lockReward
      ? fromBaseUnit(lockReward.amount, { decimals: INIT_DECIMALS })
      : "0"

    const totalAmount = Number(stakingAmount) + Number(lockAmount)

    if (totalAmount > 0) {
      row.claimableInit = {
        staking: stakingAmount,
        lockStaking: lockAmount,
        total: String(totalAmount),
        totalValue: totalAmount * initPrice,
      }
    }
  }
}

// ============================================
// MAIN AGGREGATOR HOOK
// ============================================

/**
 * Combined hook that fetches all Initia L1 liquidity positions
 * and transforms them to LiquiditySectionData format for portfolio display
 */
export function useInitiaLiquidityPositions(): LiquiditySectionData {
  const layer1 = useLayer1()
  const assets = useAssets(layer1)

  const lps = useLps()
  const { data: delegations } = useInitiaDelegations()
  const { data: lockStaking } = useInitiaLockStaking()
  const { data: undelegations } = useInitiaUndelegations()
  const { data: stakingRewards } = useInitiaStakingRewards()
  const { data: lockStakingRewards } = useInitiaLockStakingRewards()
  const { data: initPrices } = usePricesQuery(layer1)

  const assetByDenom = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>()
    for (const asset of assets) {
      map.set(asset.denom, asset)
    }
    return map
  }, [assets])

  const allMetadataKeys = useMemo(
    () => collectMetadataKeys(lps, delegations, lockStaking, undelegations),
    [lps, delegations, lockStaking, undelegations],
  )

  const denomsMap = useDenoms(allMetadataKeys)
  const lpDenomList = useMemo(() => getLpDenomList(denomsMap), [denomsMap])
  const { data: prices } = useLpPrices(lpDenomList)
  const pools = useLiquidityPoolList(lpDenomList)

  const { rows, totalValue } = useMemo(() => {
    const initPrice = initPrices?.find((p) => p.id === INIT_DENOM)?.price ?? 0
    const rowMap = new Map<string, LiquidityTableRow>()

    // Create rows for all LP denoms
    for (const denom of lpDenomList) {
      rowMap.set(denom, createRow(denom, pools, assetByDenom))
    }

    // Process all position types
    processPositionsWithDenom(lps, denomsMap, prices, rowMap, "deposit")
    processPositionsWithDenom(delegations, denomsMap, prices, rowMap, "staking")
    processPositionsWithMetadata(lockStaking, denomsMap, prices, rowMap, "lockStaking")
    processPositionsWithDenom(undelegations, denomsMap, prices, rowMap, "unstaking")

    // Add claimable rewards
    addClaimableRewards(rowMap, stakingRewards, lockStakingRewards, initPrice)

    // Convert to array, filter, and sort
    const sortedRows = Array.from(rowMap.values())
      .filter((row) => row.totalAmount > 0)
      .sort((a, b) => b.totalValue - a.totalValue)

    const totalVal = sortedRows.reduce((sum, row) => sum + row.totalValue, 0)

    return { rows: sortedRows, totalValue: totalVal }
  }, [
    lpDenomList,
    pools,
    assetByDenom,
    lps,
    delegations,
    lockStaking,
    undelegations,
    denomsMap,
    prices,
    stakingRewards,
    lockStakingRewards,
    initPrices,
  ])

  return {
    totalValue,
    rows,
  }
}
