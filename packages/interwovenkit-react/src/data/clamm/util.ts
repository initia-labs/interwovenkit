export function mulDivRoundup(a: bigint, b: bigint, c: bigint): bigint {
  const product = a * b
  return product === 0n ? 0n : (product - 1n) / c + 1n
}

export function orderSqrtRatios(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b]
}
