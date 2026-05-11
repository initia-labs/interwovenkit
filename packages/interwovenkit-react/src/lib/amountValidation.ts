import BigNumber from "bignumber.js"
import { toBaseUnit } from "@initia/utils"

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
