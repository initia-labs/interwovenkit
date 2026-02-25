/**
 * Multiplies `a` and `b`, then divides by `c`, rounding up.
 * `c` must be non-zero; this is relied on by `sqrtPriceMath.ts`.
 */
export function mulDivRoundup(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("mulDivRoundup: denominator c must be non-zero")
  const product = a * b
  return product === 0n ? 0n : (product - 1n) / c + 1n
}

export function orderSqrtRatios(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b]
}
