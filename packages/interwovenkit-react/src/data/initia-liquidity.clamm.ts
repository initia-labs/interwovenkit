import { toBase64 } from "@cosmjs/encoding"
import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createMoveClient, InitiaAddress } from "@initia/utils"
import { useLayer1 } from "./chains"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"
import { initiaLiquidityQueryKeys } from "./initia-liquidity.query-keys"
import type {
  ClammIncentiveQuery,
  ClammPoolInfo,
  ClammPosition,
  ClammPositionResponseItem,
  ClammPositionsResponse,
} from "./initia-liquidity.types"

interface ClammModuleConfig {
  clammModuleAddress: string
  incentiveModuleAddress: string
}

const CLAMM_MODULE_NAMES = {
  lens: "lens",
  pool: "pool",
  farming: "farming",
} as const

const CLAMM_MODULES_BY_CHAIN_ID: Record<string, ClammModuleConfig> = {
  "interwoven-1": {
    clammModuleAddress: "0xd78a3b72c7ef0cfba7286bfb8c618aa4d6011dce05a832871cc9ab323c25f55e",
    incentiveModuleAddress: "0xcb2999c70a9b8db7cb473255bb01f956f0726087f08b04ece50844a6d8167351",
  },
  "initiation-2": {
    clammModuleAddress: "0x6b41bf295bc31cd9bef75a9a5a67e5a8d6749b34a7ab3105808251fa2697823d",
    incentiveModuleAddress: "0xf8ef0cb7c73607b7658524565015ce2aadc45ccf7164e5351959a4d7a1c37753",
  },
}

function normalizeObjectAddress(address: string): string {
  if (!address.startsWith("0x")) {
    return InitiaAddress(address).hex
  }

  const hex = address.replace(/^0x/, "")
  return `0x${hex.padStart(64, "0")}`
}

function toObjectArg(address: string): string {
  return toBase64(InitiaAddress(normalizeObjectAddress(address), 32).bytes)
}

export function getClammIncentiveKey(tokenAddress: string, incentiveAddress: string): string {
  return `${tokenAddress}:${incentiveAddress}`
}

export function createClammRowKey(lpMetadata: string): string {
  return `clamm:${lpMetadata}`
}

export function flattenClammPositions(
  positions: ClammPositionsResponse["positions"],
): ClammPositionResponseItem[] {
  if (!Array.isArray(positions) || positions.length === 0) return []

  if (Array.isArray(positions[0])) {
    return (positions as ClammPositionResponseItem[][]).flat()
  }

  return positions as ClammPositionResponseItem[]
}

function normalizeClammPositions(items: ClammPositionResponseItem[]): ClammPosition[] {
  return items.map((position) => ({
    tokenAddress: position.token_address,
    lpMetadata: position.lp_metadata,
    tickLower: position.tick_lower,
    tickUpper: position.tick_upper,
    liquidity: position.liquidity,
    incentives: position.incentives.map((incentive) => ({
      incentiveAddress: incentive.incentive_address,
      rewardMetadata: incentive.reward_metadata,
    })),
  }))
}

