import { useMemo } from "react"
import { fromBaseUnit } from "@initia/utils"
import { useAssets, useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import { INIT_DECIMALS, INIT_DENOM } from "./constants"
import { useLpPrices, useLps } from "./initia-liquidity"
import {
  useInitiaDelegations,
  useInitiaLockStaking,
  useInitiaUndelegations,
} from "./initia-staking"
import { useAllVipVestingPositions } from "./initia-vip"

// ============================================
// LIGHTWEIGHT L1 POSITIONS TOTAL HOOK
// ============================================

/**
 * Lightweight hook to get total L1 positions value (staking + liquidity + VIP).
 * Optimized for Home view - computes only totals without building full data structures.
 * Skips unnecessary queries (e.g., pool info, chain profiles) that the full hooks need.
 */
export function useL1PositionsTotal(): number {
  // Shared data sources
  const lps = useLps()
  const { data: delegations } = useInitiaDelegations()
  const { data: lockStaking } = useInitiaLockStaking()
  const { data: undelegations } = useInitiaUndelegations()
  const { data: vestingPositions } = useAllVipVestingPositions()

  // Fetch INIT price
  const layer1 = useLayer1()
  const { data: prices } = usePricesQuery(layer1)
  const initPrice = useMemo(() => {
    const initPriceItem = prices?.find((p) => p.id === INIT_DENOM)
    return initPriceItem?.price ?? 0
  }, [prices])

  // Collect all metadata keys for denom resolution
  const allMetadataKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [m] of lps) keys.add(m)
    for (const [m] of delegations) keys.add(m)
    for (const [m] of lockStaking) keys.add(m)
    for (const [m] of undelegations) keys.add(m)
    return Array.from(keys)
  }, [lps, delegations, lockStaking, undelegations])

  const denoms = useDenoms(allMetadataKeys)
  const denomList = useMemo(
    () => Array.from(denoms.values()).filter((d) => d !== INIT_DENOM),
    [denoms],
  )

  const { data: lpPrices } = useLpPrices(denomList)

  // Get L1 assets for decimals lookup
  const assets = useAssets(layer1)
  const tokens = useMemo(() => {
    const map = new Map<string, { decimals?: number }>()
    for (const asset of assets) {
      map.set(asset.denom, { decimals: asset.decimals })
    }
    return map
  }, [assets])

  return useMemo(() => {
    let stakingTotal = 0
    let liquidityTotal = 0
    const price = initPrice ?? 0

    // Helper to get LP value
    const getLpValue = (metadata: string, amount: string): number => {
      const denom = denoms.get(metadata) ?? metadata
      if (denom === INIT_DENOM) return 0
      const decimals = tokens.get(denom)?.decimals ?? 6
      return Number(fromBaseUnit(amount, { decimals })) * (lpPrices.get(denom) ?? 0)
    }

    // === DELEGATIONS (single pass for both INIT staking and LP) ===
    for (const [, stakingList] of delegations) {
      for (const { denom, metadata, amount } of stakingList) {
        if (denom === INIT_DENOM) {
          stakingTotal += Number(fromBaseUnit(amount, { decimals: 6 })) * price
        } else {
          liquidityTotal += getLpValue(metadata, amount)
        }
      }
    }

    // === LOCK STAKING (single pass) ===
    for (const [metadata, lockList] of lockStaking) {
      const denom = denoms.get(metadata) ?? metadata
      const isInit = denom === INIT_DENOM
      for (const { amount } of lockList) {
        if (isInit) {
          stakingTotal += Number(fromBaseUnit(amount, { decimals: 6 })) * price
        } else {
          liquidityTotal += getLpValue(metadata, amount)
        }
      }
    }

    // === UNDELEGATIONS (single pass) ===
    for (const [, unstakingList] of undelegations) {
      for (const { denom, metadata, amount } of unstakingList) {
        if (denom === INIT_DENOM) {
          stakingTotal += Number(fromBaseUnit(amount, { decimals: 6 })) * price
        } else {
          liquidityTotal += getLpValue(metadata, amount)
        }
      }
    }

    // === LP TOKENS IN WALLET ===
    for (const [metadata, lpList] of lps) {
      for (const { amount } of lpList) {
        liquidityTotal += getLpValue(metadata, String(amount))
      }
    }

    // === VIP TOTAL ===
    let vipTotal = 0
    if (vestingPositions) {
      for (const position of vestingPositions) {
        const lockedReward = position.total_locked_reward ?? 0
        const claimableReward = position.total_claimable_reward ?? 0
        vipTotal +=
          Number(
            fromBaseUnit(String(lockedReward + claimableReward), { decimals: INIT_DECIMALS }),
          ) * price
      }
    }

    return stakingTotal + liquidityTotal + vipTotal
  }, [
    delegations,
    lockStaking,
    undelegations,
    lps,
    vestingPositions,
    initPrice,
    denoms,
    lpPrices,
    tokens,
  ])
}
