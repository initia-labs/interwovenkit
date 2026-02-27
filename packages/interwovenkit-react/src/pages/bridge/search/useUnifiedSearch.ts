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

function matchesText(text: string, queryLower: string): "startsWith" | "includes" | false {
  const textLower = text.toLowerCase()
  if (textLower.startsWith(queryLower)) return "startsWith"
  if (textLower.includes(queryLower)) return "includes"
  return false
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

  const startsWithMatches = chains.filter(
    (c) =>
      matchesText(c.pretty_name || c.chain_name, queryLower) === "startsWith" ||
      matchesText(c.chain_name, queryLower) === "startsWith",
  )
  if (startsWithMatches.length > 0) return startsWithMatches

  return chains.filter(
    (c) =>
      matchesText(c.pretty_name || c.chain_name, queryLower) === "includes" ||
      matchesText(c.chain_name, queryLower) === "includes",
  )
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

  const startsWithMatches = assets.filter(
    (a) =>
      matchesText(a.symbol, queryLower) === "startsWith" ||
      matchesText(a.name ?? "", queryLower) === "startsWith",
  )
  if (startsWithMatches.length > 0) return startsWithMatches

  return assets.filter(
    (a) =>
      matchesText(a.symbol, queryLower) === "includes" ||
      matchesText(a.name ?? "", queryLower) === "includes",
  )
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
