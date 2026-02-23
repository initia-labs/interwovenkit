import { i64FromBits, TWO_POW_64 } from "./const"
import { getSqrtRatioAtTick } from "./tickMath"

const TWO_POW_128 = TWO_POW_64 * TWO_POW_64
const MIN_NON_ZERO_PRICE = Number.MIN_VALUE

function sqrtPriceToPrice(sqrtPrice: bigint): number {
  // sqrtPrice is Q64.64 format, so sqrtPrice^2 is Q128.128
  // price = sqrtPrice^2 / 2^128
  const priceQ128 = sqrtPrice * sqrtPrice
  const integerPart = priceQ128 / TWO_POW_128
  const fractionalPart = priceQ128 % TWO_POW_128
  // Convert to number: integer part + fractional part
  return Number(integerPart) + Number(fractionalPart) / Number(TWO_POW_128)
}

function reciprocalPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("calculateTokens: price must be finite and non-negative")
  }
  return 1 / Math.max(price, MIN_NON_ZERO_PRICE)
}

export function calculateTokens({
  tickLower,
  tickUpper,
  isReversed = false,
}: {
  tickLower: string
  tickUpper: string
  isReversed?: boolean
}) {
  const lowerRatio = getSqrtRatioAtTick(i64FromBits(tickLower))
  const upperRatio = getSqrtRatioAtTick(i64FromBits(tickUpper))

  const lowerPrice = sqrtPriceToPrice(lowerRatio)
  const upperPrice = sqrtPriceToPrice(upperRatio)

  if (isReversed) {
    return { min: reciprocalPrice(upperPrice), max: reciprocalPrice(lowerPrice) }
  }

  return { min: lowerPrice, max: upperPrice }
}
