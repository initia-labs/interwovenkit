import { useMemo } from "react"
import { truncate } from "@initia/utils"
import { useAllSkipAssetsRaw } from "../data/assets"
import { useSkipChains } from "../data/chains"
import type { AssetWithChain } from "./types"

export function useFlatAssets(): AssetWithChain[] {
  const chains = useSkipChains()
  const {
    data: { chain_to_assets_map },
  } = useAllSkipAssetsRaw()

  return useMemo(() => {
    const result: AssetWithChain[] = []
    for (const chain of chains) {
      if (chain.hidden) continue
      const entry = chain_to_assets_map[chain.chain_id]
      if (!entry) continue
      for (const asset of entry.assets) {
        if (asset.hidden) continue
        result.push({
          denom: asset.denom,
          symbol: asset.symbol || truncate(asset.denom),
          decimals: asset.decimals ?? 0,
          logoUrl: asset.logo_uri ?? "",
          name: asset.name ?? "",
          chainId: chain.chain_id,
          chainName: chain.pretty_name || chain.chain_name,
          chainLogoUrl: chain.logo_uri ?? "",
        })
      }
    }
    return result
  }, [chains, chain_to_assets_map])
}
