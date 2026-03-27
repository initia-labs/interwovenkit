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
  if (BigNumber(quantity).isZero()) return false

  return BigNumber(toBaseUnit(quantity, { decimals })).gt(balance)
}
