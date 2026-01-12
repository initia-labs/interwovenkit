import { formatNumber } from "@initia/utils"

export function formatValue(value: number): string {
  if (value === undefined || value === null) return ""

  const numValue = Number(value)
  const absValue = Math.abs(numValue)
  const isNegative = numValue < 0

  if (absValue === 0) return `$${formatNumber(0, { dp: 2 })}`
  if (absValue < 0.01) return "< $0.01"

  const formattedValue = `$${formatNumber(absValue, { dp: 2 })}`
  return isNegative ? `-${formattedValue}` : formattedValue
}
