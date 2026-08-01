/** Runtime-mutable mock settings, changed via PATCH /__mock/config. */
export interface DepositMockConfig {
  /** Artificial delay applied to every business response (ms). */
  responseDelayMs: number
  /** 0-1 probability of answering a business request with an injected 500. */
  errorRate: number
  /** Whether simulated deposits advance through the status machine on a timer. */
  autoAdvance: boolean
  /** Interval between automatic status transitions (ms). */
  advanceIntervalMs: number
  /** "manual": the fake payment page waits for a button click. "auto": checkouts complete on a timer. */
  checkoutMode: "manual" | "auto"
  /** Delay before an "auto" checkout completes (ms). */
  checkoutAutoDelayMs: number
  /** Whether GET /v1/config/assets appends a fake Arbitrum source network (see fakeAssets.ts). */
  fakeSourceNetwork: boolean
}

export function defaultConfig(): DepositMockConfig {
  return {
    responseDelayMs: 0,
    errorRate: 0,
    autoAdvance: true,
    advanceIntervalMs: 3000,
    checkoutMode: "manual",
    checkoutAutoDelayMs: 5000,
    fakeSourceNetwork: false,
  }
}

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

// Hand-rolled instead of a schema library: the control contract is a handful
// of keys and each rejection message names the offending key precisely.
const validators: Record<keyof DepositMockConfig, (value: unknown) => boolean> = {
  responseDelayMs: isNonNegativeNumber,
  errorRate: (value) => isNonNegativeNumber(value) && value <= 1,
  autoAdvance: (value) => typeof value === "boolean",
  advanceIntervalMs: (value) => isNonNegativeNumber(value) && value > 0,
  checkoutMode: (value) => value === "manual" || value === "auto",
  checkoutAutoDelayMs: isNonNegativeNumber,
  fakeSourceNetwork: (value) => typeof value === "boolean",
}

/**
 * Validates a partial config update. Throws with a user-readable message on
 * unknown keys or out-of-range values.
 */
export function validateConfigPatch(input: unknown): Partial<DepositMockConfig> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("config patch must be a JSON object")
  }
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const validator = (validators as Record<string, (value: unknown) => boolean>)[key]
    if (!validator) throw new Error(`unknown config key: ${key}`)
    if (!validator(value)) throw new Error(`invalid value for config key: ${key}`)
    patch[key] = value
  }
  return patch as Partial<DepositMockConfig>
}