/** Fetch CLAMM positions for address */
export function useClammDexPoolPositions(address: string) {
  const { dexUrl } = useConfig()

  return useSuspenseQuery({
    queryKey: initiaLiquidityQueryKeys.clammPositions(dexUrl, address).queryKey,
    queryFn: async () => {
      if (!address) return [] as ClammPosition[]

      const all: ClammPositionResponseItem[] = []
      let nextKey: string | undefined

      do {
        const searchParams: Record<string, string> = { "pagination.limit": "100" }
        if (nextKey) searchParams["pagination.offset"] = nextKey

        const response = await ky
          .get(`${dexUrl}/indexer/clamm/v1/positions/${address}`, { searchParams })
          .json<ClammPositionsResponse>()
          .catch(() => ({ positions: [], pagination: { next_key: null, total: "0" } }))

        all.push(...flattenClammPositions(response.positions))
        nextKey = response.pagination.next_key || undefined
      } while (nextKey)

      return normalizeClammPositions(all)
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}

/** Fetch CLAMM pool infos from on-chain lens module */
export function useClammDexPoolInfoList(lpMetadatas: string[]): Map<string, ClammPoolInfo | null> {
  const layer1 = useLayer1()
  const { viewFunction } = createMoveClient(layer1.restUrl)

  const queries = useSuspenseQueries({
    queries: lpMetadatas.map((lpMetadata) => ({
      queryKey: initiaLiquidityQueryKeys.clammPoolInfo(layer1.restUrl, layer1.chainId, lpMetadata)
        .queryKey,
      queryFn: async () => {
        const modules = CLAMM_MODULES_BY_CHAIN_ID[layer1.chainId]
        if (!modules) return null

        try {
          const result = await viewFunction<Record<string, string>>({
            moduleAddress: modules.clammModuleAddress,
            moduleName: CLAMM_MODULE_NAMES.lens,
            functionName: "get_pool_info",
            typeArgs: [],
            args: [toObjectArg(lpMetadata)],
          })

          if (!result?.sqrt_price || !result?.tick_spacing) return null

          return {
            sqrtPrice: result.sqrt_price,
            tickSpacing: result.tick_spacing,
          } as ClammPoolInfo
        } catch {
          return null
        }
      },
      staleTime: STALE_TIMES.MINUTE,
    })),
  })

  const queryData = queries.map((query) => query.data)

  return useMemo(() => {
    const map = new Map<string, ClammPoolInfo | null>()

    lpMetadatas.forEach((lpMetadata, i) => {
      map.set(lpMetadata, queryData[i] ?? null)
    })

    return map
  }, [lpMetadatas, queryData])
}

/** Fetch claimable CLAMM fees by position token address */
export function useClammDexPoolFeesList(tokenAddresses: string[]): Map<string, string[]> {
  const layer1 = useLayer1()
  const { viewFunction } = createMoveClient(layer1.restUrl)

  const queries = useSuspenseQueries({
    queries: tokenAddresses.map((tokenAddress) => ({
      queryKey: initiaLiquidityQueryKeys.clammFees(layer1.restUrl, layer1.chainId, tokenAddress)
        .queryKey,
      queryFn: async () => {
        const modules = CLAMM_MODULES_BY_CHAIN_ID[layer1.chainId]
        if (!modules) return null

        try {
          const result = await viewFunction<string[]>({
            moduleAddress: modules.clammModuleAddress,
            moduleName: CLAMM_MODULE_NAMES.pool,
            functionName: "fees_available",
            typeArgs: [],
            args: [toObjectArg(tokenAddress)],
          })

          return Array.isArray(result) ? result : null
        } catch {
          return null
        }
      },
      staleTime: STALE_TIMES.MINUTE,
    })),
  })

  const queryData = queries.map((query) => query.data)

  return useMemo(() => {
    const map = new Map<string, string[]>()

    tokenAddresses.forEach((tokenAddress, i) => {
      const fees = queryData[i]
      if (!fees) return
      map.set(tokenAddress, fees)
    })

    return map
  }, [tokenAddresses, queryData])
}

/** Fetch pending CLAMM incentive rewards by position/incentive pair */
export function useClammDexPoolIncentiveList(
  incentiveQueries: ClammIncentiveQuery[],
): Map<string, string> {
  const layer1 = useLayer1()
  const { viewFunction } = createMoveClient(layer1.restUrl)

  const queries = useSuspenseQueries({
    queries: incentiveQueries.map((query) => ({
      queryKey: initiaLiquidityQueryKeys.clammIncentive(
        layer1.restUrl,
        layer1.chainId,
        query.tokenAddress,
        query.incentiveAddress,
      ).queryKey,
      queryFn: async () => {
        const modules = CLAMM_MODULES_BY_CHAIN_ID[layer1.chainId]
        if (!modules) return "0"

        try {
          const result = await viewFunction<[string, string] | string>({
            moduleAddress: modules.incentiveModuleAddress,
            moduleName: CLAMM_MODULE_NAMES.farming,
            functionName: "pending_reward_info",
            typeArgs: [],
            args: [toObjectArg(query.tokenAddress), toObjectArg(query.incentiveAddress)],
          })

          if (typeof result === "string") return result
          if (Array.isArray(result) && typeof result[0] === "string") return result[0]
          return "0"
        } catch {
          return "0"
        }
      },
      staleTime: STALE_TIMES.MINUTE,
    })),
  })

  const queryData = queries.map((query) => query.data)

  return useMemo(() => {
    const map = new Map<string, string>()

    incentiveQueries.forEach((query, i) => {
      map.set(getClammIncentiveKey(query.tokenAddress, query.incentiveAddress), queryData[i] || "0")
    })

    return map
  }, [incentiveQueries, queryData])
}
