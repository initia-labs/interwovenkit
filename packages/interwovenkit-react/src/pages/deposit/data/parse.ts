/**
 * Primitives for the Deposit API boundary parsers. There is no schema library
 * here by design: every parser still states its own checks and its own error
 * message. This file only holds what they all need, so one parser's idea of
 * "an integer string" cannot drift from another's.
 */

/** A keyed JSON object. Arrays are excluded: every wire record this API sends is keyed. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === "string"
}

/** Empty counts as missing everywhere in these parsers, so it never passes as a present value. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

/** A real JS number: JSON `null`, NaN and Infinity are not. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

const INTEGER_PATTERN = /^\d+$/
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const EVM_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
// Even-length hex: calldata is whole bytes, and an odd-length string would be
// silently re-interpreted (or rejected) by the wallet after the user signed.
const HEX_DATA_PATTERN = /^0x([0-9a-fA-F]{2})*$/
const HEX_QUANTITY_PATTERN = /^0x[0-9a-fA-F]+$/

/** Base units stay decimal strings end to end; `Number` would lose precision on them. */
export function isIntegerString(value: unknown): value is string {
  return typeof value === "string" && INTEGER_PATTERN.test(value)
}

export function isPositiveIntegerString(value: unknown): value is string {
  return isIntegerString(value) && BigInt(value) > 0n
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value)
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && EVM_ADDRESS_PATTERN.test(value)
}

export function isEvmTxHash(value: unknown): value is string {
  return typeof value === "string" && EVM_TX_HASH_PATTERN.test(value)
}

/** 0x calldata, whole bytes. */
export function isHexData(value: unknown): value is string {
  return typeof value === "string" && HEX_DATA_PATTERN.test(value)
}

/** 0x-prefixed hex number — the form staging uses for `value` and the gas fields. */
export function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && HEX_QUANTITY_PATTERN.test(value)
}

/** Throws `message` unless `condition` holds: the fail-closed spine of the throwing parsers. */
export function assertField(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** One field of a record spec. An `optional` field may be absent, but never malformed. */
export interface FieldRule<T, Optional extends boolean = false> {
  guard: (value: unknown) => value is T
  optional: Optional
}

export function required<T>(guard: (value: unknown) => value is T): FieldRule<T, false> {
  return { guard, optional: false }
}

export function optional<T>(guard: (value: unknown) => value is T): FieldRule<T, true> {
  return { guard, optional: true }
}

export type FieldSpec = Record<string, FieldRule<unknown, boolean>>

export type ParsedFields<S extends FieldSpec> = {
  [K in keyof S]: S[K] extends FieldRule<infer T, infer Optional>
    ? Optional extends true
      ? T | undefined
      : T
    : never
}

/**
 * Reads exactly the spec'd fields out of a wire record, or null if any of them
 * is missing or the wrong shape. Two properties matter for the callers that
 * return null rather than throwing: it never half-builds a result, and the
 * result carries only spec'd keys — a foreign key written by another version
 * cannot ride along into a later write.
 */
export function parseFields<S extends FieldSpec>(value: unknown, spec: S): ParsedFields<S> | null {
  if (!isRecord(value)) return null
  const parsed: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(spec)) {
    const field = value[key]
    if (field === undefined && rule.optional) continue
    if (!rule.guard(field)) return null
    parsed[key] = field
  }
  return parsed as ParsedFields<S>
}
