import { useMemo } from "react"
import { useSkipChains } from "../data/chains"
import { useFlatAssets } from "../search/useFlatAssets"
import { filterAssets, filterChains } from "../search/useUnifiedSearch"

type SegmentType = "asset" | "chain" | "dstAmbiguous"

function getActiveSegment(input: string): { type: SegmentType; text: string } {
  const lower = input.toLowerCase()
  const keywords = [...lower.matchAll(/\b(from|to|on)\b/gi)]
  const lastKeyword = keywords[keywords.length - 1]

  if (!lastKeyword) {
    const afterAmount = input.replace(/^[\d,]+(?:\.\d+)?\s*/, "")
    return { type: "asset", text: afterAmount.trim() }
  }

  const keyword = lastKeyword[1].toLowerCase()
  const textAfter = input.slice(lastKeyword.index! + lastKeyword[0].length).trim()

  if (!textAfter) return { type: "asset", text: "" }

  switch (keyword) {
    case "from":
    case "on":
      return { type: "chain", text: textAfter }
    case "to":
      return { type: "dstAmbiguous", text: textAfter }
    default:
      return { type: "asset", text: textAfter }
  }
}

function completeCaseSensitive(fullInput: string, partial: string, completion: string): string {
  const partialLower = partial.toLowerCase()
  const completionLower = completion.toLowerCase()

  if (!completionLower.startsWith(partialLower)) return ""
  if (partialLower === completionLower) return ""

  return fullInput + completion.slice(partial.length)
}

export function useSuggestion(input: string): string {
  const flatAssets = useFlatAssets()
  const chains = useSkipChains()

  return useMemo(() => {
    const trimmed = input.trimEnd()
    if (!trimmed) return ""

    const visibleChains = chains.filter((c) => !c.hidden)
    const activeSegment = getActiveSegment(trimmed)
    if (!activeSegment.text) return ""

    if (activeSegment.type === "asset") {
      const matched = filterAssets(flatAssets, activeSegment.text)
      if (matched.length === 0) return ""
      return completeCaseSensitive(trimmed, activeSegment.text, matched[0].symbol)
    }

    if (activeSegment.type === "chain") {
      const matched = filterChains(visibleChains, activeSegment.text)
      if (matched.length === 0) return ""
      const name = matched[0].pretty_name || matched[0].chain_name
      return completeCaseSensitive(trimmed, activeSegment.text, name)
    }

    // Ambiguous dst — try chain first, then asset
    if (activeSegment.type === "dstAmbiguous") {
      const chainMatched = filterChains(visibleChains, activeSegment.text)
      if (chainMatched.length > 0) {
        const name = chainMatched[0].pretty_name || chainMatched[0].chain_name
        return completeCaseSensitive(trimmed, activeSegment.text, name)
      }
      const assetMatched = filterAssets(flatAssets, activeSegment.text)
      if (assetMatched.length > 0) {
        return completeCaseSensitive(trimmed, activeSegment.text, assetMatched[0].symbol)
      }
    }

    return ""
  }, [input, flatAssets, chains])
}
