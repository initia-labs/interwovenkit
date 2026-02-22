import { formatDisplayAmountParts } from "@/lib/format"

import type { ComponentPropsWithoutRef } from "react"

interface Props extends ComponentPropsWithoutRef<"span"> {
  amount: Parameters<typeof formatDisplayAmountParts>[0]
  decimals: number
  dp?: number
}

const FormattedAmount = ({ amount, decimals, dp, ...props }: Props) => {
  const parts = formatDisplayAmountParts(amount, { decimals, dp })

  if (parts.kind === "plain") {
    return <span {...props}>{parts.value}</span>
  }

  return (
    <span {...props}>
      {parts.prefix}
      <sub>{parts.hiddenZeroCount}</sub>
      {parts.significant}
    </span>
  )
}

export default FormattedAmount
