import BigNumber from "bignumber.js"
import { formatAmount } from "@initia/utils"

export interface FeeAssetInfo {
  symbol: string
  decimals: number
}

interface FeeLike {
  amount: readonly { amount: string; denom: string }[]
}

export function getFeeDp(amount: string, decimals: number): number | undefined {
  if (formatAmount(amount, { decimals }) === "0.000000") return 8
  return undefined
}

export function getFeeLabel(fee: FeeLike, findAsset: (denom: string) => FeeAssetInfo): string {
  const [{ amount, denom }] = fee.amount
  if (BigNumber(amount || 0).isZero()) return "0"
  const { symbol, decimals } = findAsset(denom)
  const dp = getFeeDp(amount, decimals)
  return `${formatAmount(amount, { decimals, dp })} ${symbol}`
}
