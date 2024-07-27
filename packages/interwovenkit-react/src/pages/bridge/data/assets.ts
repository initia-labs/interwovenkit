import { descend } from "ramda"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import type { AssetJson } from "@skip-go/client"
import { STALE_TIMES } from "@/data/http"
import { skipQueryKeys, useSkip } from "./skip"

export interface RouterAsset extends AssetJson {
  symbol: string
  decimals: number
  logo_uri?: string
  hidden?: boolean
}

export function useSkipAssets(chainId: string) {
  const skip = useSkip()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryKey: skipQueryKeys.assets(chainId).queryKey,
    queryFn: () =>
      skip
        .get("v2/fungible/assets", { searchParams: { chain_ids: chainId } })
        .json<{ chain_to_assets_map: Partial<Record<string, { assets: RouterAsset[] }>> }>(),
    select: ({ chain_to_assets_map }) => {
      const { assets } = chain_to_assets_map[chainId] ?? { assets: [] }
      for (const asset of assets) {
        queryClient.setQueryData(skipQueryKeys.asset(chainId, asset.denom).queryKey, asset)
      }
      return assets.toSorted(descend((asset) => asset.symbol === "INIT"))
    },
    staleTime: STALE_TIMES.MINUTE,
  })
  return data
}

export function useFindSkipAsset(chainId: string) {
  const assets = useSkipAssets(chainId)
  return (denom: string) => {
    const asset = assets.find((asset) => asset.denom === denom)
    if (!asset) throw new Error(`Asset not found: ${denom}`)
    return asset
  }
}

export function useSkipAsset(denom: string, chainId: string) {
  const findSkipAsset = useFindSkipAsset(chainId)
  return findSkipAsset(denom)
}
