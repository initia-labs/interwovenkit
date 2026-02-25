import { i64FromBits } from "./const"
import { amountsForLiquidity } from "./liquidityMath"
import { getSqrtRatioAtTick } from "./tickMath"

export function calculateAsset({
  tickLower,
  tickUpper,
  liquidity,
  sqrtPrice,
}: {
  tickLower: string
  tickUpper: string
  liquidity: string
  sqrtPrice: string
}) {
  const lowerRatio = getSqrtRatioAtTick(i64FromBits(tickLower))
  const upperRatio = getSqrtRatioAtTick(i64FromBits(tickUpper))
  const amount = amountsForLiquidity(
    BigInt(sqrtPrice),
    BigInt(lowerRatio),
    BigInt(upperRatio),
    BigInt(liquidity),
  )
  return amount
}
