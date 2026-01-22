import BigNumber from "bignumber.js"
import { formatNumber } from "@initia/utils"

export function formatValue(value?: Parameters<typeof formatNumber>[0]) {
  const absValue = value ? BigNumber(value).abs() : undefined
  if (absValue && absValue.gt(0) && absValue.lt(0.01)) return "< $0.01"

  const isNegative = value && BigNumber(value).lt(0)
  const formattedNumber = formatNumber(absValue?.toString() ?? value, { dp: 2 })

  if (!formattedNumber) return ""

  return isNegative ? `-$${formattedNumber}` : `$${formattedNumber}`
}
