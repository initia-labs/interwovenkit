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

export function sortSkipAssets(assets: RouterAsset[]) {
  return assets.toSorted(descend((asset) => asset.symbol === "INIT"))
}

/** Fetch all assets without chains dependency so prefetch can run parallel to chains fetch */
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
  const assets = useAllSkipAssets()
  return useMemo(
    () => sortSkipAssets(assets.filter((asset) => asset.chain_id === chainId)),
    [assets, chainId],
  )
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
