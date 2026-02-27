import type { BalanceResponseDenomEntryJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { useMemo } from "react"
import { useSkipChains } from "../data/chains"
import type { AssetWithChain, UnifiedSearchResult } from "./types"
import { useFlatAssets } from "./useFlatAssets"

type BalanceMap = Record<string, Record<string, BalanceResponseDenomEntryJson>>

interface Params {
  query: string
  lockedChainId: string | null
  balanceMap: BalanceMap
}

const STOP_WORDS = new Set(["on", "in", "for", "from", "to", "the", "a"])

type MatchScore = {
  rank: number
  lengthDelta: number
  text: string
}

function compareMatchScore(a: MatchScore, b: MatchScore): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.lengthDelta !== b.lengthDelta) return a.lengthDelta - b.lengthDelta
  return a.text.localeCompare(b.text)
}

function pickBetterScore(a?: MatchScore, b?: MatchScore): MatchScore | undefined {
  if (!a) return b
  if (!b) return a
  return compareMatchScore(a, b) <= 0 ? a : b
}

function hasWordBoundaryPrefix(textLower: string, queryLower: string): boolean {
  return textLower
    .split(/[\s_-]+/)
    .some((segment) => segment.length > 0 && segment.startsWith(queryLower))
}

function getTextMatchScore(
  text: string,
  queryLower: string,
  fieldPriority: number,
): MatchScore | undefined {
  if (!text || !queryLower) return undefined

  const textLower = text.toLowerCase()
  const lengthDelta = Math.max(0, textLower.length - queryLower.length)

  if (textLower === queryLower) {
    return { rank: fieldPriority, lengthDelta, text: textLower }
  }

  if (textLower.startsWith(queryLower)) {
    return { rank: 10 + fieldPriority, lengthDelta, text: textLower }
  }

  if (hasWordBoundaryPrefix(textLower, queryLower)) {
    return { rank: 20 + fieldPriority, lengthDelta, text: textLower }
  }

  const includesIndex = textLower.indexOf(queryLower)
  if (includesIndex >= 0) {
    return { rank: 30 + fieldPriority + includesIndex, lengthDelta, text: textLower }
  }

  return undefined
}

export function useUnifiedSearch({
  query,
  lockedChainId,
  balanceMap,
}: Params): UnifiedSearchResult {
  const chains = useSkipChains()
  const flatAssets = useFlatAssets()

  return useMemo(() => {
    const trimmed = query.trim()

    if (!trimmed && !lockedChainId) {
      return { chains: [], assets: [] }
    }

    if (lockedChainId) {
      const filtered = flatAssets.filter((a) => a.chainId === lockedChainId)
      if (!trimmed) return { chains: [], assets: sortAssets(filtered, balanceMap) }
      const matched = filterAssets(filtered, trimmed)
      return { chains: [], assets: sortAssets(matched, balanceMap) }
    }

    const visibleChains = chains.filter((c) => !c.hidden)
    const matchedChains = filterChains(visibleChains, trimmed)
    const matchedAssets = filterAssets(flatAssets, trimmed)

    return { chains: matchedChains, assets: sortAssets(matchedAssets, balanceMap) }
  }, [query, lockedChainId, chains, flatAssets, balanceMap])
}

export function filterChains<T extends { pretty_name: string; chain_name: string }>(
  chains: T[],
  query: string,
): T[] {
  const queryLower = query.toLowerCase()
  if (!queryLower) return []

  return chains
    .map((chain) => {
      const score = pickBetterScore(
        getTextMatchScore(chain.pretty_name || chain.chain_name, queryLower, 0),
        getTextMatchScore(chain.chain_name, queryLower, 1),
      )
      if (!score) return undefined
      return { chain, score }
    })
    .filter((entry): entry is { chain: T; score: MatchScore } => !!entry)
    .sort((a, b) => {
      const byScore = compareMatchScore(a.score, b.score)
      if (byScore !== 0) return byScore
      return (a.chain.pretty_name || a.chain.chain_name)
        .toLowerCase()
        .localeCompare((b.chain.pretty_name || b.chain.chain_name).toLowerCase())
    })
    .map((entry) => entry.chain)
}

export function filterAssets(assets: AssetWithChain[], query: string): AssetWithChain[] {
  const allTokens = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
  const tokens = allTokens.length > 1 ? allTokens.filter((t) => !STOP_WORDS.has(t)) : allTokens

  if (tokens.length > 1) {
    return assets.filter((asset) => {
      const symbolLower = asset.symbol.toLowerCase()
      const nameLower = (asset.name ?? "").toLowerCase()
      const chainNameLower = asset.chainName.toLowerCase()
      return tokens.every(
        (token) =>
          symbolLower.includes(token) ||
          nameLower.includes(token) ||
          chainNameLower.includes(token),
      )
    })
  }

  const queryLower = tokens[0] ?? ""
  if (!queryLower) return []

  return assets
    .map((asset) => {
      const score = pickBetterScore(
        getTextMatchScore(asset.symbol, queryLower, 0),
        getTextMatchScore(asset.name ?? "", queryLower, 1),
      )
      if (!score) return undefined
      return { asset, score }
    })
    .filter((entry): entry is { asset: AssetWithChain; score: MatchScore } => !!entry)
    .sort((a, b) => {
      const byScore = compareMatchScore(a.score, b.score)
      if (byScore !== 0) return byScore
      return a.asset.symbol.toLowerCase().localeCompare(b.asset.symbol.toLowerCase())
    })
    .map((entry) => entry.asset)
}

export function sortAssets(assets: AssetWithChain[], balanceMap?: BalanceMap): AssetWithChain[] {
  return [...assets].sort((a, b) => {
    const aIsInit = a.symbol === "INIT" ? 1 : 0
    const bIsInit = b.symbol === "INIT" ? 1 : 0
    if (aIsInit !== bIsInit) return bIsInit - aIsInit

    const aValue = BigNumber(balanceMap?.[a.chainId]?.[a.denom]?.value_usd ?? 0)
    const bValue = BigNumber(balanceMap?.[b.chainId]?.[b.denom]?.value_usd ?? 0)
    if (!aValue.eq(bValue)) return bValue.comparedTo(aValue) ?? 0

    const aBalance = BigNumber(balanceMap?.[a.chainId]?.[a.denom]?.amount ?? 0)
    const bBalance = BigNumber(balanceMap?.[b.chainId]?.[b.denom]?.amount ?? 0)
    if (!aBalance.eq(bBalance)) return bBalance.comparedTo(aBalance) ?? 0

    return a.symbol.toLowerCase().localeCompare(b.symbol.toLowerCase())
  })
}
