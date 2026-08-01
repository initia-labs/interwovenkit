import { describe, expect, it } from "vitest"
import {
  AUTO_ADVANCE_PATH,
  bucketFor,
  canTransition,
  DEPOSIT_STATUSES,
  isTerminalStatus,
  nextAutoStatus,
} from "./statusMachine.ts"

describe("canTransition", () => {
  it("allows every consecutive step of the auto-advance path", () => {
    for (let i = 0; i + 1 < AUTO_ADVANCE_PATH.length; i++) {
      expect(canTransition(AUTO_ADVANCE_PATH[i], AUTO_ADVANCE_PATH[i + 1])).toBe(true)
    }
  })

  it("allows failed/cancelled from every non-terminal status", () => {
    for (const status of DEPOSIT_STATUSES.filter((status) => !isTerminalStatus(status))) {
      expect(canTransition(status, "failed")).toBe(true)
      expect(canTransition(status, "cancelled")).toBe(true)
    }
  })

  it("treats below_minimum as creation-only", () => {
    expect(canTransition("", "below_minimum")).toBe(true)
    for (const status of DEPOSIT_STATUSES) {
      expect(canTransition(status, "below_minimum")).toBe(false)
    }
  })

  it("permits creation only into indexer statuses", () => {
    expect(canTransition("", "detected")).toBe(true)
    expect(canTransition("", "accepted")).toBe(false)
  })

  it("rejects skips and transitions out of terminal statuses", () => {
    expect(canTransition("detected", "funded")).toBe(false)
    expect(canTransition("completed", "failed")).toBe(false)
    expect(canTransition("failed", "detected")).toBe(false)
  })
})

describe("nextAutoStatus", () => {
  it("walks detected to completed and stops", () => {
    expect(nextAutoStatus("detected")).toBe("accepted")
    expect(nextAutoStatus("bridge_submitted")).toBe("completed")
    expect(nextAutoStatus("completed")).toBeNull()
  })

  it("returns null off the auto path", () => {
    expect(nextAutoStatus("advance_pending")).toBeNull()
    expect(nextAutoStatus("failed")).toBeNull()
  })
})

describe("bucketFor", () => {
  it("mirrors the backend's user-facing buckets", () => {
    expect(bucketFor("detected")).toBe("waiting")
    expect(bucketFor("funding_submitting")).toBe("processing")
    expect(bucketFor("completed")).toBe("completed")
    expect(bucketFor("failed")).toBe("failed")
    expect(bucketFor("cancelled")).toBe("failed")
    expect(bucketFor("below_minimum")).toBe("below_minimum")
  })

  it("fails closed on unknown statuses", () => {
    expect(bucketFor("some_future_status")).toBe("failed")
  })
})
