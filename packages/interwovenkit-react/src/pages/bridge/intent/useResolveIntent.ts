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
  errorMessage?: string
}

type VisibleChain = {
  chain_id: string
  pretty_name: string
  chain_name: string
  logo_uri?: string | null
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase()
}

function pickBestAsset(assets: AssetWithChain[]): AssetWithChain | undefined {
  return assets[0]
}

function pickBestChain(chains: VisibleChain[]): VisibleChain | undefined {
  return chains[0]
}

function findExactChain(chains: VisibleChain[], text: string): VisibleChain | undefined {
  const normalized = normalizeText(text)
  if (!normalized) return undefined

  return chains.find((chain) => {
    const prettyName = normalizeText(chain.pretty_name || "")
    const chainName = normalizeText(chain.chain_name || "")
    return prettyName === normalized || chainName === normalized
  })
}

function findExactAssetSymbol(assets: AssetWithChain[], text: string): string | undefined {
  const normalized = normalizeText(text)
  if (!normalized) return undefined

  const symbolMatch = assets.find((asset) => normalizeText(asset.symbol) === normalized)
  if (symbolMatch) return symbolMatch.symbol

  const nameMatch = assets.find((asset) => normalizeText(asset.name ?? "") === normalized)
  return nameMatch?.symbol
}

function findAssetOnChain(
  assets: AssetWithChain[],
  chainId: string,
  symbol: string,
): AssetWithChain | undefined {
  const normalizedSymbol = normalizeText(symbol)
  return assets.find(
    (asset) => asset.chainId === chainId && normalizeText(asset.symbol) === normalizedSymbol,
  )
}

function setChain(slot: ResolvedSlot, chain: VisibleChain): void {
  slot.chainId = chain.chain_id
  slot.chainName = chain.pretty_name || chain.chain_name
  slot.chainLogoUrl = chain.logo_uri ?? ""
}

function setAssetIdentity(slot: ResolvedSlot, asset: AssetWithChain): void {
  slot.assetSymbol = asset.symbol
  slot.logoUrl = asset.logoUrl
}

function setAssetOnChain(slot: ResolvedSlot, asset: AssetWithChain): void {
  slot.assetSymbol = asset.symbol
  slot.denom = asset.denom
  slot.decimals = asset.decimals
  slot.logoUrl = asset.logoUrl
}

function clearChain(slot: ResolvedSlot): void {
  slot.chainId = undefined
  slot.chainName = undefined
  slot.chainLogoUrl = undefined
}

function getChainCandidateFromFreeText(
  text: string,
  visibleChains: VisibleChain[],
  flatAssets: AssetWithChain[],
): VisibleChain | undefined {
  if (text.trim().includes(" ")) return undefined

  const chainCandidate = pickBestChain(filterChains(visibleChains, text))
  const hasExactAsset = !!findExactAssetSymbol(flatAssets, text)
  if (!chainCandidate || hasExactAsset) return undefined

  return chainCandidate
}

export function getUnavailablePairMessage(
  slotText: { assetText?: string; chainText?: string },
  flatAssets: AssetWithChain[],
  visibleChains: VisibleChain[],
): string | undefined {
  if (!slotText.assetText || !slotText.chainText) return undefined

  const chain = findExactChain(visibleChains, slotText.chainText)
  const symbol = findExactAssetSymbol(flatAssets, slotText.assetText)
  if (!chain || !symbol) return undefined

  const existsOnChain = !!findAssetOnChain(flatAssets, chain.chain_id, symbol)
  if (existsOnChain) return undefined

  return `${symbol} is not available on ${chain.pretty_name || chain.chain_name}`
}

function tryLockAssetOnChain(slot: ResolvedSlot, flatAssets: AssetWithChain[]): void {
  if (!slot.assetSymbol || !slot.chainId) return

  const exact = findAssetOnChain(flatAssets, slot.chainId, slot.assetSymbol)
  if (exact) {
    setAssetOnChain(slot, exact)
    return
  }

  clearChain(slot)
}

