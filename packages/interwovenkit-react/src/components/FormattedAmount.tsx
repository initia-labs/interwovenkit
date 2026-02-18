import { formatDisplayAmountParts } from "@/lib/format"

import type { ComponentPropsWithoutRef } from "react"

interface Props extends ComponentPropsWithoutRef<"span"> {
  amount: Parameters<typeof formatDisplayAmountParts>[0]
  decimals: number
  dp?: number
}

const FormattedAmount = ({ amount, decimals, dp, ...props }: Props) => {
  const { formatted, subscript } = formatDisplayAmountParts(amount, { decimals, dp })

  if (!subscript) {
    return <span {...props}>{formatted}</span>
  }

  return (
    <span {...props}>
      {subscript.prefix}
      <sub>{subscript.hiddenZeroCount}</sub>
      {subscript.significant}
    </span>
  )
}

export default FormattedAmount
