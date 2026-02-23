import { useMemo } from "react"
import { fromBaseUnit } from "@initia/utils"
import { useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import { INIT_DECIMALS, INIT_DENOM } from "./constants"
import { useInitiaLiquidityPositions } from "./initia-liquidity"
import {
  useInitiaDelegations,
  useInitiaLockStaking,
  useInitiaUndelegations,
} from "./initia-staking"
import { useAllVipVestingPositions } from "./initia-vip"

// ============================================
// L1 POSITIONS TOTAL HOOK
// ============================================

/**
 * Calculates total L1 positions value (staking + liquidity + VIP).
 * Uses the same liquidity aggregation source as the liquidity section so totals stay consistent.
 */
export function useL1PositionsTotal(): number {
  const { totalValue: liquidityTotal } = useInitiaLiquidityPositions()
  const { data: delegations } = useInitiaDelegations()
  const { data: lockStaking } = useInitiaLockStaking()
  const { data: undelegations } = useInitiaUndelegations()
  const { data: vestingPositions } = useAllVipVestingPositions()
  const lockStakingMetadataKeys = useMemo(() => Array.from(lockStaking.keys()), [lockStaking])
  const lockStakingDenoms = useDenoms(lockStakingMetadataKeys)

  // Fetch INIT price
  const layer1 = useLayer1()
  const { data: prices } = usePricesQuery(layer1)
  const initPrice = useMemo(() => {
    const initPriceItem = prices?.find((p) => p.id === INIT_DENOM)
    return initPriceItem?.price ?? 0
  }, [prices])

  return useMemo(() => {
    let stakingTotal = 0
    let lockStakingInitTotal = 0
    const price = initPrice ?? 0

    // Delegations can include INIT staking.
    for (const [, stakingList] of delegations) {
      for (const { denom, amount } of stakingList) {
        if (denom === INIT_DENOM) {
          stakingTotal += Number(fromBaseUnit(amount, { decimals: INIT_DECIMALS })) * price
        }
      }
    }

    // Lock staking can contain both INIT and LP metadata, only include INIT here.
    for (const [metadata, lockList] of lockStaking) {
      if (lockStakingDenoms.get(metadata) !== INIT_DENOM) continue
      for (const { amount } of lockList) {
        lockStakingInitTotal += Number(fromBaseUnit(amount, { decimals: INIT_DECIMALS })) * price
      }
    }

    // Undelegations can include INIT staking.
    for (const [, unstakingList] of undelegations) {
      for (const { denom, amount } of unstakingList) {
        if (denom === INIT_DENOM) {
          stakingTotal += Number(fromBaseUnit(amount, { decimals: INIT_DECIMALS })) * price
        }
      }
    }

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

    return stakingTotal + lockStakingInitTotal + liquidityTotal + vipTotal
  }, [
    delegations,
    lockStaking,
    lockStakingDenoms,
    undelegations,
    vestingPositions,
    initPrice,
    liquidityTotal,
  ])
}
