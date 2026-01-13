import { toBase64, toHex } from "@cosmjs/encoding"
import { bcs } from "@mysten/bcs"
import { sha3_256 } from "@noble/hashes/sha3"
import { toBytes } from "@noble/hashes/utils"
import BigNumber from "bignumber.js"
import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { createMoveClient, denomToMetadata, fromBaseUnit, InitiaAddress } from "@initia/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAssets, useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import { useConfig } from "./config"
import { INIT_DENOM } from "./constants"
import { STALE_TIMES } from "./http"
import type { Position, TokenAsset } from "./minity"

// ============================================
// CONSTANTS
// ============================================

const LOCK_STAKE_MODULE_NAME = "lock_staking"

// ============================================
// LOCK STAKING ADDRESS DERIVATION
// ============================================

/**
 * Derives the lock staking address for a given user address.
 * This is where lock-staked tokens are held and where unbonding from lock staking goes.
 *
 * Implementation follows app-v2's getLockStakingHexAddress:
 * https://github.com/initia-labs/initia-app-v2/blob/main/src/utils/initia/lock-staking.ts
 *
 * Move VM Object Address Derivation:
 * - Uses OBJECT_FROM_SEED_ADDRESS_SCHEME (0xfe) as defined in Move VM spec
 * - SHA3-256 hashing matches Initia's Move VM implementation
 * - Address derivation: sha3_256(source_address || seed || scheme_byte)
 * - Seed format: type_name_bytes || address_bytes (32 bytes each)
 *
 * The scheme 0xfe is the Move VM's standard for object addresses derived from seeds,
 * as opposed to 0xfd for named objects or other schemes. This ensures compatibility
 * with Initia's lock_staking module which creates StakingAccount objects using this scheme.
 *
 * @param address - User's Initia bech32 address
 * @param lockStakeModuleAddress - Lock staking module address (e.g., "0x...")
 * @returns Derived lock staking account address in bech32 format
 */
function getLockStakingAddress(address: string, lockStakeModuleAddress: string): string {
  const OBJECT_FROM_SEED_ADDRESS_SCHEME = 0xfe
  const typeName = `${lockStakeModuleAddress}::lock_staking::StakingAccount`

  // Serialize address using BCS (32 bytes)
  const addrBytes = [...bcs.bytes(32).serialize(InitiaAddress(address, 32).bytes).toBytes()]

  // Create seed: typeName bytes + address bytes
  const seed = new Uint8Array([...toBytes(typeName), ...addrBytes])

  // Create final bytes: address bytes + seed + scheme byte
  const bytes = new Uint8Array([...addrBytes, ...seed, OBJECT_FROM_SEED_ADDRESS_SCHEME])

  // Hash and convert to bech32 address
  const hash = sha3_256.create()
  const sum = hash.update(bytes).digest()
  const hexAddress = `0x${toHex(sum)}`

  return InitiaAddress(hexAddress).bech32
}

// ============================================
// QUERY KEYS
// ============================================

export const initiaStakingQueryKeys = createQueryKeys("interwovenkit:initia-staking", {
  delegations: (restUrl: string, address: string) => [restUrl, address],
  undelegations: (restUrl: string, address: string, lockAddress: string) => [
    restUrl,
    address,
    lockAddress,
  ],
  lockStaking: (restUrl: string, address: string, moduleAddress: string) => [
    restUrl,
    address,
    moduleAddress,
  ],
  stakingRewards: (restUrl: string, address: string) => [restUrl, address, "rewards"],
  lockStakingRewards: (restUrl: string, lockAddress: string) => [restUrl, lockAddress, "rewards"],
})

// ============================================
// RAW RESPONSE TYPES
// ============================================

interface DelegationBalance {
  denom: string
  amount: string
}

interface DelegationResponse {
  delegation_responses: Array<{
    delegation: {
      delegator_address: string
      validator_address: string
    }
    balance: DelegationBalance[]
  }>
  pagination?: {
    next_key: string | null
    total: string
  }
}

interface UnbondingEntry {
  creation_height: string
  completion_time: string
  initial_balance: DelegationBalance[]
  balance: DelegationBalance[]
}

interface UnbondingDelegationResponse {
  unbonding_responses: Array<{
    delegator_address: string
    validator_address: string
    entries: UnbondingEntry[]
  }>
  pagination?: {
    next_key: string | null
    total: string
  }
}

