import { formatDisplayAmountParts, formatDisplayAmountPlainText, toSubscript } from "@/lib/format"

import type { ComponentPropsWithoutRef, CSSProperties } from "react"

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap" as const,
  border: 0,
}

interface Props extends ComponentPropsWithoutRef<"span"> {
  amount: Parameters<typeof formatDisplayAmountParts>[0]
  decimals: number
  dp?: number
}

const FormattedAmount = ({ amount, decimals, dp, "aria-label": ariaLabel, ...props }: Props) => {
  const parts = formatDisplayAmountParts(amount, { decimals, dp })

  if (parts.kind === "plain") {
    return (
      <span {...props} aria-label={ariaLabel}>
        {parts.value}
      </span>
    )
  }

  const accessibleValue = formatDisplayAmountPlainText(parts)

  return (
    <span {...props}>
      <span style={VISUALLY_HIDDEN_STYLE}>{ariaLabel ?? accessibleValue}</span>
      <span aria-hidden="true">
        {parts.prefix}
        {toSubscript(parts.hiddenZeroCount)}
        {parts.significant}
      </span>
    </span>
  )
}

export default FormattedAmount
