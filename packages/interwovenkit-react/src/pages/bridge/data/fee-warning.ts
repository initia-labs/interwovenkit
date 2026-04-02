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
  sourceBalance,
  amountIn,
  feeTokenDenoms,
  balancesByDenom,
  additionalFees = [],
}: Params): boolean {
  const isSourceFeeToken = feeTokenDenoms.includes(sourceDenom)
  if (!isSourceFeeToken) return false

  if (sourceBalance === undefined || amountIn === undefined || balancesByDenom === undefined) {
    return false
  }

  const feeRequirementsByDenom = additionalFees.reduce((map, fee) => {
    const denom = fee.origin_asset.denom
    const amount = map.get(denom) ?? BigNumber(0)
    map.set(denom, amount.plus(fee.amount ?? "0"))
    return map
  }, new Map<string, BigNumber>())

  const hasAlternativeFeeTokenBalance = feeTokenDenoms.some((denom) => {
    if (denom === sourceDenom) return false

    const balance = BigNumber(balancesByDenom[denom]?.amount ?? "0")
    const required = feeRequirementsByDenom.get(denom)

    // When Skip does not quote an exact alternative-token fee, fall back to a
    // coarse positive-balance check here. Exact sufficiency is validated later.
    return required ? balance.gte(required) : balance.gt(0)
  })
  if (hasAlternativeFeeTokenBalance) return false

  const sourceFeeAmount = feeRequirementsByDenom.get(sourceDenom) ?? BigNumber(0)
  if (sourceFeeAmount.isZero()) return false

  return BigNumber(sourceBalance).lt(BigNumber(amountIn).plus(sourceFeeAmount))
}