function resolveSlot(
  slotText: { assetText?: string; chainText?: string },
  flatAssets: AssetWithChain[],
  visibleChains: VisibleChain[],
): ResolvedSlot {
  const resolved: ResolvedSlot = {}

  const chainFromFreeText =
    slotText.assetText && !slotText.chainText
      ? getChainCandidateFromFreeText(slotText.assetText, visibleChains, flatAssets)
      : undefined

  if (slotText.assetText && !chainFromFreeText) {
    const asset = pickBestAsset(filterAssets(flatAssets, slotText.assetText))
    if (asset) {
      setAssetIdentity(resolved, asset)

      if (slotText.assetText.trim().includes(" ")) {
        const chain = visibleChains.find((item) => item.chain_id === asset.chainId)
        if (chain) setChain(resolved, chain)
      }
    }
  }

  if (slotText.chainText) {
    const chain = pickBestChain(filterChains(visibleChains, slotText.chainText))
    if (chain) setChain(resolved, chain)
  }

  if (slotText.assetText && !slotText.chainText) {
    const chain =
      chainFromFreeText ?? pickBestChain(filterChains(visibleChains, slotText.assetText))
    const hasExactChain = !!findExactChain(visibleChains, slotText.assetText)
    const hasExactAsset = !!findExactAssetSymbol(flatAssets, slotText.assetText)

    if (chain && ((hasExactChain && !hasExactAsset) || !resolved.assetSymbol)) {
      setChain(resolved, chain)
    }
  }

  if (!resolved.assetSymbol && slotText.chainText && slotText.chainText.trim().includes(" ")) {
    const candidate = pickBestAsset(filterAssets(flatAssets, slotText.chainText))
    if (candidate) {
      const exactOnResolvedChain = resolved.chainId
        ? findAssetOnChain(flatAssets, resolved.chainId, candidate.symbol)
        : undefined
      const chosen = exactOnResolvedChain ?? candidate

      setAssetIdentity(resolved, chosen)

      if (!resolved.chainId) {
        const chain = visibleChains.find((item) => item.chain_id === chosen.chainId)
        if (chain) setChain(resolved, chain)
      }
    }
  }

  tryLockAssetOnChain(resolved, flatAssets)
  return resolved
}

function normalizeDstSlot(
  parsed: ParsedBridgeIntent,
  flatAssets: AssetWithChain[],
  visibleChains: VisibleChain[],
): { assetText?: string; chainText?: string } {
  const dstSlot = { ...parsed.dst }
  if (!dstSlot.assetText || dstSlot.chainText) return dstSlot

  const dstAssetText = dstSlot.assetText
  const hasExactAssetSymbol = flatAssets.some(
    (asset) => normalizeText(asset.symbol) === normalizeText(dstAssetText),
  )
  const hasChainMatch = filterChains(visibleChains, dstAssetText).length > 0

  if (hasChainMatch && !hasExactAssetSymbol) {
    dstSlot.chainText = dstSlot.assetText
    dstSlot.assetText = undefined
  }

  return dstSlot
}

export function resolveIntent(
  parsed: ParsedBridgeIntent,
  flatAssets: AssetWithChain[],
  visibleChains: VisibleChain[],
): ResolvedIntent {
  const src = resolveSlot(parsed.src, flatAssets, visibleChains)
  const dstSlot = normalizeDstSlot(parsed, flatAssets, visibleChains)
  const dst = resolveSlot(dstSlot, flatAssets, visibleChains)

  if (!dst.chainId && dstSlot.assetText && src.chainId) {
    dst.chainId = src.chainId
    dst.chainName = src.chainName
    dst.chainLogoUrl = src.chainLogoUrl
  }

  if (dst.chainId && dst.assetSymbol && !dst.denom) {
    const match = findAssetOnChain(flatAssets, dst.chainId, dst.assetSymbol)
    if (match) setAssetOnChain(dst, match)
  }

  if (dst.chainId && !dstSlot.assetText && !dst.denom && src.assetSymbol) {
    const match = findAssetOnChain(flatAssets, dst.chainId, src.assetSymbol)
    if (match) setAssetOnChain(dst, match)
  }

  const sameChainUnavailable =
    src.chainName && dstSlot.assetText && !dstSlot.chainText
      ? getUnavailablePairMessage(
          { assetText: dstSlot.assetText, chainText: src.chainName },
          flatAssets,
          visibleChains,
        )
      : undefined

  const errorMessage =
    getUnavailablePairMessage(parsed.src, flatAssets, visibleChains) ??
    getUnavailablePairMessage(dstSlot, flatAssets, visibleChains) ??
    sameChainUnavailable

  const isComplete = !!(src.chainId && src.denom && dst.chainId && dst.denom)

  return {
    amount: parsed.amount,
    src,
    dst,
    isComplete,
    errorMessage,
  }
}

export function useResolveIntent(parsed: ParsedBridgeIntent): ResolvedIntent {
  const flatAssets = useFlatAssets()
  const chains = useSkipChains()

  return useMemo(() => {
    const visibleChains = chains.filter((chain) => !chain.hidden)
    return resolveIntent(parsed, flatAssets, visibleChains)
  }, [parsed, flatAssets, chains])
}
