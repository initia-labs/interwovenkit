import { useMemo } from "react"
import { useSkipChains } from "../data/chains"
import { useFlatAssets } from "../search/useFlatAssets"
import { filterAssets, filterChains } from "../search/useUnifiedSearch"

function getActiveSegmentText(input: string): string {
  const lower = input.toLowerCase()
  const keywords = [...lower.matchAll(/\b(from|to|on)\b/gi)]
  const lastKeyword = keywords[keywords.length - 1]

  if (!lastKeyword) {
    const afterAmount = input.replace(/^[\d,]+(?:\.\d+)?\s*/, "")
    return afterAmount.trim()
  }

  return input.slice(lastKeyword.index! + lastKeyword[0].length).trim()
}

function completeCaseSensitive(fullInput: string, partial: string, completion: string): string {
  const partialLower = partial.toLowerCase()
  const completionLower = completion.toLowerCase()

  if (!completionLower.startsWith(partialLower)) return ""
  if (partialLower === completionLower) return ""

  return fullInput + completion.slice(partial.length)
}

function getBestCompletion(fullInput: string, partial: string, completions: string[]): string {
  const uniqueCompletions = [...new Set(completions.filter(Boolean))]

  const candidates = uniqueCompletions
    .map((completion) => ({
      completion,
      suggestion: completeCaseSensitive(fullInput, partial, completion),
      delta: completion.length - partial.length,
    }))
    .filter((entry) => !!entry.suggestion)
    .sort((a, b) => {
      if (a.delta !== b.delta) return a.delta - b.delta
      return a.completion.toLowerCase().localeCompare(b.completion.toLowerCase())
    })

  return candidates[0]?.suggestion ?? ""
}

export function useSuggestion(input: string): string {
  const flatAssets = useFlatAssets()
  const chains = useSkipChains()

  return useMemo(() => {
    const trimmed = input.trimEnd()
    if (!trimmed) return ""

    const visibleChains = chains.filter((c) => !c.hidden)
    const activeSegmentText = getActiveSegmentText(trimmed)
    if (!activeSegmentText) return ""

    const chainCompletions = filterChains(visibleChains, activeSegmentText).map(
      (chain) => chain.pretty_name || chain.chain_name,
    )
    const assetCompletions = filterAssets(flatAssets, activeSegmentText).flatMap((asset) => [
      asset.symbol,
      `${asset.chainName} ${asset.symbol}`,
      `${asset.symbol} ${asset.chainName}`,
    ])

    return getBestCompletion(trimmed, activeSegmentText, [...chainCompletions, ...assetCompletions])
  }, [input, flatAssets, chains])
}
