import { parseQuantity } from "@/lib/amountValidation"

export type SlippageMessage = { type: "error" | "warning"; text: string }

// Validate a slippage input string. Returns an error message for inputs that
// cannot be safely signed (empty, non-finite, "." mid-input, "0", >100), a
// warning message for valid but risky values, or null when the value is safe.
// `Number("")` is 0 and `Number(".")` is NaN, so the previous `Number(value)`
// gate only caught `>100` and let mid-input / empty values reach the bridge.
export function getSlippageMessage(value: string | undefined | null): SlippageMessage | null {
  const parsed = parseQuantity(value)
  if (!parsed) {
    return { type: "error", text: "Enter a slippage value" }
  }

  if (parsed.lte(0)) {
    return { type: "error", text: "Slippage must be greater than 0" }
  }

  if (parsed.gt(100)) {
    return { type: "error", text: "Slippage must be less than 100%" }
  }

  if (parsed.gt(5)) {
    return { type: "warning", text: "Your transaction may be frontrun" }
  }

  if (parsed.lt(0.1)) {
    return { type: "warning", text: "Your transaction may fail" }
  }

  return null
}
