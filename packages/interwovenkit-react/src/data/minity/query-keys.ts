import { queryOptions } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { STALE_TIMES } from "../http"
import { createMinityClient } from "./client"
import type { Balance, Prices, ProtocolPosition, SupportedChains } from "./types"

// ============================================
// QUERY KEYS FACTORY
// ============================================

export const minityQueryKeys = createQueryKeys("interwovenkit:minity", {
  // Miscellaneous
  supportedChains: (minityUrl?: string) => [minityUrl],
  prices: (minityUrl?: string) => [minityUrl],

  // SSE Portfolio (balances + positions streamed together)
  ssePortfolio: (address: string, minityUrl?: string) => [address, minityUrl],

  // Balances
  balances: (address: string, chainName: string, minityUrl?: string) => [
    address,
    chainName,
    minityUrl,
  ],

  // Positions
  initiaPositions: (address: string, minityUrl?: string) => [address, "initia", minityUrl],
  echelonPositions: (address: string, minityUrl?: string) => [address, "echelon", minityUrl],
  inertiaPositions: (address: string, minityUrl?: string) => [address, "inertia", minityUrl],
  ravePositions: (address: string, includeYield: boolean, minityUrl?: string) => [
    address,
    "rave",
    includeYield,
    minityUrl,
  ],
  yominetPositions: (address: string, minityUrl?: string) => [address, "yominet", minityUrl],
  chainPositions: (address: string, chainName: string, minityUrl?: string) => [
    address,
    chainName,
    minityUrl,
  ],
})

// ============================================
// QUERY OPTIONS
// ============================================

export const minityQueryOptions = {
  // Miscellaneous Endpoints

  supportedChains: (minityUrl?: string) =>
    queryOptions({
      queryKey: minityQueryKeys.supportedChains(minityUrl).queryKey,
      queryFn: async (): Promise<SupportedChains> => {
        return createMinityClient(minityUrl).get("v1/supported-chains").json()
      },
      staleTime: STALE_TIMES.INFINITY,
    }),

  prices: (minityUrl?: string) =>
    queryOptions({
      queryKey: minityQueryKeys.prices(minityUrl).queryKey,
      queryFn: async (): Promise<Prices> => {
        return createMinityClient(minityUrl).get("v1/prices").json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  // Balance Endpoints

  balances: (address: string, chainName: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.balances(address, chainName, minityUrl).queryKey,
      queryFn: async (): Promise<Balance[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/${chainName}/${address}/balances`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  // Position Endpoints

  initiaPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.initiaPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/initia/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  echelonPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.echelonPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/echelon/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  inertiaPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.inertiaPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/inertia/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  ravePositions: (address: string, includeYield = true, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.ravePositions(address, includeYield, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl)
          .get(`v1/chain/rave/${address}/positions`, {
            searchParams: { includeYield: String(includeYield) },
          })
          .json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  yominetPositions: (address: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.yominetPositions(address, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl).get(`v1/chain/yominet/${address}/positions`).json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),

  chainPositions: (address: string, chainName: string, minityUrl?: string) =>
    queryOptions({
      enabled: !!address,
      queryKey: minityQueryKeys.chainPositions(address, chainName, minityUrl).queryKey,
      queryFn: async (): Promise<ProtocolPosition[]> => {
        return createMinityClient(minityUrl)
          .get(`v1/chain/${chainName}/${address}/positions`)
          .json()
      },
      staleTime: STALE_TIMES.MINUTE,
    }),
}
