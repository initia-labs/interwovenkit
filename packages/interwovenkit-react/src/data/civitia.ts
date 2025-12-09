import ky from "ky"
import { useMemo } from "react"
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
// CLIENT
// ============================================

function useCivitiaClient() {
  const { civitiaUrl } = useConfig()
  return useMemo(() => ky.create({ prefixUrl: civitiaUrl }), [civitiaUrl])
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
  const civitiaClient = useCivitiaClient()
  const { civitiaUrl } = useConfig()
  const address = useInitiaAddress()

  return useSuspenseQuery({
    queryKey: civitiaQueryKeys.player(civitiaUrl ?? "", address ?? "").queryKey,
    queryFn: async (): Promise<CivitiaPlayer> => {
      return civitiaClient.get(`players/${address}`).json()
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}
