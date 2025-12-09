import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useInitiaRegistry, useLayer1, usePricesQuery } from "./chains"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

// ============================================
// CONSTANTS
// ============================================

const INIT_DENOM = "uinit"

// ============================================
// QUERY KEYS
// ============================================

export const initiaVipQueryKeys = createQueryKeys("interwovenkit:initia-vip", {
  allVestingPositions: (vipUrl: string, address: string) => [vipUrl, address],
})

// ============================================
// TYPES (API returns snake_case)
// ============================================

interface VestingPositionsDataResponse {
  bridge_id: number
  version: number
  claimable_reward: number
  claimed_reward: number
  locked_reward: number
  initial_reward: number
  start_stage: number
  end_stage: number
  start_time: string
  total_score: number
  user_score: number
  minimum_score: number
  claimed: boolean
  merkle_proofs: string[]
}

interface VestingPositionsResponse {
  data: VestingPositionsDataResponse[]
  required_score: number
  total_claimable_reward: number
  total_locked_reward: number
  total_vesting_reward: number
}

type AllVestingPositionsResponse = VestingPositionsResponse[]

export interface VipPositionRow {
  bridgeId: number
  version: number
  name: string
  logoUrl?: string
  lockedReward: number
  lockedRewardValue: number
  claimableReward: number
  claimableRewardValue: number
}

export interface VipSectionData {
  totalValue: number
  rows: VipPositionRow[]
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function useVipClient() {
  const { vipUrl } = useConfig()
  return useMemo(() => ky.create({ prefixUrl: vipUrl }), [vipUrl])
}

interface NormalizedVestingEntry {
  claimableReward: number
  claimedReward: number
  initialReward: number
  lockedReward: number
  requiredScore: number
  rollup: {
    bridgeId: number
    version: number
  }
}

function normalizeVestingEntries(entries: AllVestingPositionsResponse): NormalizedVestingEntry[] {
  return entries
    .map((entry) => {
      const bridgeId = entry.data[0]?.bridge_id ?? 0
      const version = entry.data[0]?.version ?? 0
      // Sum up claimed rewards from individual entries
      const totalClaimedReward = entry.data.reduce((sum, d) => sum + d.claimed_reward, 0)
      return {
        claimableReward: entry.total_claimable_reward,
        claimedReward: totalClaimedReward,
        initialReward: entry.total_vesting_reward,
        lockedReward: entry.total_locked_reward,
        requiredScore: entry.required_score,
        rollup: { bridgeId, version },
      }
    })
    .filter((entry) => entry.initialReward > 0)
    .toSorted((a, b) => b.initialReward - a.initialReward)
}

// ============================================
// HOOKS
// ============================================

/** Fetch all VIP vesting positions for the user */
export function useAllVipVestingPositions() {
  const vipClient = useVipClient()
  const { vipUrl } = useConfig()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: initiaVipQueryKeys.allVestingPositions(vipUrl ?? "", address).queryKey,
    queryFn: async () => {
      const data = await vipClient
        .get(`vesting/positions/${address}`)
        .json<AllVestingPositionsResponse>()
      // Filter to positions with rewards
      return data.filter(({ total_vesting_reward }) => total_vesting_reward > 0)
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Hook to find chain profile by bridgeId */
export function useFindChainByBridgeId() {
  const chains = useInitiaRegistry()

  return (bridgeId: number | string) => {
    const chain = chains.find(({ metadata }) => metadata?.op_bridge_id === String(bridgeId))
    return chain
  }
}

/**
 * Hook to fetch Initia VIP vesting positions
 * Returns positions grouped by appchain with locked and claimable INIT
 */
export function useInitiaVipPositions(): VipSectionData {
  const { data: vestingPositions } = useAllVipVestingPositions()
  const layer1 = useLayer1()
  const { data: prices } = usePricesQuery(layer1)
  const findChainByBridgeId = useFindChainByBridgeId()

  // Get INIT price
  const initPrice = useMemo(() => {
    const initPriceItem = prices?.find((p) => p.id === INIT_DENOM)
    return initPriceItem?.price ?? 0
  }, [prices])

  const rows = useMemo(() => {
    const normalized = normalizeVestingEntries(vestingPositions)
    return normalized.map((entry) => {
      const chain = findChainByBridgeId(entry.rollup.bridgeId)
      // Convert from base units (uinit) to display units
      const lockedFormatted = entry.lockedReward / 1e6
      const claimableFormatted = entry.claimableReward / 1e6

      return {
        bridgeId: entry.rollup.bridgeId,
        version: entry.rollup.version,
        name: chain?.name ?? "",
        logoUrl: chain?.logoUrl ?? "",
        lockedReward: lockedFormatted,
        lockedRewardValue: lockedFormatted * initPrice,
        claimableReward: claimableFormatted,
        claimableRewardValue: claimableFormatted * initPrice,
      }
    })
  }, [vestingPositions, initPrice, findChainByBridgeId])

  // Total value = sum of locked and claimable values
  const totalValue = useMemo(
    () => rows.reduce((sum, row) => sum + row.lockedRewardValue + row.claimableRewardValue, 0),
    [rows],
  )

  return { rows, totalValue }
}
