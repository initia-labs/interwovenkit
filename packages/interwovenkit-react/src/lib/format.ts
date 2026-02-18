import BigNumber from "bignumber.js"
import { formatAmount as formatAmountBase, formatNumber } from "@initia/utils"

const DEFAULT_AMOUNT_DP = 6
const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"]

interface FormatAmountOptions {
  decimals: number
  dp?: number
}

interface SubscriptParts {
  prefix: string
  hiddenZeroCount: number
  significant: string
}

interface DisplayAmountParts {
  formatted: string
  subscript?: SubscriptParts
}

function toSubscript(value: number) {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join("")
}

function getDisplayAmountParts(
  amount: Parameters<typeof formatAmountBase>[0],
  options: FormatAmountOptions,
): DisplayAmountParts {
  const { decimals, dp } = options
  const effectiveDp = dp ?? DEFAULT_AMOUNT_DP
  const formatted =
    dp === undefined
      ? formatAmountBase(amount, { decimals })
      : formatAmountBase(amount, { decimals, dp })
  if (!formatted) return { formatted }

  const bn = new BigNumber(String(amount))
  if (!bn.isFinite() || bn.isZero() || decimals <= 0) return { formatted }

  const normalized = bn.abs().shiftedBy(-decimals).toFixed(decimals, BigNumber.ROUND_DOWN)
  const [, fraction = ""] = normalized.split(".")
  if (!fraction) return { formatted }

  const hiddenPrecision = fraction.slice(effectiveDp)
  if (!/[1-9]/.test(hiddenPrecision)) return { formatted }

  const leadingZeros = fraction.match(/^0*/)?.[0].length ?? 0
  if (leadingZeros < Math.max(effectiveDp - 1, 1)) return { formatted }

  const significantBudget = Math.max(effectiveDp - leadingZeros, 1)
  const significant = fraction.slice(leadingZeros, leadingZeros + significantBudget)
  if (!significant) return { formatted }

  const hiddenZeroCount = leadingZeros - 1
  const sign = bn.isNegative() ? "-" : ""
  const prefix = `${sign}0.0`

  return {
    formatted,
    subscript: {
      prefix,
      hiddenZeroCount,
      significant,
    },
  }
}

export function formatDisplayAmount(
  amount: Parameters<typeof formatAmountBase>[0],
  options: FormatAmountOptions,
) {
  const { formatted, subscript } = getDisplayAmountParts(amount, options)
  if (!subscript) return formatted
  return `${subscript.prefix}${toSubscript(subscript.hiddenZeroCount)}${subscript.significant}`
}

export function formatValue(value?: Parameters<typeof formatNumber>[0]) {
  const absValue = value ? BigNumber(value).abs() : undefined
  if (absValue && absValue.gt(0) && absValue.lt(0.01)) return "< $0.01"

  const isNegative = value && BigNumber(value).lt(0)
  const formattedNumber = formatNumber(absValue?.toString() ?? value, { dp: 2 })

  if (!formattedNumber) return ""

  return isNegative ? `-$${formattedNumber}` : `$${formattedNumber}`
}
