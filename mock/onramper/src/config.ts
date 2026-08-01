/** Runtime-mutable injection settings, changed via PATCH /__mock/config. */
export interface InjectionConfig {
  /** Artificial delay applied to every proxied response (ms). */
  responseDelayMs: number
  /** 0-1 probability of answering a proxied request with an injected 500. */
  errorRate: number
}

export function defaultConfig(): InjectionConfig {
  return { responseDelayMs: 0, errorRate: 0 }
}

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

const validators: Record<keyof InjectionConfig, (value: unknown) => boolean> = {
  responseDelayMs: isNonNegativeNumber,
  errorRate: (value) => isNonNegativeNumber(value) && value <= 1,
}

/**
 * Validates a partial config update. Throws with a user-readable message on
 * unknown keys or out-of-range values.
 */
export function validateConfigPatch(input: unknown): Partial<InjectionConfig> {
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
  return patch as Partial<InjectionConfig>
}
