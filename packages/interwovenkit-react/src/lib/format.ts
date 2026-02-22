import BigNumber from "bignumber.js"
import { formatAmount as formatAmountBase, formatNumber } from "@initia/utils"

const DEFAULT_AMOUNT_DP = 6
const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"]

interface FormatAmountOptions {
  decimals: number
  dp?: number
}

function toSubscript(value: number) {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join("")
}

export type FormatDisplayAmountParts =
  | { kind: "plain"; value: string }
  | { kind: "subscript"; prefix: string; hiddenZeroCount: number; significant: string }

export function formatDisplayAmountParts(
  amount: Parameters<typeof formatAmountBase>[0],
  options: FormatAmountOptions,
): FormatDisplayAmountParts {
  const { decimals, dp } = options
  const effectiveDp = dp ?? DEFAULT_AMOUNT_DP
  const formatted =
    dp === undefined
      ? formatAmountBase(amount, { decimals })
      : formatAmountBase(amount, { decimals, dp })
  if (!formatted) return { kind: "plain", value: formatted }

  const bn = new BigNumber(String(amount))
  if (!bn.isFinite() || bn.isZero() || decimals <= 0) return { kind: "plain", value: formatted }

  const normalized = bn.abs().shiftedBy(-decimals).toFixed(decimals, BigNumber.ROUND_DOWN)
  const [, fraction = ""] = normalized.split(".")
  if (!fraction) return { kind: "plain", value: formatted }

  const hiddenPrecision = fraction.slice(effectiveDp)
  if (!/[1-9]/.test(hiddenPrecision)) return { kind: "plain", value: formatted }

  const leadingZeros = fraction.match(/^0*/)?.[0].length ?? 0
  if (leadingZeros < Math.max(effectiveDp - 1, 1)) return { kind: "plain", value: formatted }

  const significantBudget = Math.max(effectiveDp - leadingZeros, 1)
  const significant = fraction.slice(leadingZeros, leadingZeros + significantBudget)
  if (!significant) return { kind: "plain", value: formatted }

  const hiddenZeroCount = leadingZeros - 1
  const sign = bn.isNegative() ? "-" : ""
  const prefix = `${sign}0.0`

  return { kind: "subscript", prefix, hiddenZeroCount, significant }
}

export function formatDisplayAmount(
  amount: Parameters<typeof formatAmountBase>[0],
  options: FormatAmountOptions,
) {
  const parts = formatDisplayAmountParts(amount, options)
  if (parts.kind === "plain") return parts.value

  return `${parts.prefix}${toSubscript(parts.hiddenZeroCount)}${parts.significant}`
}

export function formatValue(value?: Parameters<typeof formatNumber>[0]) {
  const absValue = value ? BigNumber(value).abs() : undefined
  if (absValue && absValue.gt(0) && absValue.lt(0.01)) return "< $0.01"

  const isNegative = value && BigNumber(value).lt(0)
  const formattedNumber = formatNumber(absValue?.toString() ?? value, { dp: 2 })

  if (!formattedNumber) return ""

  return isNegative ? `-$${formattedNumber}` : `$${formattedNumber}`
}
