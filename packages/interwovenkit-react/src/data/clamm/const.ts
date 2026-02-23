export const TWO_POW_64 = 1n << 64n
const TWO_POW_63 = 1n << 63n
export const MAX_U128 = (1n << 128n) - 1n

/**
 * Decode a Move I64 `bits` field (u64 two's complement) into a signed bigint.
 *
 * Move's I64 type stores signed integers as a u64 `bits` field.
 * Positive values are stored as-is, but negative values are encoded as
 * 2^64 - |value| (two's complement), so the API returns them as very
 * large unsigned integers.
 *
 * Example:
 *   tick  443600  → bits = "443600"                (positive, unchanged)
 *   tick -443600  → bits = "18446744073709108016"   (2^64 - 443600)
 *
 * Without decoding, BigInt("18446744073709108016") would far exceed
 * MAX_TICK (443636) and cause runtime errors in tick math functions.
 */
export function i64FromBits(bits: string): bigint {
  const v = BigInt(bits)
  return v >= TWO_POW_63 ? v - TWO_POW_64 : v
}
export const MAX_U256 = (1n << 256n) - 1n
export const MAX_TICK = 443636n
export const MIN_SQRT_RATIO = 4295048017n
export const ZERO_SQRT_RATIO = 18446744073709551616n
export const MAX_SQRT_RATIO = 79226673515401279992447579062n
export const INV_LOG2_SQRT10001 = 255738958999603826347141n
export const MAX_LIQUIDITY = 40924101727524640255659n

export function isFullRange(tickLower: string, tickUpper: string, tickSpacing: number): boolean {
  const minTick = Number(i64FromBits(tickLower))
  const maxTick = Number(i64FromBits(tickUpper))
  const fullRangeMin = Math.floor(-Number(MAX_TICK) / tickSpacing) * tickSpacing
  const fullRangeMax = Math.floor(Number(MAX_TICK) / tickSpacing) * tickSpacing
  return minTick === fullRangeMin && maxTick === fullRangeMax
}
