// TypeScript port of Move module: fixed_point64::fixed_point64
// Representation: FixedPoint64 is stored as raw Q64.64 in bigint (same as Move's u128 v field).

import { MAX_U128, TWO_POW_64 } from "./const"

export type FixedPoint64 = bigint

// -------------------------
// Constructors / conversions
// -------------------------

// Encode u64 into Q64.64
export function encode(x: bigint): FixedPoint64 {
  if (x < 0n) throw new Error("INPUT_OUT_OF_RANGE")
  // Caller should ensure 0 <= x <= 2^64-1 if strict parity is required.
  return x << 64n
}

// Decode Q64.64 into u64 by rounding to nearest integer (ties round up because of bit check)
export function decode(fp: FixedPoint64): bigint {
  const a = fp >> 64n
  const vShifted = fp >> 63n
  // Equivalent to "if (fp.v & (1<<63) != 0) a++" but without '&', matching Move's approach.
  return vShifted % 2n === 1n ? a + 1n : a
}

// Decode by rounding down (floor for non-negative values)
export function decodeRoundDown(fp: FixedPoint64): bigint {
  return fp >> 64n
}

// Decode by rounding up for non-negative values
export function decodeRoundUp(fp: FixedPoint64): bigint {
  const a = fp >> 64n
  // fp.v - (fp.v / 2^64) * 2^64 > 0  <=> fp % 2^64 > 0
  return fp % TWO_POW_64 !== 0n ? a + 1n : a
}

// Raw accessors
export function toU128(fp: FixedPoint64): bigint {
  return fp
}

export function fromU128(v: bigint): FixedPoint64 {
  if (v < 0n || v > MAX_U128) throw new Error("INPUT_OUT_OF_RANGE")
  // Caller should ensure 0 <= v <= 2^128-1 if strict parity is required.
  return v
}

// Constants
export function one(): FixedPoint64 {
  return TWO_POW_64
}

export function zero(): FixedPoint64 {
  return 0n
}

// -------------------------
// Basic ops with integer scalars
// -------------------------

// Multiply FixedPoint64 by u64
export function mul(fp: FixedPoint64, y: bigint): FixedPoint64 {
  // In Move, overflow aborts; in TS BigInt there is no overflow.
  // If you need strict bounds, add explicit checks.
  return fp * y
}

// Divide FixedPoint64 by u64
export function div(fp: FixedPoint64, y: bigint): FixedPoint64 {
  return fp / y
}

// Add u64 to FixedPoint64
export function add(fp: FixedPoint64, y: bigint): FixedPoint64 {
  return fp + (y << 64n)
}

// Subtract u64 from FixedPoint64
export function sub(fp: FixedPoint64, y: bigint): FixedPoint64 {
  // Move aborts on underflow; add explicit check if you want parity.
  const delta = y << 64n
  if (fp < delta) throw new Error("UNDERFLOW")
  return fp - delta
}

// Multiply FixedPoint64 by u128
export function mulU128(fp: FixedPoint64, y: bigint): FixedPoint64 {
  return fp * y
}

// Divide FixedPoint64 by u128
export function divU128(fp: FixedPoint64, y: bigint): FixedPoint64 {
  return fp / y
}

// Multiply by u128 then divide by u128 (full precision via BigInt)
export function mulDivU128(fp: FixedPoint64, y: bigint, z: bigint): FixedPoint64 {
  // Move: (((fp.v as u256) * y / z) as u128)
  return (fp * y) / z
}

// Add u128 to FixedPoint64
export function addU128(fp: FixedPoint64, y: bigint): FixedPoint64 {
  return fp + (y << 64n)
}

// Subtract u128 from FixedPoint64
export function subU128(fp: FixedPoint64, y: bigint): FixedPoint64 {
  const delta = y << 64n
  if (fp < delta) throw new Error("UNDERFLOW")
  return fp - delta
}

// -------------------------
// FixedPoint64 <-> FixedPoint64 ops
// -------------------------

export function addFp(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  return a + b
}

export function subFp(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  if (a < b) throw new Error("UNDERFLOW")
  return a - b
}

// Multiply FixedPoint64 by FixedPoint64, returning FixedPoint64
// Move: result = ((a.v as u256) * (b.v as u256)) >> 64, must fit into u128
export function mulFp(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  const scaled = (a * b) >> 64n
  if (scaled > MAX_U128) throw new Error(`OVERFLOW`)
  return scaled
}

// Divide FixedPoint64 by FixedPoint64, returning FixedPoint64
// Move: (a<<64)/b, must fit into u128, b != 0
export function divFp(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  const scaledA = a << 64n

  // Move has an assert!(scaled_a >= 0, ...) which is always true for u256.
  // Keep parity via bounds check only.
  const result = scaledA / b
  if (result > MAX_U128) throw new Error(`OVERFLOW`)
  return result
}

// mul_div_fp: a*b/c (no net scaling adjustment, matches Move comment)
export function mulDivFp(a: FixedPoint64, b: FixedPoint64, c: FixedPoint64): FixedPoint64 {
  const result = (a * b) / c
  if (result > MAX_U128) throw new Error(`OVERFLOW`)
  return result
}

// -------------------------
// Fractions
// -------------------------

// numerator/denominator as u64 => Q64.64
export function fraction(numerator: bigint, denominator: bigint): FixedPoint64 {
  return (numerator << 64n) / denominator
}

// numerator/denominator as u128 => Q64.64
export function fractionU128(numerator: bigint, denominator: bigint): FixedPoint64 {
  return (numerator << 64n) / denominator
}

// -------------------------
// Comparisons
// -------------------------

export function lt(left: FixedPoint64, right: FixedPoint64): boolean {
  return left < right
}

export function gt(left: FixedPoint64, right: FixedPoint64): boolean {
  return left > right
}

export function lte(left: FixedPoint64, right: FixedPoint64): boolean {
  return left <= right
}

export function gte(left: FixedPoint64, right: FixedPoint64): boolean {
  return left >= right
}

export function eq(left: FixedPoint64, right: FixedPoint64): boolean {
  return left === right
}

export function isZero(fp: FixedPoint64): boolean {
  return fp === 0n
}

export function min(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  return a < b ? a : b
}

export function max(a: FixedPoint64, b: FixedPoint64): FixedPoint64 {
  return a > b ? a : b
}
