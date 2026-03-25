import type { FeeJson } from "@skip-go/client"
import BigNumber from "bignumber.js"

interface Params {
  sourceDenom: string
  sourceBalance?: string
  amountIn?: string
  feeTokenDenoms: string[]
  balancesByDenom?: Record<string, { amount?: string } | undefined>
  additionalFees?: FeeJson[]
}

export function shouldWarnInsufficientFeeBalance({
  sourceDenom,
  sourceBalance = "0",
  amountIn = "0",
  feeTokenDenoms,
  balancesByDenom,
  additionalFees = [],
}: Params): boolean {
  const isSourceFeeToken = feeTokenDenoms.includes(sourceDenom)
  if (!isSourceFeeToken) return false

  const hasAlternativeFeeTokenBalance = feeTokenDenoms.some((denom) => {
    if (denom === sourceDenom) return false
    const balance = balancesByDenom?.[denom]?.amount ?? "0"
    return BigNumber(balance).gt(0)
  })
  if (hasAlternativeFeeTokenBalance) return false

  const sourceFeeAmount = additionalFees.reduce((sum, fee) => {
    if (fee.origin_asset.denom !== sourceDenom) return sum
    return sum.plus(fee.amount ?? "0")
  }, BigNumber(0))
  if (sourceFeeAmount.isZero()) return false

  return BigNumber(sourceBalance).lt(BigNumber(amountIn).plus(sourceFeeAmount))
}