interface LockDelegation {
  validator: string
  metadata: string
  amount: string
  locked_share: string
  release_time: string
}

interface RewardCoin {
  denom: string
  amount: string
}

interface RewardPool {
  denom: string
  dec_coins: RewardCoin[]
}

interface RewardsResponse {
  rewards: Array<{
    validator_address: string
    reward: RewardPool[]
  }>
  total: RewardPool[]
}

// ============================================
// NORMALIZED TYPES
// ============================================

interface NormalizedStaking {
  denom: string
  metadata: string
  amount: string
  validator: string
}

interface NormalizedUnstaking {
  denom: string
  metadata: string
  amount: string
  validator: string
  completionTime: string
}

interface NormalizedLockStaking {
  metadata: string
  amount: string
  validator: string
  releaseTime: string
}

// ============================================
// HOOKS
// ============================================

/** Fetch regular delegations from mstaking module */
export function useInitiaDelegations() {
  const { restUrl } = useLayer1()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: initiaStakingQueryKeys.delegations(restUrl, address).queryKey,
    queryFn: async () => {
      if (!address) return []
      const response = await ky
        .get(`${restUrl}/initia/mstaking/v1/delegations/${address}`)
        .json<DelegationResponse>()
      return response.delegation_responses
    },
    select: (data): Map<string, NormalizedStaking[]> => {
      const result = new Map<string, NormalizedStaking[]>()

      for (const delegation of data) {
        const validator = delegation.delegation.validator_address
        for (const balance of delegation.balance) {
          const metadata = denomToMetadata(balance.denom)
          const normalized: NormalizedStaking = {
            denom: balance.denom,
            metadata,
            amount: balance.amount,
            validator,
          }

          if (!result.has(metadata)) {
            result.set(metadata, [])
          }
          result.get(metadata)!.push(normalized)
        }
      }

      return result
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Fetch unbonding delegations from mstaking module (both user and lock staking addresses) */
export function useInitiaUndelegations() {
  const { restUrl } = useLayer1()
  const { lockStakeModuleAddress } = useConfig()
  const address = useInitiaAddress()
  const lockStakingAddress = lockStakeModuleAddress
    ? getLockStakingAddress(address, lockStakeModuleAddress)
    : null

  return useSuspenseQuery({
    queryKey: initiaStakingQueryKeys.undelegations(restUrl, address, lockStakingAddress ?? "")
      .queryKey,
    queryFn: async () => {
      // Fetch user unbonding delegations
      const userResult = await ky
        .get(`${restUrl}/initia/mstaking/v1/delegators/${address}/unbonding_delegations`)
        .json<UnbondingDelegationResponse>()
        .catch(() => ({ unbonding_responses: [] }))

      // Only fetch lock staking undelegations if module is configured
      let lockResponses: UnbondingDelegationResponse["unbonding_responses"] = []
      if (lockStakingAddress) {
        const lockResult = await ky
          .get(
            `${restUrl}/initia/mstaking/v1/delegators/${lockStakingAddress}/unbonding_delegations`,
          )
          .json<UnbondingDelegationResponse>()
          .catch(() => ({ unbonding_responses: [] }))
        lockResponses = lockResult.unbonding_responses
      }

      return [...userResult.unbonding_responses, ...lockResponses]
    },
    select: (data): Map<string, NormalizedUnstaking[]> => {
      const result = new Map<string, NormalizedUnstaking[]>()

      for (const unbonding of data) {
        const validator = unbonding.validator_address
        for (const entry of unbonding.entries) {
          for (const balance of entry.balance) {
            const metadata = denomToMetadata(balance.denom)
            const normalized: NormalizedUnstaking = {
              denom: balance.denom,
              metadata,
              amount: balance.amount,
              validator,
              completionTime: entry.completion_time,
            }

            if (!result.has(metadata)) {
              result.set(metadata, [])
            }
            result.get(metadata)!.push(normalized)
          }
        }
      }

      return result
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Fetch lock staking positions via Move VM view function */
export function useInitiaLockStaking() {
  const { restUrl } = useLayer1()
  const { lockStakeModuleAddress } = useConfig()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: initiaStakingQueryKeys.lockStaking(restUrl, address, lockStakeModuleAddress ?? "")
      .queryKey,
    queryFn: async () => {
      // Return empty result if lock stake module is not configured
      if (!lockStakeModuleAddress) {
        return []
      }

      const { viewFunction } = createMoveClient(restUrl)
      const result = await viewFunction<LockDelegation[]>({
        moduleAddress: lockStakeModuleAddress,
        moduleName: LOCK_STAKE_MODULE_NAME,
        functionName: "get_locked_delegations",
        typeArgs: [],
        args: [toBase64(InitiaAddress(address, 32).bytes)],
      })
      return result ?? []
    },
    select: (data): Map<string, NormalizedLockStaking[]> => {
      const result = new Map<string, NormalizedLockStaking[]>()

      for (const lock of data) {
        const normalized: NormalizedLockStaking = {
          metadata: lock.metadata,
          amount: lock.amount,
          validator: lock.validator,
          releaseTime: lock.release_time,
        }

        if (!result.has(lock.metadata)) {
          result.set(lock.metadata, [])
        }
        result.get(lock.metadata)!.push(normalized)
      }

      return result
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Normalized reward totals grouped by metadata (denom) */
export type NormalizedRewards = Map<string, { denom: string; amount: string }>

/** Normalize rewards response - group totals by metadata */
function normalizeRewards(data: RewardsResponse): NormalizedRewards {
  const result = new Map<string, { denom: string; amount: string }>()

  if (!data.total || !Array.isArray(data.total)) {
    return result
  }

  for (const pool of data.total) {
    if (!pool?.denom || !pool?.dec_coins) continue
    const metadata = denomToMetadata(pool.denom)

    // Sum all coin amounts for this pool
    let totalAmount = new BigNumber(0)
    for (const coin of pool.dec_coins) {
      if (coin?.amount) {
        totalAmount = totalAmount.plus(coin.amount)
      }
    }

    // Merge with existing entry if present
    const existing = result.get(metadata)
    if (existing) {
      const existingAmount = new BigNumber(existing.amount)
      totalAmount = totalAmount.plus(existingAmount)
    }

    result.set(metadata, {
      denom: pool.denom,
      amount: totalAmount.toString(),
    })
  }

  return result
}

/** Fetch staking rewards from distribution module (regular staking) */
export function useInitiaStakingRewards() {
  const { restUrl } = useLayer1()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: initiaStakingQueryKeys.stakingRewards(restUrl, address).queryKey,
    queryFn: async () => {
      if (!address) return { rewards: [], total: [] }
      const response = await ky
        .get(`${restUrl}/initia/distribution/v1/delegators/${address}/rewards`)
        .json<RewardsResponse>()
      return response
    },
    select: normalizeRewards,
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Fetch lock staking rewards from distribution module */
export function useInitiaLockStakingRewards() {
  const { restUrl } = useLayer1()
  const { lockStakeModuleAddress } = useConfig()
  const address = useInitiaAddress()
  const lockStakingAddress = lockStakeModuleAddress
    ? getLockStakingAddress(address, lockStakeModuleAddress)
    : null

  return useSuspenseQuery({
    queryKey: initiaStakingQueryKeys.lockStakingRewards(restUrl, lockStakingAddress ?? "").queryKey,
    queryFn: async () => {
      // Return empty rewards if lock stake module is not configured
      if (!lockStakingAddress) {
        return { rewards: [], total: [] }
      }

      const response = await ky
        .get(`${restUrl}/initia/distribution/v1/delegators/${lockStakingAddress}/rewards`)
        .json<RewardsResponse>()
      return response
    },
    select: normalizeRewards,
    staleTime: STALE_TIMES.MINUTE,
  })
}

// ============================================
// COMBINED HOOK
// ============================================

interface InitiaStakingPositionsResult {
  positions: Position[]
  totalValue: number
  isLoading: boolean
}

/**
 * Combined hook that fetches all Initia L1 staking positions
 * and transforms them to Position[] format for portfolio display
 */
export function useInitiaStakingPositions(): InitiaStakingPositionsResult {
  const layer1 = useLayer1()
  const assets = useAssets(layer1)
  const { data: prices, isLoading: pricesLoading } = usePricesQuery(layer1)
  const { data: delegations } = useInitiaDelegations()
  const { data: undelegations } = useInitiaUndelegations()
  const { data: lockStaking } = useInitiaLockStaking()

  // Collect all unique metadata keys from all position types
  const allMetadataKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const metadata of delegations.keys()) keys.add(metadata)
    for (const metadata of lockStaking.keys()) keys.add(metadata)
    for (const metadata of undelegations.keys()) keys.add(metadata)
    return Array.from(keys)
  }, [delegations, lockStaking, undelegations])

  // Convert all metadatas to denoms via REST API
  const denomsMap = useDenoms(allMetadataKeys)

  // Build price lookup map for O(1) access by denom
  const priceByDenom = useMemo(() => {
    const map = new Map<string, number>()
    if (prices) {
      for (const item of prices) {
        map.set(item.id, item.price)
      }
    }
    return map
  }, [prices])

  // Build asset lookup map for O(1) access by denom
  const assetByDenom = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>()
    for (const asset of assets) {
      map.set(asset.denom, asset)
    }
    return map
  }, [assets])

  const positions = useMemo(() => {
    const result: Position[] = []

    // Helper to get asset info from denom - returns null if not found in registry
    const getAssetInfo = (denom: string) => {
      const asset = assetByDenom.get(denom)
      if (!asset) return null
      return {
        symbol: asset.symbol,
        decimals: asset.decimals,
      }
    }

    // Process delegations → staking positions
    for (const [metadata, stakingList] of delegations) {
      const denom = denomsMap.get(metadata) ?? stakingList[0]?.denom
      if (!denom) continue

      const assetInfo = getAssetInfo(denom)
      // Skip unsupported assets (not in registry)
      if (!assetInfo) continue

      const price = priceByDenom.get(denom) ?? 0

      for (const staking of stakingList) {
        const { symbol, decimals } = assetInfo
        const formattedAmount = Number(fromBaseUnit(staking.amount, { decimals }))
        const balance: TokenAsset = {
          type: "asset",
          denom,
          symbol,
          amount: staking.amount,
          formattedAmount,
          decimals,
          value: formattedAmount * price,
        }

        result.push({
          type: "staking",
          validator: staking.validator,
          balance,
        })
      }
    }

    // Process lock staking → lockstaking positions
    for (const [metadata, lockList] of lockStaking) {
      const denom = denomsMap.get(metadata)
      if (!denom) continue

      const assetInfo = getAssetInfo(denom)
      // Skip unsupported assets (not in registry)
      if (!assetInfo) continue

      const price = priceByDenom.get(denom) ?? 0

      for (const lock of lockList) {
        const { symbol, decimals } = assetInfo
        const formattedAmount = Number(fromBaseUnit(lock.amount, { decimals }))
        const balance: TokenAsset = {
          type: "asset",
          denom,
          symbol,
          amount: lock.amount,
          formattedAmount,
          decimals,
          value: formattedAmount * price,
        }

        result.push({
          type: "lockstaking",
          validator: lock.validator,
          releaseTime: Number(lock.releaseTime),
          balance,
        })
      }
    }

    // Process undelegations → unstaking positions
    for (const [metadata, unstakingList] of undelegations) {
      const denom = denomsMap.get(metadata) ?? unstakingList[0]?.denom
      if (!denom) continue

      const assetInfo = getAssetInfo(denom)
      // Skip unsupported assets (not in registry)
      if (!assetInfo) continue

      const price = priceByDenom.get(denom) ?? 0

      for (const unstaking of unstakingList) {
        const { symbol, decimals } = assetInfo
        const formattedAmount = Number(fromBaseUnit(unstaking.amount, { decimals }))
        const balance: TokenAsset = {
          type: "asset",
          denom,
          symbol,
          amount: unstaking.amount,
          formattedAmount,
          decimals,
          value: formattedAmount * price,
        }

        const completionTime = Math.floor(new Date(unstaking.completionTime).getTime() / 1000)
        result.push({
          type: "unstaking",
          validator: unstaking.validator,
          completionTime,
          balance,
        })
      }
    }

    // Filter to only include INIT tokens (LP tokens are handled by useInitiaLiquidityPositions)
    return result.filter(
      (pos) => pos.type !== "fungible-position" && pos.balance.denom === INIT_DENOM,
    )
  }, [delegations, lockStaking, undelegations, denomsMap, assetByDenom, priceByDenom])

  // Calculate total value from position balances (prices fetched via usePricesQuery)
  const totalValue = useMemo(() => {
    return positions.reduce((sum, pos) => {
      if (pos.type === "fungible-position") return sum
      if (pos.balance.type === "unknown") return sum
      return sum + (pos.balance.value ?? 0)
    }, 0)
  }, [positions])

  return {
    positions,
    totalValue,
    isLoading: pricesLoading,
  }
}
