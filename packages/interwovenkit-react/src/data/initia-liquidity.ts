import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { denomToMetadata, fromBaseUnit } from "@initia/utils"
import { useInitiaAddress } from "@/public/data/hooks"
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
  balances: (restUrl: string, address: string) => [restUrl, address],
  checkLpTokens: (dexUrl: string, denoms: string[]) => [dexUrl, denoms.join(",")],
  lpPrices: (dexUrl: string, denoms: string[]) => [dexUrl, denoms.join(",")],
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

interface BalancesResponse {
  balances: Coin[]
  pagination?: {
    next_key: string | null
    total: string
  }
}

interface CheckLpTokensResponse {
  data: Record<string, boolean>
}

interface LpPricesResponse {
  prices: Record<string, number> | Array<{ denom: string; price: number }>
}

interface Pool {
  lp: string
  lp_metadata: string
  pool_type: PoolType
  symbol?: string
  coins: Array<{ denom: string; weight?: string }>
}

interface PoolResponse {
  pool: Pool
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function normalizeLps(coins: Coin[]): Map<string, CoinWithMetadata[]> {
  const result = new Map<string, CoinWithMetadata[]>()

  for (const coin of coins) {
    const metadata = denomToMetadata(coin.denom)
    const coinWithMetadata: CoinWithMetadata = { ...coin, metadata }

    if (!result.has(metadata)) {
      result.set(metadata, [])
    }
    result.get(metadata)!.push(coinWithMetadata)
  }

  return result
}

// ============================================
// HOOKS
// ============================================

/** Fetch all wallet balances */
export function useWalletBalances() {
  const { restUrl } = useLayer1()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: initiaLiquidityQueryKeys.balances(restUrl, address).queryKey,
    queryFn: async () => {
      const response = await ky
        .get(`${restUrl}/cosmos/bank/v1beta1/balances/${address}`)
        .json<BalancesResponse>()
      return response.balances
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Check which denoms are LP tokens */
export function useCheckLpTokens(denoms: string[]) {
  const { dexUrl } = useConfig()

  return useSuspenseQuery({
    queryKey: initiaLiquidityQueryKeys.checkLpTokens(dexUrl ?? "", denoms).queryKey,
    queryFn: async () => {
      if (!dexUrl) throw new Error("dexUrl is not configured")
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
  const { data: balances } = useWalletBalances()
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
    queryKey: initiaLiquidityQueryKeys.lpPrices(dexUrl ?? "", denoms).queryKey,
    queryFn: async () => {
      if (!dexUrl) throw new Error("dexUrl is not configured")
      if (denoms.length === 0) return new Map<string, number>()
      const denomParam = denoms.join(",")
      const response = await ky
        .get(`${dexUrl}/indexer/price/v1/lp_prices/${encodeURIComponent(denomParam)}`)
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

/** Fetch pool info for multiple LP tokens (same pattern as app-v2) */
export function useLiquidityPoolList(denoms: string[]) {
  const { dexUrl } = useConfig()

  // Fetch L1 assets internally for symbol resolution (same as app-v2)
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
      queryKey: initiaLiquidityQueryKeys.pool(dexUrl ?? "", denom).queryKey,
      queryFn: async () => {
        if (!dexUrl) throw new Error("dexUrl is not configured")
        try {
          const metadata = denomToMetadata(denom)
          const response = await ky
            .get(`${dexUrl}/indexer/dex/v2/pools/${encodeURIComponent(metadata)}`)
            .json<PoolResponse>()
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
    const map = new Map<string, Pool | null>()
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
// MAIN AGGREGATOR HOOK
// ============================================

/**
 * Combined hook that fetches all Initia L1 liquidity positions
 * and transforms them to LiquiditySectionData format for portfolio display
 */
export function useInitiaLiquidityPositions(): LiquiditySectionData {
  // Get layer1 assets for symbol and logo lookup
  const layer1 = useLayer1()
  const assets = useAssets(layer1)

  // Fetch data from all sources
  const lps = useLps() // Wallet LP tokens (deposit)
  const { data: delegations } = useInitiaDelegations() // Staked tokens
  const { data: lockStaking } = useInitiaLockStaking() // Lock-staked tokens
  const { data: undelegations } = useInitiaUndelegations() // Unbonding tokens
  const { data: stakingRewards } = useInitiaStakingRewards() // Staking rewards
  const { data: lockStakingRewards } = useInitiaLockStakingRewards() // Lock staking rewards

  // Fetch INIT price for claimable rewards value calculation
  const { data: initPrices } = usePricesQuery(layer1)

  // Build asset lookup map for O(1) access (moved up to reduce useMemo count)
  const assetByDenom = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>()
    for (const asset of assets) {
      map.set(asset.denom, asset)
    }
    return map
  }, [assets])

  // Collect all unique metadata keys (excluding INIT)
  const allMetadataKeys = useMemo(() => {
    const keys = new Set<string>()

    // From wallet LP tokens
    for (const metadata of lps.keys()) {
      keys.add(metadata)
    }

    // From delegations (filter out INIT)
    for (const [metadata, stakingList] of delegations) {
      const denom = stakingList[0]?.denom
      if (denom && denom !== INIT_DENOM) {
        keys.add(metadata)
      }
    }

    // From lock staking (INIT filtering happens later in lpDenomList)
    for (const metadata of lockStaking.keys()) {
      keys.add(metadata)
    }

    // From undelegations (filter out INIT)
    for (const [metadata, unstakingList] of undelegations) {
      const denom = unstakingList[0]?.denom
      if (denom && denom !== INIT_DENOM) {
        keys.add(metadata)
      }
    }

    return Array.from(keys)
  }, [lps, delegations, lockStaking, undelegations])

  // Resolve metadata -> denom
  const denomsMap = useDenoms(allMetadataKeys)

  // Get list of LP denoms (excluding INIT)
  const lpDenomList = useMemo(() => {
    const denoms: string[] = []
    for (const [, denom] of denomsMap) {
      if (denom && denom !== INIT_DENOM) {
        denoms.push(denom)
      }
    }
    return denoms
  }, [denomsMap])

  // Fetch LP prices
  const { data: prices } = useLpPrices(lpDenomList)

  // Fetch pool info (fetches assets internally for symbol resolution, same as app-v2)
  const pools = useLiquidityPoolList(lpDenomList)

  // Aggregate into rows and calculate total value in a single pass
  const { rows, totalValue } = useMemo(() => {
    // Compute INIT price inline to reduce useMemo count
    const initPrice = initPrices?.find((p) => p.id === INIT_DENOM)?.price ?? 0

    const rowMap = new Map<string, LiquidityTableRow>()

    // Helper to get coin logos from pool coins
    const getCoinLogos = (pool: Pool | null): string[] => {
      if (!pool?.coins || pool.coins.length === 0) return []
      return pool.coins.map((coin) => {
        const asset = assetByDenom.get(coin.denom)
        return asset?.logoUrl || ""
      })
    }

    // Helper to get or create row
    const getRow = (denom: string): LiquidityTableRow => {
      if (!rowMap.has(denom)) {
        const pool = pools.get(denom) ?? null
        // Symbol is already set in useLiquidityPoolList (includes omniINIT special case)
        const symbol = pool?.symbol || denom
        const coinLogos = getCoinLogos(pool)
        const hasCoinLogos = coinLogos.length > 0 && coinLogos.some((logo) => logo)

        // For LP tokens without coins (like omniINIT), use the LP token's own logo
        const logoUrl = hasCoinLogos ? undefined : assetByDenom.get(denom)?.logoUrl

        rowMap.set(denom, {
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
        })
      }
      return rowMap.get(denom)!
    }

    // Helper to add amount to row
    const addAmount = (
      denom: string,
      amountStr: string,
      type: keyof LiquidityTableRow["breakdown"],
    ) => {
      const row = getRow(denom)
      const decimals = row.decimals
      const formattedAmount = Number(fromBaseUnit(amountStr, { decimals }))
      const price = prices.get(denom) ?? 0
      const value = formattedAmount * price

      row.breakdown[type] += formattedAmount
      row.totalAmount += formattedAmount
      row.totalValue += value
    }

    // Process wallet LP tokens (deposit)
    for (const [metadata, lpList] of lps) {
      const denom = denomsMap.get(metadata)
      if (!denom || denom === INIT_DENOM) continue
      for (const lp of lpList) {
        addAmount(denom, String(lp.amount), "deposit")
      }
    }

    // Process staked LP tokens (staking)
    for (const [metadata, stakingList] of delegations) {
      const denom = denomsMap.get(metadata) ?? stakingList[0]?.denom
      if (!denom || denom === INIT_DENOM) continue
      for (const staking of stakingList) {
        addAmount(denom, String(staking.amount), "staking")
      }
    }

    // Process lock-staked LP tokens (lockStaking)
    for (const [metadata, lockList] of lockStaking) {
      const denom = denomsMap.get(metadata)
      if (!denom || denom === INIT_DENOM) continue
      for (const lock of lockList) {
        addAmount(denom, String(lock.amount), "lockStaking")
      }
    }

    // Process unbonding LP tokens (unstaking)
    for (const [metadata, unstakingList] of undelegations) {
      const denom = denomsMap.get(metadata) ?? unstakingList[0]?.denom
      if (!denom || denom === INIT_DENOM) continue
      for (const unstaking of unstakingList) {
        addAmount(denom, String(unstaking.amount), "unstaking")
      }
    }

    // Add claimable INIT rewards to each row
    for (const [denom, row] of rowMap) {
      const metadata = denomToMetadata(denom)

      // Get staking rewards for this LP token (rewards are paid in INIT)
      const stakingReward = stakingRewards?.get(metadata)
      const stakingAmount = stakingReward
        ? fromBaseUnit(stakingReward.amount, { decimals: INIT_DECIMALS })
        : "0"

      // Get lock staking rewards for this LP token (rewards are paid in INIT)
      const lockReward = lockStakingRewards?.get(metadata)
      const lockAmount = lockReward
        ? fromBaseUnit(lockReward.amount, { decimals: INIT_DECIMALS })
        : "0"

      // Calculate total
      const totalAmount = Number(stakingAmount) + Number(lockAmount)

      // Only add claimableInit if there are rewards
      if (totalAmount > 0) {
        row.claimableInit = {
          staking: stakingAmount,
          lockStaking: lockAmount,
          total: String(totalAmount),
          totalValue: totalAmount * initPrice,
        }
      }
    }

    // Convert to array and sort by value desc
    const sortedRows = Array.from(rowMap.values())
      .filter((row) => row.totalAmount > 0)
      .toSorted((a, b) => b.totalValue - a.totalValue)

    // Calculate total value in same pass
    const totalVal = sortedRows.reduce((sum, row) => sum + row.totalValue, 0)

    return { rows: sortedRows, totalValue: totalVal }
  }, [
    lps,
    delegations,
    lockStaking,
    undelegations,
    denomsMap,
    prices,
    pools,
    assetByDenom,
    stakingRewards,
    lockStakingRewards,
    initPrices,
  ])

  return {
    totalValue,
    rows,
  }
}
