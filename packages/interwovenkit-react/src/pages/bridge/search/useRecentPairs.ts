import { useCallback, useMemo } from "react"
import { useLocalStorage } from "usehooks-ts"
import { LocalStorageKey } from "@/data/constants"
import { useAllSkipAssetsRaw } from "../data/assets"
import { useSkipChains } from "../data/chains"
import type { RecentPair } from "./types"

export const MAX_RECENT_PAIRS = 5

export function isSamePair(a: RecentPair, b: RecentPair): boolean {
  return (
    a.srcChainId === b.srcChainId &&
    a.srcDenom === b.srcDenom &&
    a.dstChainId === b.dstChainId &&
    a.dstDenom === b.dstDenom
  )
}

export function addPairToList(prev: RecentPair[], pair: RecentPair): RecentPair[] {
  const deduped = prev.filter((p) => !isSamePair(p, pair))
  return [pair, ...deduped].slice(0, MAX_RECENT_PAIRS)
}

export function useRecentPairs() {
  const [stored, setStored] = useLocalStorage<RecentPair[]>(LocalStorageKey.BRIDGE_RECENT_PAIRS, [])

  const chains = useSkipChains()
  const {
    data: { chain_to_assets_map },
  } = useAllSkipAssetsRaw()

  const chainIdSet = useMemo(() => {
    return new Set(chains.map((chain) => chain.chain_id))
  }, [chains])

  const assetDenomSets = useMemo(() => {
    const sets = new Map<string, Set<string>>()
    for (const chainId in chain_to_assets_map) {
      const assets = chain_to_assets_map[chainId]?.assets
      if (!assets) continue
      sets.set(chainId, new Set(assets.map((asset) => asset.denom)))
    }
    return sets
  }, [chain_to_assets_map])

  const pairs = useMemo(() => {
    return stored.filter((pair) => {
      if (!chainIdSet.has(pair.srcChainId) || !chainIdSet.has(pair.dstChainId)) return false

      const srcDenomSet = assetDenomSets.get(pair.srcChainId)
      const dstDenomSet = assetDenomSets.get(pair.dstChainId)
      if (!srcDenomSet?.has(pair.srcDenom)) return false
      if (!dstDenomSet?.has(pair.dstDenom)) return false
      return true
    })
  }, [stored, chainIdSet, assetDenomSets])

  const addPair = useCallback(
    (pair: RecentPair) => {
      setStored((prev) => addPairToList(prev, pair))
    },
    [setStored],
  )

  return { pairs, addPair }
}
