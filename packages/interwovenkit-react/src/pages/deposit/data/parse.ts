import { isHexString } from "ethers"

/** Thrown by assertField: a response that failed its boundary check, which no retry can change. */
export class ParseError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === "string"
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

export function isIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value)
}

export function isPositiveIntegerString(value: unknown): value is string {
  return isIntegerString(value) && BigInt(value) > 0n
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
}

export function isEvmTxHash(value: unknown): value is string {
  return isHexString(value, 32)
}

/** 0x-prefixed hex number, the form staging uses for `value` and the gas fields. */
export function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
}

export function assertField(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ParseError(message)
}

export const eqAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

interface FieldRule<T, Optional extends boolean = false> {
  guard: (value: unknown) => value is T
  optional: Optional
}

export function required<T>(guard: (value: unknown) => value is T): FieldRule<T, false> {
  return { guard, optional: false }
}

export function optional<T>(guard: (value: unknown) => value is T): FieldRule<T, true> {
  return { guard, optional: true }
}

type FieldSpec = Record<string, FieldRule<unknown, boolean>>

type ParsedFields<S extends FieldSpec> = {
  [K in keyof S]: S[K] extends FieldRule<infer T, infer Optional>
    ? Optional extends true
      ? T | undefined
      : T
    : never
}

// Never half-builds a result, and carries only spec'd keys so a foreign key cannot ride along into
// a later write.
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
