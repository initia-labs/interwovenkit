import { describe, expect, it } from "vitest"
import type { TxItem } from "./queries"
import { aggregateActivities } from "./queries"
import type { NormalizedChain } from "@/data/chains"

describe("aggregateActivities", () => {
  const mockChain1 = {
    chainId: "chain-1",
    name: "Chain 1",
  } as unknown as NormalizedChain

  const mockChain2 = {
    chainId: "chain-2",
    name: "Chain 2",
  } as unknown as NormalizedChain

  const createMockTx = (txhash: string, timestamp: Date): TxItem => ({
    tx: {
      body: {
        messages: [],
        memo: "",
      },
      auth_info: {
        signer_infos: [],
        fee: { amount: [], gas: "0" },
      },
    },
    code: 0,
    events: [],
    txhash,
    timestamp,
  })

  it("should combine and sort transactions from multiple chains by timestamp", () => {
    const tx1 = createMockTx("hash1", new Date("2026-01-03T10:00:00Z"))
    const tx2 = createMockTx("hash2", new Date("2026-01-01T10:00:00Z"))
    const tx3 = createMockTx("hash3", new Date("2026-01-04T10:00:00Z"))
    const tx4 = createMockTx("hash4", new Date("2026-01-02T10:00:00Z"))

    const chains = [mockChain1, mockChain2]
    const txResults = [
      [tx1, tx2],
      [tx3, tx4],
    ]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(4)
    expect(result[0].txhash).toBe("hash3") // Most recent
    expect(result[1].txhash).toBe("hash1")
    expect(result[2].txhash).toBe("hash4")
    expect(result[3].txhash).toBe("hash2") // Oldest

    // Verify chain information is attached
    expect(result[0].chain).toBe(mockChain2)
    expect(result[1].chain).toBe(mockChain1)
  })

  it("should handle undefined transaction results", () => {
    const tx1 = createMockTx("hash1", new Date("2026-01-01T10:00:00Z"))

    const chains = [mockChain1, mockChain2]
    const txResults = [[tx1], undefined]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(1)
    expect(result[0].txhash).toBe("hash1")
    expect(result[0].chain).toBe(mockChain1)
  })

  it("should handle empty transaction arrays", () => {
    const chains = [mockChain1, mockChain2]
    const txResults: (TxItem[] | undefined)[] = [[], []]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(0)
  })

  it("should handle mixed empty and populated results", () => {
    const tx1 = createMockTx("hash1", new Date("2026-01-02T10:00:00Z"))
    const tx2 = createMockTx("hash2", new Date("2026-01-01T10:00:00Z"))

    const chains = [mockChain1, mockChain2]
    const txResults = [[], [tx1, tx2]]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(2)
    expect(result[0].txhash).toBe("hash1")
    expect(result[1].txhash).toBe("hash2")
    expect(result[0].chain).toBe(mockChain2)
    expect(result[1].chain).toBe(mockChain2)
  })

  it("should maintain stable sort for transactions with identical timestamps", () => {
    const sameTime = new Date("2026-01-01T10:00:00Z")
    const tx1 = createMockTx("hash1", sameTime)
    const tx2 = createMockTx("hash2", sameTime)
    const tx3 = createMockTx("hash3", sameTime)

    const chains = [mockChain1, mockChain2]
    const txResults = [[tx1, tx2], [tx3]]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(3)
    // With same timestamps, order should be stable based on input order
    expect(result.map((r) => r.txhash)).toEqual(["hash1", "hash2", "hash3"])
  })

  it("should correctly handle single chain with multiple transactions", () => {
    const tx1 = createMockTx("hash1", new Date("2026-01-03T10:00:00Z"))
    const tx2 = createMockTx("hash2", new Date("2026-01-01T10:00:00Z"))
    const tx3 = createMockTx("hash3", new Date("2026-01-02T10:00:00Z"))

    const chains = [mockChain1]
    const txResults = [[tx1, tx2, tx3]]

    const result = aggregateActivities(chains, txResults)

    expect(result).toHaveLength(3)
    expect(result[0].txhash).toBe("hash1") // Most recent
    expect(result[1].txhash).toBe("hash3")
    expect(result[2].txhash).toBe("hash2") // Oldest
    expect(result.every((r) => r.chain === mockChain1)).toBe(true)
  })
})
