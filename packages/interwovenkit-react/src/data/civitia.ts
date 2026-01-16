import ky from "ky"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

// ============================================
// TYPES
// ============================================

export interface CivitiaPlayer {
  gold_balance: number
  silver_balance: number
}

// ============================================
// QUERY KEYS FACTORY
// ============================================

export const civitiaQueryKeys = createQueryKeys("interwovenkit:civitia", {
  player: (civitiaUrl: string, address: string) => [civitiaUrl, address],
})

// ============================================
// HOOKS
// ============================================

export function useCivitiaPlayer() {
  const { civitiaUrl } = useConfig()
  const address = useInitiaAddress()

  return useQuery({
    enabled: !!address,
    queryKey: civitiaQueryKeys.player(civitiaUrl, address ?? "").queryKey,
    queryFn: async (): Promise<CivitiaPlayer> => {
      if (!address) {
        throw new Error("address is not available")
      }
      return ky.get(`${civitiaUrl}/players/${address}`).json()
    },
    staleTime: STALE_TIMES.MINUTE,
    // Don't throw on 404 - it's a valid state (player doesn't exist)
    throwOnError: false,
  })
}
