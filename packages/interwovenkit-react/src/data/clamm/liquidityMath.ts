// TypeScript port of the provided Move liquidity math helpers.
//
// Assumptions / conventions (matching your existing ports):
// - No I64 module: signed liquidity is represented as `bigint` (negative allowed).
// - u64/u128/u256 in Move are represented as `bigint`.

import { decodeRoundDown, divFp, encode, fromU128 } from "./fixedPoint"
import { getAmount0Delta, getAmount1Delta } from "./sqrtPriceMath"
import { getSqrtRatioAtTick } from "./tickMath"
import { orderSqrtRatios } from "./util"

// -------------------------
// liquidity_for_amount_0
// -------------------------

/**
 * Move:
 *   liquidity_for_amount_0(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount_0: u64): u64
 *
 * Computes amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower))
 * and always rounds DOWN (decode_round_down).
 */
export function liquidityForAmount0(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  amount0: bigint,
): bigint {
  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)
  if (a === b) return 0n

  const numerator = a * b
  const diff = b - a

  // always round down
  const q64_64 = (numerator * amount0) / diff
  return decodeRoundDown(fromU128(q64_64))
}

// -------------------------
// liquidity_for_amount_1
// -------------------------

/**
 * Move:
 *   liquidity_for_amount_1(sqrt_ratio_a: u128, sqrt_ratio_b: u128, amount_1: u64): u64
 *
 * Computes amount1 / (sqrt(upper) - sqrt(lower)) in Q64.64, then rounds DOWN.
 */
export function liquidityForAmount1(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  amount1: bigint,
): bigint {
  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)
  if (a === b) return 0n

  const diff = b - a
  const fp = divFp(encode(amount1), fromU128(diff))
  return decodeRoundDown(fp)
}

// -------------------------
// liquidity_for_amounts
// -------------------------

/**
 * Move:
 *   liquidity_for_amounts(
 *     sqrt_ratio: u128, sqrt_ratio_a: u128, sqrt_ratio_b: u128,
 *     amount_0: u64, amount_1: u64
 *   ): u64
 */
export function liquidityForAmounts(
  sqrtRatio: bigint,
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)

  if (sqrtRatio <= a) {
    return liquidityForAmount0(a, b, amount0)
  }

  if (sqrtRatio < b) {
    const l0 = liquidityForAmount0(sqrtRatio, b, amount0)
    const l1 = liquidityForAmount1(a, sqrtRatio, amount1)
    return l0 < l1 ? l0 : l1
  }

  return liquidityForAmount1(a, b, amount1)
}

// -------------------------
// amount_0_for_liquidity / amount_1_for_liquidity
// -------------------------

/**
 * Move:
 *   amount_0_for_liquidity(..., liquidity_u64: u64, liquidity_is_neg: bool): u64
 *
 * In TS: liquidityDelta is signed bigint derived from (liquidity_is_neg ? -liq : +liq).
 */
export function amount0ForLiquidity(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidityDelta: bigint,
): bigint {
  return getAmount0Delta(sqrtRatioA, sqrtRatioB, liquidityDelta)
}

export function amount1ForLiquidity(
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidityDelta: bigint,
): bigint {
  return getAmount1Delta(sqrtRatioA, sqrtRatioB, liquidityDelta)
}

// -------------------------
// amounts_for_liquidity (+ internal)
// -------------------------

export function amountsForLiquidity(
  sqrtRatio: bigint,
  sqrtRatioA: bigint,
  sqrtRatioB: bigint,
  liquidityDelta: bigint,
): [bigint, bigint] {
  const [a, b] = orderSqrtRatios(sqrtRatioA, sqrtRatioB)

  if (sqrtRatio < a) {
    return [getAmount0Delta(a, b, liquidityDelta), 0n]
  }

  if (sqrtRatio < b) {
    return [
      getAmount0Delta(sqrtRatio, b, liquidityDelta),
      getAmount1Delta(a, sqrtRatio, liquidityDelta),
    ]
  }

  return [0n, getAmount1Delta(a, b, liquidityDelta)]
}

// -------------------------
// quote_at_tick
// -------------------------

/**
 * Move:
 *   quote_at_tick(zero_for_one: bool, base_amount: u64, tick: u64, tick_neg: bool): u64
 *
 * Notes:
 * - tick is passed as (tick, tick_neg) in Move; we map to signed bigint tickSigned.
 * - ratio_u128 is computed as (sqrt_ratio^2 >> 64) (Q64.64).
 */
export function quoteAtTick(
  zeroForOne: boolean,
  baseAmount: bigint,
  tick: bigint,
  tickNeg: boolean,
): bigint {
  const sqrtRatio = getSqrtRatioAtTick(tickNeg ? -tick : tick)

  // ratio in Q64.64
  const ratioQ64_64 = (sqrtRatio * sqrtRatio) >> 64n
  return zeroForOne ? (ratioQ64_64 * baseAmount) >> 64n : (baseAmount << 64n) / ratioQ64_64
}

// -------------------------
// get_add_liquidity_amounts_from_amount
// -------------------------

/**
 * Move:
 *   get_add_liquidity_amounts_from_amount(
 *     tick_lower: u64, tick_lower_is_neg: bool,
 *     tick_upper: u64, tick_upper_is_neg: bool,
 *     amount: u64, is_in_0: bool
 *   ): (u64, u64, u64)
 *
 * Note:
 * - In Move this calls pool::sqrt_price_at_tick; here we use tickMath.getSqrtRatioAtTick directly.
 * - Returns [amount0, amount1, liquidity]
 */
export function getAddLiquidityAmountsFromAmount(
  tickLower: bigint,
  tickUpper: bigint,
  amount: bigint,
  isIn0: boolean,
): [bigint, bigint, bigint] {
  const sqrtLower = getSqrtRatioAtTick(tickLower)
  const sqrtUpper = getSqrtRatioAtTick(tickUpper)

  if (isIn0) {
    const liquidity = liquidityForAmount0(sqrtLower, sqrtUpper, amount)
    const amount1 = amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity)
    return [amount, amount1, liquidity]
  } else {
    const liquidity = liquidityForAmount1(sqrtLower, sqrtUpper, amount)
    const amount0 = amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity)
    return [amount0, amount, liquidity]
  }
}
