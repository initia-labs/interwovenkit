import ky from "ky"
import { useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"

interface BridgeConfig {
  pinnedChainIds: string[]
  popularAssetSymbols: string[]
}

interface BridgeConfigRaw {
  pinnedChainIds?: string[]
  popularAssetSymbols?: string[]
  quickSearchSymbols?: string[]
}

const DEFAULT_CONFIG: BridgeConfig = {
  pinnedChainIds: ["1", "42161", "8453", "interwoven-1", "cabal-1", "echelon-1"],
  popularAssetSymbols: ["iUSD", "USDC", "INIT", "ETH"],
}

export function useBridgeConfig(): BridgeConfig {
  const { registryUrl } = useConfig()
  const { data } = useQuery({
    queryKey: ["interwovenkit:bridge-config", registryUrl],
    queryFn: async () => {
      const raw = await ky.get(`${registryUrl}/bridge-config.json`).json<BridgeConfigRaw>()
      return {
        pinnedChainIds: raw.pinnedChainIds ?? DEFAULT_CONFIG.pinnedChainIds,
        popularAssetSymbols:
          raw.popularAssetSymbols ?? raw.quickSearchSymbols ?? DEFAULT_CONFIG.popularAssetSymbols,
      }
    },
    staleTime: STALE_TIMES.MINUTE,
  })

  return data ?? DEFAULT_CONFIG
}
