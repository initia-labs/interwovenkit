import { describe, expect, it } from "vitest"
import {
  isInvalidCursorError,
  newContinuationCursor,
  newWatermarkCursor,
  parseCursor,
} from "./cursor.ts"

const WATERMARK_MS = Date.parse("2026-07-15T12:00:00.123Z")

describe("watermark cursors", () => {
  it("round-trips a watermark", () => {
    const cursor = parseCursor(newWatermarkCursor(WATERMARK_MS))
    expect(cursor.afterCreatedAtMs).toBe(WATERMARK_MS)
    expect(cursor.boundary).toBeNull()
  })

  it("round-trips a continuation cursor with the original watermark", () => {
    const id = "0193b6a5-7b22-4650-8e6d-1ea119fa3d42"
    const base = parseCursor(newWatermarkCursor(WATERMARK_MS))
    const cursor = parseCursor(
      newContinuationCursor(base, {
        observedAtMs: WATERMARK_MS + 5000,
        createdAtMs: WATERMARK_MS + 4000,
        id,
      }),
    )
    expect(cursor.afterCreatedAtMs).toBe(WATERMARK_MS)
    expect(cursor.boundary).toEqual({
      observedAtMs: WATERMARK_MS + 5000,
      createdAtMs: WATERMARK_MS + 4000,
      id,
    })
  })

  it("accepts a legacy bare-timestamp payload", () => {
    const legacy = `v1.${btoa("2026-07-15T12:00:00.123Z").replace(/=+$/, "")}`
    expect(parseCursor(legacy).afterCreatedAtMs).toBe(WATERMARK_MS)
  })
})

describe("invalid cursors", () => {
  const invalidCases: [string, string][] = [
    ["empty", ""],
    ["unsupported version", `v2.${btoa("{}")}`],
    ["not base64url", "v1.!!!!"],
    ["not JSON", `v1.${btoa("hello")}`],
    ["unknown key", `v1.${btoa(JSON.stringify({ foo: "bar" }))}`],
    ["no watermark or boundary", `v1.${btoa("{}")}`],
    [
      "incomplete page boundary",
      `v1.${btoa(JSON.stringify({ before_id: "0193b6a5-7b22-4650-8e6d-1ea119fa3d42" }))}`,
    ],
    [
      "non-UUID before_id",
      `v1.${btoa(
        JSON.stringify({
          before_observed_at: "2026-07-15T12:00:00Z",
          before_created_at: "2026-07-15T12:00:00Z",
          before_id: "nope",
        }),
      )}`,
    ],
    ["invalid timestamp", `v1.${btoa(JSON.stringify({ after_created_at: "yesterday" }))}`],
    ["too long", `v1.${"A".repeat(600)}`],
  ]

  it.each(invalidCases)("rejects %s", (_name, value) => {
    let thrown: unknown
    try {
      parseCursor(value)
    } catch (error) {
      thrown = error
    }
    expect(isInvalidCursorError(thrown)).toBe(true)
  })
})
