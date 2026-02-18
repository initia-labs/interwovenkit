import { formatDuration } from "./format"

describe("formatDuration", () => {
  it("handles pure seconds", () => {
    expect(formatDuration(1)).toBe("1s")
    expect(formatDuration(59)).toBe("59s")
  })

  it("handles zero duration", () => {
    expect(formatDuration(0)).toBe(undefined)
  })

  it("converts full minutes", () => {
    expect(formatDuration(60)).toBe("1m")
    expect(formatDuration(150)).toBe("2m 30s") // 150 = 2*60 + 30
  })

  it("converts full hours", () => {
    expect(formatDuration(3600)).toBe("1h")
    expect(formatDuration(3661)).toBe("1h 1m 1s")
  })

  it("converts full days", () => {
    expect(formatDuration(24 * 3600)).toBe("1d")
    expect(formatDuration(90061)).toBe("1d 1h 1m 1s") // 86400 + 3600 + 60 + 1
  })

  it("formats combined weeks, days, hours, minutes, seconds", () => {
    const combinedSeconds =
      1 * 24 * 3600 + // 2 days
      2 * 3600 + // 3 hours
      3 * 60 + // 4 minutes
      4 // 5 seconds

    expect(formatDuration(combinedSeconds)).toBe("1d 2h 3m 4s")
  })

  it("drops zero-count units", () => {
    expect(formatDuration(3600)).toBe("1h")
  })
})
