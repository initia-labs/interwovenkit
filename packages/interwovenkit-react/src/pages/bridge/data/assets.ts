import type { AssetJson } from "@skip-go/client"
import { descend } from "ramda"
import { useMemo } from "react"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import { useSkipChains } from "./chains"
import { skipQueryKeys, useSkip } from "./skip"

export interface RouterAsset extends AssetJson {
  symbol: string
  decimals: number
  logo_uri?: string
  hidden?: boolean
}

export type AllAssetsResponse = {
  chain_to_assets_map: Partial<Record<string, { assets: RouterAsset[] }>>
}

/** Fetch all assets without filtering by chains — decoupled to enable parallel prefetch */
export function useAllSkipAssetsRaw() {
  const skip = useSkip()
  return useSuspenseQuery({
    queryKey: skipQueryKeys.allAssets().queryKey,
    queryFn: () => skip.get("v2/fungible/assets").json<AllAssetsResponse>(),
    staleTime: STALE_TIMES.MINUTE,
  })
}

export function useAllSkipAssets() {
  const {
    data: { chain_to_assets_map },
  } = useAllSkipAssetsRaw()
  const chains = useSkipChains()
  const queryClient = useQueryClient()

  // Side effect in useMemo: setQueryData is idempotent and must run synchronously
  // so that useSkipAssets consumers see cached data on the same render tick.
  // Moving to useEffect would reintroduce a one-frame cache miss race condition.
  return useMemo(() => {
    const result: RouterAsset[] = []
    for (const chainId in chain_to_assets_map) {
      if (!chains.some((chain) => chain.chain_id === chainId)) continue
      const { assets } = chain_to_assets_map[chainId] ?? { assets: [] }
      queryClient.setQueryData(skipQueryKeys.assets(chainId).queryKey, {
        chain_to_assets_map: { [chainId]: chain_to_assets_map[chainId] },
      })
      for (const asset of assets) {
        queryClient.setQueryData(skipQueryKeys.asset(chainId, asset.denom).queryKey, asset)
      }
      result.push(...assets)
    }
    return result
  }, [chain_to_assets_map, chains, queryClient])
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
