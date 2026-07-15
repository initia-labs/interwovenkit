import { useMemo } from "react"
import { useAllSkipAssetsRaw } from "@/pages/bridge/data/assets"
import { useDepositRoutes } from "./assets"
import { fallbackAssetSymbol } from "./source"
import type { Asset } from "./types"

export interface SourceAssetLookup {
  /** Display symbol for a (source chain, denom) pair; falls back to a derived label. */
  symbol: (chainId: string, denom: string) => string
  /** Logo URL for a (source chain, denom) pair; "" when the Router lacks an entry. */
  logoUrl: (chainId: string, denom: string) => string
}

/**
 * Resolves source-asset display metadata (symbol, logo) from the Router (Skip)
 * across ALL chains. Deposit routes span multiple source chains (the same
 * logical asset has a different src_denom per chain), so the per-chain
 * useSkipAssets cannot cover them; the all-chains asset map can.
 */
export function useSourceAssetLookup(): SourceAssetLookup {
  const {
    data: { chain_to_assets_map },
  } = useAllSkipAssetsRaw()

  return useMemo(() => {
    const find = (chainId: string, denom: string) =>
      chain_to_assets_map[chainId]?.assets.find((asset) => asset.denom === denom)
    return {
      symbol: (chainId, denom) => find(chainId, denom)?.symbol ?? fallbackAssetSymbol(denom),
      logoUrl: (chainId, denom) => find(chainId, denom)?.logo_uri ?? "",
    }
  }, [chain_to_assets_map])
}

/** A source asset grouped across source chains, identified by display symbol. */
export interface SourceAssetOption {
  symbol: string
  logoUrl: string
  /** The routes carrying this asset, one per source chain. */
  routes: Asset[]
}

/**
 * Source-asset options for a destination, grouped by display symbol (the
 * deposit-address screen shows the first option display-only and picks among
 * that asset's chains). First-seen order is kept.
 */
export function useSourceAssetOptions(chainId: string, assetDenom: string): SourceAssetOption[] {
  const routes = useDepositRoutes(chainId, assetDenom)
  const lookup = useSourceAssetLookup()

  return useMemo(() => {
    const bySymbol = new Map<string, SourceAssetOption>()
    for (const route of routes) {
      const symbol = lookup.symbol(route.src_chain_id, route.src_denom)
      const existing = bySymbol.get(symbol)
      if (existing) {
        existing.routes.push(route)
      } else {
        bySymbol.set(symbol, {
          symbol,
          logoUrl: lookup.logoUrl(route.src_chain_id, route.src_denom),
          routes: [route],
        })
      }
    }
    return [...bySymbol.values()]
  }, [routes, lookup])
}
