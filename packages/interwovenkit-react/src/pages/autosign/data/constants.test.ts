import { DAY_IN_MS, HOUR_IN_MS, MINUTE_IN_MS } from "@/data/constants"
import { DEFAULT_DURATION, resolveAutoSignDuration } from "./constants"

describe("resolveAutoSignDuration", () => {
  it("returns the default duration when none is provided", () => {
    expect(DEFAULT_DURATION).toBe(0)
    expect(resolveAutoSignDuration()).toBe(0)
  })

  it("returns the provided duration when it matches a supported option", () => {
    expect(resolveAutoSignDuration(HOUR_IN_MS)).toBe(HOUR_IN_MS)
    expect(resolveAutoSignDuration(7 * DAY_IN_MS)).toBe(7 * DAY_IN_MS)
    expect(resolveAutoSignDuration(0)).toBe(0)
  })

  it("rejects unsupported durations instead of silently widening them", () => {
    expect(() => resolveAutoSignDuration(5 * MINUTE_IN_MS)).toThrow(
      "Auto-sign duration must match a supported option",
    )
  })
})
