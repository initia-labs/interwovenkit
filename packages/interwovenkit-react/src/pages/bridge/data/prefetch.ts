import { usePrefetchQuery, useQueryClient } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import type { AllAssetsResponse } from "./assets"
import { skipQueryKeys, useSkip } from "./skip"

/** Prefetch chains and assets in parallel (no waterfall, no suspend) */
export function usePrefetchBridgeData() {
  const skip = useSkip()
  const queryClient = useQueryClient()

  usePrefetchQuery({
    queryKey: skipQueryKeys.chains.queryKey,
    queryFn: () => skip.get("v2/info/chains").json(),
    staleTime: STALE_TIMES.MINUTE,
  })

  usePrefetchQuery({
    queryKey: skipQueryKeys.allAssets().queryKey,
    queryFn: async () => {
      const data = await skip.get("v2/fungible/assets").json<AllAssetsResponse>()
      for (const chainId in data.chain_to_assets_map) {
        queryClient.setQueryData(skipQueryKeys.assets(chainId).queryKey, {
          chain_to_assets_map: { [chainId]: data.chain_to_assets_map[chainId] },
        })
      }
      return data
    },
    staleTime: STALE_TIMES.MINUTE,
  })
}
