export interface ParsedSlot {
  assetText?: string
  chainText?: string
}

export interface ParsedBridgeIntent {
  amount?: string
  src: ParsedSlot
  dst: ParsedSlot
}

const ARROW_PATTERN = /\s*(?:->|→|=>)\s*/g
const AMOUNT_PATTERN = /^([\d,]+(?:\.\d+)?)\s*/
const KEYWORD_PATTERN = /\b(from|to|on)\b/gi

function clean(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

export function parseBridgeIntent(input: string): ParsedBridgeIntent {
  const src: ParsedSlot = {}
  const dst: ParsedSlot = {}
  let remaining = input.trim()

  if (!remaining) return { src, dst }

  // 1. Extract leading amount
  let amount: string | undefined
  const amountMatch = remaining.match(AMOUNT_PATTERN)
  if (amountMatch) {
    amount = amountMatch[1].replace(/,/g, "")
    remaining = remaining.slice(amountMatch[0].length)
  }

  // 2. Normalize arrow delimiters to " to "
  remaining = remaining.replace(ARROW_PATTERN, " to ")

  // 3. Split by keyword boundaries and assign to slots
  const segments: { keyword: string; text: string }[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  KEYWORD_PATTERN.lastIndex = 0
  while ((match = KEYWORD_PATTERN.exec(remaining)) !== null) {
    const before = remaining.slice(lastIndex, match.index)
    if (lastIndex === 0 && before.trim()) {
      segments.push({ keyword: "", text: clean(before) })
    } else if (before.trim()) {
      // Attach to previous segment
      const prev = segments[segments.length - 1]
      if (prev && !prev.text) {
        prev.text = clean(before)
      }
    }
    segments.push({ keyword: match[1].toLowerCase(), text: "" })
    lastIndex = match.index + match[0].length
  }

  // Remaining text after last keyword
  const tail = remaining.slice(lastIndex)
  if (tail.trim()) {
    const prev = segments[segments.length - 1]
    if (prev && !prev.text) {
      prev.text = clean(tail)
    } else {
      segments.push({ keyword: "", text: clean(tail) })
    }
  }

  // 4. Assign segments to slots
  let seenTo = false
  for (const seg of segments) {
    switch (seg.keyword) {
      case "":
        // Leading text before any keyword → src asset
        if (seg.text) src.assetText = seg.text
        break
      case "from":
        if (seg.text) src.chainText = seg.text
        break
      case "to":
        seenTo = true
        if (seg.text) dst.assetText = seg.text
        break
      case "on":
        if (seenTo && seg.text) {
          dst.chainText = seg.text
        } else if (!seenTo && seg.text) {
          src.chainText = seg.text
        }
        break
    }
  }

  // If we only have "from" but no leading text, the leading segment is the asset
  // Already handled by the "" keyword case above

  return { amount, src, dst }
}
