import BigNumber from "bignumber.js"
import { formatNumber } from "@initia/utils"

type FormatValueInput = Parameters<typeof formatNumber>[0]

export function formatValue(value?: FormatValueInput) {
  const absValue = value ? BigNumber(value).abs() : undefined
  if (absValue && absValue.gt(0) && absValue.lt(0.01)) return "< $0.01"

  const isNegative = value && BigNumber(value).lt(0)
  const formattedNumber = formatNumber(absValue?.toString() ?? value, { dp: 2 })

  if (!formattedNumber) return ""

  return isNegative ? `-$${formattedNumber}` : `$${formattedNumber}`
}

export function formatValueWithPrice(
  value?: FormatValueInput | null,
  price?: number | string | null,
) {
  return price == null ? "$-" : formatValue(value ?? 0)
}
