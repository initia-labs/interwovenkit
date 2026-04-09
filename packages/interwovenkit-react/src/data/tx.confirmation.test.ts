import type { IndexedTx, SigningStargateClient } from "@cosmjs/stargate"
import { describe, expect, it, vi } from "vite-plus/test"
import { TimeoutError } from "@/lib/promise"
import { waitForTxConfirmationWithClient } from "./tx"

function createMockClient(getTx: SigningStargateClient["getTx"]) {
  return { getTx } as unknown as SigningStargateClient
}

function createMockTx(overrides: Partial<IndexedTx> = {}): IndexedTx {
  return { code: 0, hash: "ABC123", rawLog: "", ...overrides } as unknown as IndexedTx
}

describe("waitForTxConfirmationWithClient", () => {
  it("returns the tx when found with code 0", async () => {
    const tx = createMockTx()
    const client = createMockClient(() => Promise.resolve(tx))

    const result = await waitForTxConfirmationWithClient({
      txHash: "ABC123",
      client,
    })

    expect(result).toBe(tx)
  })

  it("throws a plain Error when tx is found but code !== 0", async () => {
    const tx = createMockTx({ code: 1, rawLog: "execution reverted" })
    const client = createMockClient(() => Promise.resolve(tx))

    const error = await waitForTxConfirmationWithClient({
      txHash: "ABC123",
      client,
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(TimeoutError)
    expect((error as Error).message).toBe("execution reverted")
  })

  it("throws TimeoutError when tx is not found within timeoutMs", async () => {
    vi.useFakeTimers()
    try {
      const client = createMockClient(() => Promise.resolve(null))

      // Attach the catch handler immediately to avoid unhandled rejection
      const settled = waitForTxConfirmationWithClient({
        txHash: "ABC123",
        client,
        timeoutMs: 1_000,
        intervalMs: 200,
      }).catch((error: unknown) => error)

      // Advance past the timeout — advanceTimersByTimeAsync processes
      // microtasks between timer ticks, allowing the async polling loop
      // to progress through each iteration.
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(200)
      }

      const error = await settled
      expect(error).toBeInstanceOf(TimeoutError)
      expect((error as TimeoutError).message).toContain("not found on the chain within")
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries until tx is found", async () => {
    vi.useFakeTimers()
    try {
      const tx = createMockTx()
      let callCount = 0
      const client = createMockClient(() => {
        callCount++
        // Return null for first 3 calls, then return the tx
        return Promise.resolve(callCount <= 3 ? null : tx)
      })

      const promise = waitForTxConfirmationWithClient({
        txHash: "ABC123",
        client,
        timeoutMs: 5_000,
        intervalMs: 100,
      })

      // Advance past 3 intervals so 4th call finds the tx
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(100)
      }

      const result = await promise
      expect(result).toBe(tx)
      expect(callCount).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
