import { describe, expect, it, vi } from "vitest"
import { withTimeout } from "./promise"

describe("withTimeout", () => {
  it("resolves when the promise settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1_000, "timeout")
    expect(result).toBe("ok")
  })

  it("rejects with the original error when the promise rejects before the timeout", async () => {
    const error = new Error("original")
    await expect(withTimeout(Promise.reject(error), 1_000, "timeout")).rejects.toThrow("original")
  })

  it("rejects with timeout message when the promise does not settle in time", async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => {})
    const race = withTimeout(never, 500, "timed out")
    vi.advanceTimersByTime(500)
    await expect(race).rejects.toThrow("timed out")
    vi.useRealTimers()
  })
})
