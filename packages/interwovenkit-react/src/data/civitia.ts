import ky from "ky"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

// ============================================
// TYPES
// ============================================

export interface CivitiaPlayer {
  gold: number
  silver: number
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

  if (!civitiaUrl) {
    throw new Error("civitiaUrl is not configured")
  }

  if (!address) {
    throw new Error("address is not available")
  }

  return useSuspenseQuery({
    queryKey: civitiaQueryKeys.player(civitiaUrl, address).queryKey,
    queryFn: async (): Promise<CivitiaPlayer> => {
      return ky.get(`${civitiaUrl}/players/${address}`).json()
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}
