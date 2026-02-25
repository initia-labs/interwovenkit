import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { denomToMetadata, fromBaseUnit } from "@initia/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import { useBalances } from "./account"
import { useAssets, useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import {
  calculateAsset,
  calculateTokens,
  getTickAtSqrtRatio,
  i64FromBits,
  isFullRange,
} from "./clamm"
import { useConfig } from "./config"
import { INIT_DECIMALS, INIT_DENOM } from "./constants"
import { STALE_TIMES } from "./http"
import {
  createClammRowKey,
  getClammIncentiveKey,
  useClammDexPoolFeesList,
  useClammDexPoolIncentiveList,
  useClammDexPoolInfoList,
  useClammDexPoolPositions,
} from "./initia-liquidity.clamm"
import {
  getCoinLogos,
  useLiquidityPoolByMetadataList,
  useLiquidityPoolList,
} from "./initia-liquidity.pools"
import { initiaLiquidityQueryKeys } from "./initia-liquidity.query-keys"
import type {
  CheckLpTokensResponse,
  ClammIncentiveQuery,
  Coin,
  CoinWithMetadata,
  LpPricesResponse,
  PoolResponse,
} from "./initia-liquidity.types"
import {
  useInitiaDelegations,
  useInitiaLockStaking,
  useInitiaLockStakingRewards,
  useInitiaStakingRewards,
  useInitiaUndelegations,
} from "./initia-staking"
import type { LiquiditySectionData, LiquidityTableRow } from "./minity"

export { flattenClammPositions } from "./initia-liquidity.clamm"
export { useLiquidityPoolByMetadataList, useLiquidityPoolList } from "./initia-liquidity.pools"
export { initiaLiquidityQueryKeys } from "./initia-liquidity.query-keys"

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

function getMetadataPriceLabel(
  denoms: string[],
  assetByDenom: Map<string, { symbol?: string }>,
): string {
  return denoms
    .map((denom) => {
      const asset = assetByDenom.get(denom)
      return asset?.symbol || denom
    })
    .join("/")
}

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
): void {
  for (const [metadata, positionList] of positions) {
    const denom = denomsMap.get(metadata) ?? positionList[0]?.denom
    if (!denom || denom === INIT_DENOM) continue

    const row = rowMap.get(denom)
    if (!row) continue

    for (const position of positionList) {
      const decimals = row.decimals
      const formattedAmount = Number(fromBaseUnit(String(position.amount), { decimals }))
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
): void {
  for (const [metadata, positionList] of positions) {
    const denom = denomsMap.get(metadata)
    if (!denom || denom === INIT_DENOM) continue

    const row = rowMap.get(denom)
    if (!row) continue

    for (const position of positionList) {
      const decimals = row.decimals
      const formattedAmount = Number(fromBaseUnit(String(position.amount), { decimals }))
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
): void {
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

    if (totalAmount <= 0) continue

    row.claimableInit = {
      staking: stakingAmount,
      lockStaking: lockAmount,
      total: String(totalAmount),
      totalValue: totalAmount * initPrice,
    }
  }
}

function getClammPositionId(tokenAddress: string): string {
  const hex = tokenAddress.replace(/^0x/, "")
  return `#${hex.slice(-6)}`
}

/**
 * Combined hook that fetches all Initia L1 liquidity positions
 * and transforms them to LiquiditySectionData format for portfolio display
 */
export function useInitiaLiquidityPositions(): LiquiditySectionData {
  const layer1 = useLayer1()
  const assets = useAssets(layer1)
  const address = useInitiaAddress()

  const lps = useLps()
  const { data: delegations } = useInitiaDelegations()
  const { data: lockStaking } = useInitiaLockStaking()
  const { data: undelegations } = useInitiaUndelegations()
  const { data: stakingRewards } = useInitiaStakingRewards()
  const { data: lockStakingRewards } = useInitiaLockStakingRewards()
  const { data: allPrices } = usePricesQuery(layer1)

  const { data: clammPositions } = useClammDexPoolPositions(address)

  const clammPositionsByMetadata = useMemo(() => {
    const map = new Map<string, typeof clammPositions>()

    for (const position of clammPositions) {
      const existing = map.get(position.lpMetadata) ?? []
      existing.push(position)
      map.set(position.lpMetadata, existing)
    }

    return map
  }, [clammPositions])

  const clammMetadataList = useMemo(
    () => Array.from(clammPositionsByMetadata.keys()),
    [clammPositionsByMetadata],
  )

  const clammPools = useLiquidityPoolByMetadataList(clammMetadataList)
  const clammPoolInfos = useClammDexPoolInfoList(clammMetadataList)

  const clammTokenAddresses = useMemo(
    () => clammPositions.map((position) => position.tokenAddress),
    [clammPositions],
  )
  const clammFeesByToken = useClammDexPoolFeesList(clammTokenAddresses)

  const clammIncentiveQueries = useMemo(() => {
    const queries: ClammIncentiveQuery[] = []

    for (const position of clammPositions) {
      for (const incentive of position.incentives) {
        queries.push({
          tokenAddress: position.tokenAddress,
          incentiveAddress: incentive.incentiveAddress,
        })
      }
    }

    return queries
  }, [clammPositions])
  const clammIncentiveAmounts = useClammDexPoolIncentiveList(clammIncentiveQueries)

  const clammRewardMetadataList = useMemo(() => {
    const metadatas = new Set<string>()

    for (const position of clammPositions) {
      for (const incentive of position.incentives) {
        metadatas.add(incentive.rewardMetadata)
      }
    }

    return Array.from(metadatas)
  }, [clammPositions])
  const clammRewardMetadataToDenom = useDenoms(clammRewardMetadataList, { failSoft: true })

  const allMetadataKeys = useMemo(
    () => collectMetadataKeys(lps, delegations, lockStaking, undelegations),
    [lps, delegations, lockStaking, undelegations],
  )

  const denomsMap = useDenoms(allMetadataKeys)
  const lpDenomList = useMemo(() => getLpDenomList(denomsMap), [denomsMap])
  const { data: prices } = useLpPrices(lpDenomList)
  const pools = useLiquidityPoolList(lpDenomList)

  const assetByDenom = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>()

    for (const asset of assets) {
      map.set(asset.denom, asset)
    }

    return map
  }, [assets])

  const priceByDenom = useMemo(() => {
    const map = new Map<string, number>()

    for (const item of allPrices ?? []) {
      map.set(item.id, item.price)
    }

    return map
  }, [allPrices])

  const { rows, totalValue } = useMemo(() => {
    const initPrice = allPrices?.find((p) => p.id === INIT_DENOM)?.price ?? 0
    const rowMap = new Map<string, LiquidityTableRow>()

    for (const denom of lpDenomList) {
      rowMap.set(denom, createRow(denom, pools, assetByDenom))
    }

    processPositionsWithDenom(lps, denomsMap, prices, rowMap, "deposit")
    processPositionsWithDenom(delegations, denomsMap, prices, rowMap, "staking")
    processPositionsWithMetadata(lockStaking, denomsMap, prices, rowMap, "lockStaking")
    processPositionsWithDenom(undelegations, denomsMap, prices, rowMap, "unstaking")

    addClaimableRewards(rowMap, stakingRewards, lockStakingRewards, initPrice)

    for (const lpMetadata of clammMetadataList) {
      const positionsForPool = clammPositionsByMetadata.get(lpMetadata) ?? []
      if (positionsForPool.length === 0) continue

      const pool = clammPools.get(lpMetadata)
      const poolInfo = clammPoolInfos.get(lpMetadata)
      const rowDenom = createClammRowKey(lpMetadata)

      const coinDenoms = pool?.coins.map((coin) => coin.denom) ?? []
      const coinLogos = pool ? getCoinLogos(pool, assetByDenom).filter(Boolean) : []
      const symbols = coinDenoms.map((denom) => assetByDenom.get(denom)?.symbol || denom)
      const rowSymbol = pool?.symbol || symbols.join("-") || rowDenom
      const pricePairLabel = getMetadataPriceLabel(coinDenoms, assetByDenom)

      const clammPositionsForRow = positionsForPool.map((position) => {
        let minPrice: number | undefined
        let maxPrice: number | undefined
        let inRange: boolean | undefined
        let fullRange = false
        let value = 0
        let rewardValue = 0

        try {
          const range = calculateTokens({
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
          })
          minPrice = range.min
          maxPrice = range.max
        } catch {
          minPrice = undefined
          maxPrice = undefined
        }

        if (poolInfo) {
          try {
            const currentTick = getTickAtSqrtRatio(BigInt(poolInfo.sqrtPrice))
            const tickLower = i64FromBits(position.tickLower)
            const tickUpper = i64FromBits(position.tickUpper)
            const tickSpacing = Number(poolInfo.tickSpacing)

            fullRange =
              Number.isFinite(tickSpacing) && tickSpacing > 0
                ? isFullRange(position.tickLower, position.tickUpper, tickSpacing)
                : false
            inRange = fullRange || (currentTick >= tickLower && currentTick < tickUpper)
          } catch {
            inRange = undefined
            fullRange = false
          }

          if (pool && coinDenoms.length > 0) {
            try {
              const amounts = calculateAsset({
                sqrtPrice: poolInfo.sqrtPrice,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                liquidity: position.liquidity,
              })

              amounts.forEach((amount, index) => {
                const coin = pool.coins[index]
                if (!coin) return

                const decimals = assetByDenom.get(coin.denom)?.decimals ?? 6
                const price = priceByDenom.get(coin.denom) ?? 0
                const displayAmount = Number(fromBaseUnit(String(amount), { decimals }))
                value += displayAmount * price
              })
            } catch {
              value = 0
            }
          }
        }

        if (pool) {
          const fees = clammFeesByToken.get(position.tokenAddress) ?? []

          fees.forEach((feeAmount, index) => {
            const coin = pool.coins[index]
            if (!coin) return

            const decimals = assetByDenom.get(coin.denom)?.decimals ?? 6
            const price = priceByDenom.get(coin.denom) ?? 0
            const displayAmount = Number(fromBaseUnit(feeAmount, { decimals }))
            rewardValue += displayAmount * price
          })

          position.incentives.forEach((incentive) => {
            const amount =
              clammIncentiveAmounts.get(
                getClammIncentiveKey(position.tokenAddress, incentive.incentiveAddress),
              ) ?? "0"

            const rewardDenom = clammRewardMetadataToDenom.get(incentive.rewardMetadata)
            if (!rewardDenom) return

            const decimals = assetByDenom.get(rewardDenom)?.decimals ?? 6
            const price = priceByDenom.get(rewardDenom) ?? 0
            const displayAmount = Number(fromBaseUnit(amount, { decimals }))
            rewardValue += displayAmount * price
          })
        }

        return {
          tokenAddress: position.tokenAddress,
          positionId: getClammPositionId(position.tokenAddress),
          inRange,
          isFullRange: fullRange,
          minPrice,
          maxPrice,
          pricePairLabel,
          rewardValue,
          value,
        }
      })

      const totalValue = clammPositionsForRow.reduce((sum, position) => sum + position.value, 0)
      const totalRewardValue = clammPositionsForRow.reduce(
        (sum, position) => sum + position.rewardValue,
        0,
      )

      const hasCoinLogos = coinLogos.length > 0

      rowMap.set(rowDenom, {
        denom: rowDenom,
        symbol: rowSymbol,
        totalAmount: 0,
        totalValue,
        decimals: 6,
        poolType: "CLAMM",
        logoUrl: undefined,
        coinLogos: hasCoinLogos ? coinLogos : undefined,
        breakdown: {
          deposit: 0,
          staking: 0,
          lockStaking: 0,
          unstaking: 0,
        },
        isClamm: true,
        clamm: {
          lpMetadata,
          totalRewardValue,
          positions: clammPositionsForRow,
        },
      })
    }

    const sortedRows = Array.from(rowMap.values())
      .filter((row) => row.totalAmount > 0 || row.isClamm)
      .sort((a, b) => b.totalValue - a.totalValue)

    const totalVal = sortedRows.reduce((sum, row) => sum + row.totalValue, 0)

    return { rows: sortedRows, totalValue: totalVal }
  }, [
    allPrices,
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
    clammMetadataList,
    clammPositionsByMetadata,
    clammPools,
    clammPoolInfos,
    clammFeesByToken,
    clammIncentiveAmounts,
    clammRewardMetadataToDenom,
    priceByDenom,
  ])

  return {
    totalValue,
    rows,
  }
}
