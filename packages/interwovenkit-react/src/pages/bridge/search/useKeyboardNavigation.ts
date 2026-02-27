import { useCallback, useEffect, useRef, useState } from "react"

import type { KeyboardEvent } from "react"

interface Params {
  itemCount: number
  onSelect: (index: number) => void
  onEscape: () => void
  onBackspace?: () => void
  inputEmpty?: boolean
}

export function useKeyboardNavigation({
  itemCount,
  onSelect,
  onEscape,
  onBackspace,
  inputEmpty,
}: Params) {
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll("[data-search-item]")
    items[highlightIndex]?.scrollIntoView({ block: "nearest" })
  }, [highlightIndex])

  const resetHighlight = useCallback(() => setHighlightIndex(-1), [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (itemCount === 0) {
        if (e.key === "Escape") {
          e.preventDefault()
          onEscape()
        }
        if (e.key === "Backspace" && inputEmpty && onBackspace) {
          onBackspace()
        }
        return
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setHighlightIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0))
          break
        case "ArrowUp":
          e.preventDefault()
          setHighlightIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1))
          break
        case "Enter":
          e.preventDefault()
          if (highlightIndex >= 0) onSelect(highlightIndex)
          break
        case "Escape":
          e.preventDefault()
          onEscape()
          break
        case "Backspace":
          if (inputEmpty && onBackspace) onBackspace()
          break
      }
    },
    [itemCount, highlightIndex, onSelect, onEscape, onBackspace, inputEmpty],
  )

  return { highlightIndex, handleKeyDown, resetHighlight, listRef }
}
