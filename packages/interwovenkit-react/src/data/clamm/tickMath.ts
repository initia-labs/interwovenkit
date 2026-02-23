// TypeScript port of Move module: dex_clamm_math::tick_math
//
// Notes:
// - No I64 type/module. We represent ticks as plain `bigint` (can be negative).
// - sqrt ratios are plain `bigint` (unsigned in Move, but we enforce range checks).

import {
  INV_LOG2_SQRT10001,
  MAX_LIQUIDITY,
  MAX_SQRT_RATIO,
  MAX_TICK,
  MAX_U256,
  MIN_SQRT_RATIO,
  TWO_POW_64,
  ZERO_SQRT_RATIO,
} from "./const"
import { decodeRoundDown, fromU128, mulFp } from "./fixedPoint"
import { log2 } from "./logExpMath"

// -------------------------
// getSqrtRatioAtTick
// -------------------------

/**
 * Move:
 *   public fun get_sqrt_ratio_at_tick(tick: I64): u128
 *
 * Returns sqrt(1.0001^tick) * 2^64 as an integer (u128 in Move).
 */
export function getSqrtRatioAtTick(tick: bigint): bigint {
  const absTick = tick < 0n ? -tick : tick
  if (absTick > MAX_TICK) throw new Error(`MAX_TICK`)

  // ratio is u256 in Move
  let ratio: bigint =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n

  if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n

  if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n

  if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n

  if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n

  if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n

  if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n

  if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n

  if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n

  if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n

  if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n

  if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n

  if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n

  if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n

  if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n

  if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n

  if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n

  if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n

  if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n

  // For non-negative ticks, invert: ratio = MAX_U256 / ratio
  if (tick >= 0n) {
    ratio = MAX_U256 / ratio
  }

  // Convert from 128.128 to 64.64 by dividing by 2^64, rounding up if remainder != 0
  const sqrtPrice = ratio / TWO_POW_64

  return ratio % TWO_POW_64 !== 0n ? sqrtPrice + 1n : sqrtPrice
}

// -------------------------
// getTickAtSqrtRatio
// -------------------------

/**
 * Move:
 *   public fun get_tick_at_sqrt_ratio(sqrt_price: u128): I64
 *
 * Returns the greatest tick such that getSqrtRatioAtTick(tick) <= sqrt_price.
 */
export function getTickAtSqrtRatio(sqrtPrice: bigint): bigint {
  // Move requires: sqrt_price >= MIN_SQRT_RATIO && sqrt_price < MAX_SQRT_RATIO
  if (sqrtPrice < MIN_SQRT_RATIO || sqrtPrice >= MAX_SQRT_RATIO) {
    throw new Error(`INVALID_SQRT_PRICE`)
  }

  // (_, log2SqrtPrice) = log2(from_u128(sqrt_price))
  const [, log2SqrtPrice] = log2(fromU128(sqrtPrice))

  // result = mul_fp(log2SqrtPrice, from_u128(inv_log2_sqrt10001))
  const result = mulFp(log2SqrtPrice, fromU128(INV_LOG2_SQRT10001))

  // tick_u64 = decode_round_down(result)
  const tickU64 = decodeRoundDown(result)

  let tickLow: bigint
  let tickMid: bigint
  let tickHigh: bigint

  if (tickU64 === 0n) {
    tickLow = -1n
    tickMid = 0n
    tickHigh = 1n
  } else if (sqrtPrice < ZERO_SQRT_RATIO) {
    tickLow = -tickU64 - 1n
    tickMid = -tickU64
    tickHigh = -tickU64 + 1n
  } else {
    tickLow = tickU64 - 1n
    tickMid = tickU64
    tickHigh = tickU64 + 1n
  }

  // Clamp within [minTick, maxTick]
  if (tickLow < -MAX_TICK) tickLow = -MAX_TICK
  if (tickHigh > MAX_TICK) tickHigh = MAX_TICK

  // Choose best candidate (same ordering as Move)
  if (getSqrtRatioAtTick(tickHigh) <= sqrtPrice) {
    // tick_high should be < max_tick
    if (tickHigh >= MAX_TICK) throw new Error(`GTE_MAX_TICK`)

    // Ensure tickHigh + 1 exceeds sqrtPrice
    if (getSqrtRatioAtTick(tickHigh + 1n) <= sqrtPrice) {
      throw new Error(`NO_SAFE_TICK_FOUND`)
    }

    return tickHigh
  }

  if (getSqrtRatioAtTick(tickMid) <= sqrtPrice) return tickMid
  if (getSqrtRatioAtTick(tickLow) <= sqrtPrice) return tickLow

  throw new Error(`NO_SAFE_TICK_FOUND`)
}

// -------------------------
// tickSpacingToMaxLiquidityPerTick
// -------------------------

/**
 * Move:
 *   public fun tick_spacing_to_max_liquidity_per_tick(tick_spacing: u64): u64
 *
 * Returns bigint (fits in u64 range in Move usage).
 */
export function tickSpacingToMaxLiquidityPerTick(tickSpacing: bigint): bigint {
  if (tickSpacing > MAX_TICK) throw new Error(`GT_MAX_TICK`)

  // Move:
  // min_tick = (min_tick()/tick_spacing)*tick_spacing
  // max_tick = (max_tick()/tick_spacing)*tick_spacing
  // num_ticks = ((max_tick - min_tick)/tick_spacing) + 1
  const minT = (-MAX_TICK / tickSpacing) * tickSpacing
  const maxT = (MAX_TICK / tickSpacing) * tickSpacing
  const numTicks = (maxT - minT) / tickSpacing + 1n

  // denominator uses abs_u64(num_ticks) in Move (always positive here)
  return MAX_LIQUIDITY / numTicks
}
