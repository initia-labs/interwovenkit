import BigNumber from "bignumber.js"
import { formatNumber } from "@initia/utils"

export function formatValue(value?: Parameters<typeof formatNumber>[0]) {
  if (value && BigNumber(value).gt(0) && BigNumber(value).lt(0.01)) return "<$0.01"
  const formattedNumber = formatNumber(value, { dp: 2 })
  if (!formattedNumber) return ""
  return `$${formattedNumber}`
}
