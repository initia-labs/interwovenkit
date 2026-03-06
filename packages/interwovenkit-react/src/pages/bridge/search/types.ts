import type { BaseAsset } from "@/components/form/types"
import type { RouterChainJson } from "../data/chains"

export interface RecentPair {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
}

export interface AssetWithChain extends BaseAsset {
  chainId: string
  chainName: string
  chainLogoUrl: string
}

export interface UnifiedSearchResult {
  chains: RouterChainJson[]
  assets: AssetWithChain[]
}
