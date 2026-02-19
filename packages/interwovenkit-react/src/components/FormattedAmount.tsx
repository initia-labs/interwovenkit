import { formatDisplayAmount } from "@/lib/format"

import type { ComponentPropsWithoutRef } from "react"

interface Props extends ComponentPropsWithoutRef<"span"> {
  amount: Parameters<typeof formatDisplayAmount>[0]
  decimals: number
  dp?: number
}

const FormattedAmount = ({ amount, decimals, dp, ...props }: Props) => {
  return <span {...props}>{formatDisplayAmount(amount, { decimals, dp })}</span>
}

export default FormattedAmount
