// Integer base-unit string arithmetic. The mock only approximates (UI-test
// fidelity), but must never emit non-integer or exponent-notation amounts.

/** Shifts an integer base-unit string by a decimal delta, flooring on cut. */
export function shiftDecimals(amount: string, shift: number): string {
  if (!/^\d+$/.test(amount)) return amount
  if (shift === 0) return amount
  if (shift > 0) return trimLeadingZeros(amount + "0".repeat(shift))
  const kept = amount.length + shift
  if (kept <= 0) return "0"
  return trimLeadingZeros(amount.slice(0, kept))
}

/**
 * Converts a decimal amount string (e.g. a fiat amount "100.5") to a base-unit
 * integer string with the given decimals, flooring extra fraction digits.
 * Returns null for non-decimal input.
 */
export function toBaseUnit(amount: string, decimals: number): string | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(amount)
  if (!match) return null
  const whole = match[1]
  const fraction = (match[2] ?? "").slice(0, decimals).padEnd(decimals, "0")
  return trimLeadingZeros(whole + fraction)
}

function trimLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, "")
}
