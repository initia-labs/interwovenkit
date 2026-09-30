import { buildDepositSession } from "./wallet/testing"
import {
  completedReceivedEvidence,
  depositHistorySessions,
  depositHistoryStatus,
  matchesHistoryAccount,
  sourceExplorerUrl,
} from "./history"

describe("deposit history", () => {
  it("shows one saved row only after the source transaction exists", () => {
    const pending = buildDepositSession({ id: "pending", currentSourceHash: "0xaaa" })
    const prepared = buildDepositSession({ id: "prepared" })
    expect(depositHistorySessions([pending, pending, prepared]).map(({ id }) => id)).toEqual([
      "pending",
    ])
  })

  it.each([
    ["completed", "completed"],
    ["source_reverted", "failed"],
    ["source_cancelled", "failed"],
    ["bridge_refunded", "refunded"],
    ["bridge_refunding", "refunding"],
    ["below_minimum", "problem"],
    ["tracking_conflict", "problem"],
    ["bridge_pending", "pending"],
  ] as const)("maps %s to %s", (lastState, expected) => {
    expect(depositHistoryStatus(buildDepositSession({ lastState }))).toBe(expected)
  })

  it("matches either connected sender or recipient and ignores hex casing", () => {
    expect(matchesHistoryAccount("0xAbC", "init1recipient", ["0xabc"])).toBe(true)
    expect(matchesHistoryAccount("0xAbC", "init1recipient", ["init1recipient"])).toBe(true)
    expect(matchesHistoryAccount("0xAbC", "init1recipient", ["init1other"])).toBe(false)
  })

  it("builds source links only for known chains and transaction hashes", () => {
    const hash = `0x${"a".repeat(64)}`
    expect(sourceExplorerUrl("8453", hash)).toBe(`https://basescan.org/tx/${hash}`)
    expect(sourceExplorerUrl("8453", "0xunsafe/path")).toBeUndefined()
    expect(sourceExplorerUrl("unknown", hash)).toBeUndefined()
  })

  it("hydrates completed amounts from saved decimals before the catalog loads", () => {
    expect(completedReceivedEvidence("completed", "492500", undefined, 6)).toEqual({
      amount: "492500",
      decimals: 6,
    })
    expect(completedReceivedEvidence("processing", "492500", 6, 6)).toBeUndefined()
    expect(completedReceivedEvidence("completed", "", 6, 6)).toBeUndefined()
  })
})
