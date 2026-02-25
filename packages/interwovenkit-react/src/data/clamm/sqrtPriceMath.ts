// TypeScript port of Move module: dex_clamm_math::sqrt_price_math
//
// Notes:
// - No I64 type/module. We represent signed liquidity_delta as plain `bigint` (can be negative).
// - u128/u64 in Move are represented as `bigint` and validated where needed.

import { TWO_POW_64 } from "./const"
import {
  addFp,
  decodeRoundDown,
  decodeRoundUp,
  divU128,
  encode,
  fromU128,
  subFp,
} from "./fixedPoint"
import { mulDivRoundup, orderSqrtRatios } from "./util"

// -------------------------
// Functions
// -------------------------

export function getNextSqrtPriceFromAmount0RoundingUp(
  sqrtPrice: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (amount === 0n) return sqrtPrice

  // numerator_1 = liquidity * 2^64
  const numerator1 = liquidity * TWO_POW_64

  // product = sqrt_price * amount
  const product = sqrtPrice * amount

  if (!add && numerator1 <= product) throw new Error(`OUT_OF_RANGE`)

  return mulDivRoundup(sqrtPrice, numerator1, add ? numerator1 + product : numerator1 - product)
}

export function getNextSqrtPriceFromAmount1RoundingDown(
  sqrtPrice: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean,
): bigint {
  if (liquidity === 0n) throw new Error(`ZERO_LIQUIDITY`)

  const numerator = add ? encode(amount) : amount * TWO_POW_64 + (liquidity - 1n)
  const quotientFp = divU128(numerator, liquidity)

  return add ? addFp(fromU128(sqrtPrice), quotientFp) : subFp(fromU128(sqrtPrice), quotientFp)
}

export function getNextSqrtPriceFromInput(
  sqrtPrice: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  return zeroForOne
    ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPrice, liquidity, amountIn, true)
    : getNextSqrtPriceFromAmount1RoundingDown(sqrtPrice, liquidity, amountIn, true)
}

export function getNextSqrtPriceFromOutput(
  sqrtPrice: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean,
): bigint {
  return zeroForOne
    ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPrice, liquidity, amountOut, false)
    : getNextSqrtPriceFromAmount0RoundingUp(sqrtPrice, liquidity, amountOut, false)
}

export function getAmount0DeltaRounded(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtRatioA === sqrtRatioB) return 0n

  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)
  if (a === 0n || b === 0n) return 0n

  const numerator1 = liquidity * TWO_POW_64
  const numerator2 = b - a

  const product = numerator1 * numerator2
  if (product === 0n) return 0n

  const denominator = a * b
  return roundUp ? (product - 1n) / denominator + 1n : product / denominator
}

export function getAmount1DeltaRounded(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtRatioA === sqrtRatioB) return 0n

  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)
  const sqrtDelta = b - a
  const amount1Required = sqrtDelta * liquidity

  return roundUp
    ? decodeRoundUp(fromU128(amount1Required))
    : decodeRoundDown(fromU128(amount1Required))
}

export function getAmount0Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidityDelta: bigint,
): bigint {
  return getAmount0DeltaRounded(
    sqrtRatioA,
    sqrtRatioB,
    liquidityDelta < 0n ? -liquidityDelta : liquidityDelta,
    liquidityDelta >= 0n,
  )
}

export function getAmount1Delta(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidityDelta: bigint,
): bigint {
  return getAmount1DeltaRounded(
    sqrtRatioA,
    sqrtRatioB,
    liquidityDelta < 0n ? -liquidityDelta : liquidityDelta,
    liquidityDelta >= 0n,
  )
}
