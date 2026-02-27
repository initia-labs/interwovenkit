import { useMemo } from "react"
import { useSkipChains } from "../data/chains"
import type { AssetWithChain } from "../search/types"
import { useFlatAssets } from "../search/useFlatAssets"
import { filterAssets, filterChains } from "../search/useUnifiedSearch"
import type { ParsedBridgeIntent } from "./parseBridgeIntent"

export interface ResolvedSlot {
  chainId?: string
  denom?: string
  decimals?: number
  chainName?: string
  assetSymbol?: string
  logoUrl?: string
  chainLogoUrl?: string
}

export interface ResolvedIntent {
  amount?: string
  src: ResolvedSlot
  dst: ResolvedSlot
  isComplete: boolean
}

function pickBestAsset(assets: AssetWithChain[]): AssetWithChain | undefined {
  return assets[0]
}

function pickBestChain<T extends { chain_id: string }>(chains: T[]): T | undefined {
  return chains[0]
}

type VisibleChain = {
  chain_id: string
  pretty_name: string
  chain_name: string
  logo_uri?: string | null
  hidden?: boolean
}

function resolveSlot(
  slotText: { assetText?: string; chainText?: string },
  flatAssets: AssetWithChain[],
  visibleChains: VisibleChain[],
): ResolvedSlot {
  const resolved: ResolvedSlot = {}

  if (slotText.assetText) {
    const matched = filterAssets(flatAssets, slotText.assetText)
    const asset = pickBestAsset(matched)
    if (asset) {
      resolved.assetSymbol = asset.symbol
      resolved.logoUrl = asset.logoUrl

      // Multi-word asset queries include chain context (e.g. "echelon iusd").
      // Use the matched asset's chain when query has multiple tokens.
      const hasMultipleTokens = slotText.assetText.trim().includes(" ")
      if (hasMultipleTokens) {
        const chain = visibleChains.find((c) => c.chain_id === asset.chainId)
        if (chain) {
          resolved.chainId = chain.chain_id
          resolved.chainName = chain.pretty_name || chain.chain_name
          resolved.chainLogoUrl = chain.logo_uri ?? ""
        }
      }
    }
  }

  if (slotText.chainText) {
    const matched = filterChains(visibleChains, slotText.chainText)
    const chain = pickBestChain(matched)
    if (chain) {
      resolved.chainId = chain.chain_id
      resolved.chainName = chain.pretty_name || chain.chain_name
      resolved.chainLogoUrl = chain.logo_uri ?? ""
    }
  }

  // Lock denom: find exact AssetWithChain matching resolved symbol + chainId
  if (resolved.assetSymbol && resolved.chainId) {
    const exact = flatAssets.find(
      (a) =>
        a.symbol.toLowerCase() === resolved.assetSymbol!.toLowerCase() &&
        a.chainId === resolved.chainId,
    )
    if (exact) {
      resolved.denom = exact.denom
      resolved.decimals = exact.decimals
      resolved.logoUrl = exact.logoUrl
    } else {
      resolved.chainId = undefined
      resolved.chainName = undefined
      resolved.chainLogoUrl = undefined
    }
  }

  return resolved
}

export function useResolveIntent(parsed: ParsedBridgeIntent): ResolvedIntent {
  const flatAssets = useFlatAssets()
  const chains = useSkipChains()

  return useMemo(() => {
    const visibleChains = chains.filter((c) => !c.hidden)

    const src = resolveSlot(parsed.src, flatAssets, visibleChains)

    // Disambiguate dst: if assetText matches a chain but not an asset, treat as chain
    const dstSlot = { ...parsed.dst }
    if (dstSlot.assetText && !dstSlot.chainText) {
      const assetMatches = filterAssets(flatAssets, dstSlot.assetText)
      const chainMatches = filterChains(visibleChains, dstSlot.assetText)
      const hasExactAsset = assetMatches.some(
        (a) => a.symbol.toLowerCase() === dstSlot.assetText!.toLowerCase(),
      )

      if (chainMatches.length > 0 && !hasExactAsset) {
        dstSlot.chainText = dstSlot.assetText
        dstSlot.assetText = undefined
      }
    }

    const dst = resolveSlot(dstSlot, flatAssets, visibleChains)

    // Default dst asset: if dst chain resolved but no dst asset, try src's symbol on dst chain
    if (dst.chainId && !dst.denom && src.assetSymbol) {
      const match = flatAssets.find(
        (a) =>
          a.symbol.toLowerCase() === src.assetSymbol!.toLowerCase() && a.chainId === dst.chainId,
      )
      if (match) {
        dst.assetSymbol = match.symbol
        dst.denom = match.denom
        dst.decimals = match.decimals
        dst.logoUrl = match.logoUrl
      }
    }

    const isComplete = !!(src.chainId && src.denom && dst.chainId && dst.denom)

    return { amount: parsed.amount, src, dst, isComplete }
  }, [parsed, flatAssets, chains])
}
