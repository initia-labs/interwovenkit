import { DAY_IN_MS, HOUR_IN_MS, MINUTE_IN_MS } from "@/data/constants"
import { DEFAULT_DURATION, resolveAutoSignDuration } from "./constants"

describe("resolveAutoSignDuration", () => {
  it("returns the default duration when none is provided", () => {
    expect(resolveAutoSignDuration()).toBe(DEFAULT_DURATION)
  })

  it("returns the provided duration when it matches a supported option", () => {
    expect(resolveAutoSignDuration(HOUR_IN_MS)).toBe(HOUR_IN_MS)
    expect(resolveAutoSignDuration(7 * DAY_IN_MS)).toBe(7 * DAY_IN_MS)
    expect(resolveAutoSignDuration(0)).toBe(0)
  })

  it("falls back to the default duration for unsupported values", () => {
    expect(resolveAutoSignDuration(5 * MINUTE_IN_MS)).toBe(DEFAULT_DURATION)
  })
})
