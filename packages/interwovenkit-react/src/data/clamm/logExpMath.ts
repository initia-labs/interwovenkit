// TypeScript port of Move module: fixed_point64::log_exp_math (log2 only)
//
// Notes:
// - This follows the Move algorithm (log2fix) and returns:
//   - sign: 1 means non-negative result, 0 means negative result
//   - result: FixedPoint64 (raw Q64.64) magnitude with sign applied via the (sign, value) convention
// - No explicit divide-by-zero checks are added beyond what the Move code does here.
// - All constants are expressed as bigint.

import type { FixedPoint64 } from "./fixedPoint"
import { fromU128, toU128 } from "./fixedPoint"

// Raw Q64.64 constants
const ONE_RAW = 1n << 64n
const TWO_RAW = 1n << 65n
const PRECISION = 64n

/**
 * Move:
 *   public fun log2(x: FixedPoint64): (u8, FixedPoint64)
 *
 * Returns (sign, result) where:
 * - sign = 1 if x >= 1.0 (so log2(x) >= 0), else sign = 0 and result encodes a negative value
 *   using result = (y_negative - y) in raw Q64.64 (same as Move).
 */
export function log2(x: FixedPoint64): [number, FixedPoint64] {
  // Move:
  // assert!(fixed_point64::gt(&x, &fixed_point64::zero()), ERR_LOG_EXP_MATH_LOG_2_ZERO_UNBOUNDED);
  if (x <= 0n) throw new Error(`LOG_2_ZERO_UNBOUNDED`)

  // Move:
  // let z = fixed_point64::to_u128(x);
  let z: bigint = toU128(x)

  // let y: u128 = 0;
  // let y_negative: u128 = 0;
  let y = 0n
  let yNegative = 0n

  // let b: u128 = 1 << (PRECISION - 1);
  // with PRECISION=64 => b = 1<<63, but keep it symbolic
  let b = 1n << (PRECISION - 1n)

  // let i: u8 = 0;
  let i = 0n

  // let sign: u8 = 1;
  let sign: 0 | 1 = 1

  // normalize input to the range [1,2)
  // while (z >= TWO_RAW) { z >>= 1; y += ONE_RAW; }
  while (z >= TWO_RAW) {
    z >>= 1n
    y += ONE_RAW
  }

  // while (z < ONE_RAW) { sign=0; z <<= 1; y_negative += ONE_RAW; }
  while (z < ONE_RAW) {
    sign = 0
    z <<= 1n
    yNegative += ONE_RAW
  }

  // while (i < 62) { ... }
  // Move uses i<u8 and loop count 62.
  while (i < 62n) {
    // z = ((z >> 1) * (z >> 1)) >> 62;
    const zh = z >> 1n
    z = (zh * zh) >> 62n

    // if (z >= TWO_RAW) { z >>= 1; y += b; }
    if (z >= TWO_RAW) {
      z >>= 1n
      y += b
    }

    b >>= 1n
    i += 1n
  }

  // let result =
  //   if (sign > 0) from_u128(y) else from_u128(y_negative - y);
  const result = sign > 0 ? fromU128(y) : fromU128(yNegative - y)

  return [sign, result]
}
