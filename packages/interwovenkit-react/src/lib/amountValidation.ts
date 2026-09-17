import BigNumber from "bignumber.js"
import { toBaseUnit } from "@initia/utils"

// BigNumber strict mode (default in v10+) throws on invalid input like "." or
// "abc". User-typed amounts can briefly hold incomplete decimals while the
// user is mid-input, so callers need a non-throwing way to construct the
// value. Returns null for empty/invalid/non-finite input.
export const parseQuantity = (quantity?: string | null): BigNumber | null => {
  if (!quantity) return null
  try {
    const bn = BigNumber(quantity)
    return bn.isFinite() ? bn : null
  } catch {
    return null
  }
}

// Mirrors `isIntegerString` in the Deposit API parsers, inlined so this module stays free of
// feature imports. "" when the input cannot be represented (empty, non-numeric, negative):
// no JavaScript `Number` touches the value, since an amount past 2^53 base units would lose
// precision.
export const toBaseUnitString = (quantity: string, decimals: number): string => {
  const base = toBaseUnit(quantity, { decimals })
  return /^\d+$/.test(base) ? base : ""
}

export const isInsufficientBalance = ({
  quantity,
  balance,
  decimals,
}: {
  quantity?: string
  balance?: string
  decimals?: number
}) => {
  if (!quantity || balance === undefined || decimals === undefined) return false

  // toBaseUnit returns "" for unparseable input (e.g. "abc"); treat that as
  // "not insufficient" so the upstream form validator owns the error message.
  const baseAmount = toBaseUnit(quantity, { decimals })
  if (!baseAmount || BigNumber(baseAmount).isZero()) return false

  return BigNumber(baseAmount).gt(balance || 0)
}
