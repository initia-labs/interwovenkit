import { afterEach, describe, expect, it, vi } from "vitest"
import { broadcastAutoSignEvent, subscribeAutoSignEvents, withAutoSignOperation } from "./lifecycle"

describe("withAutoSignOperation", () => {
  it("serializes lifecycle writes for the same owner", async () => {
    const order: string[] = []
    let release!: () => void
    const first = withAutoSignOperation("init1owner", async () => {
      order.push("first:start")
      await new Promise<void>((resolve) => {
        release = resolve
      })
      order.push("first:end")
    })
    const second = withAutoSignOperation("init1owner", async () => {
      order.push("second")
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })
})

describe("auto-sign BroadcastChannel coordination", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("marks a same-document delivery from its short-lived sender as local", () => {
    const channels = new Set<FakeBroadcastChannel>()
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null
      closed = false

      constructor(readonly name: string) {
        channels.add(this)
      }

      postMessage(data: unknown) {
        for (const channel of channels) {
          // This mirrors BroadcastChannel: a send is delivered to other channel
          // objects in this document, including the module's subscriber.
          if (channel !== this && !channel.closed && channel.name === this.name) {
            channel.onmessage?.({ data } as MessageEvent)
          }
        }
      }

      close() {
        this.closed = true
        channels.delete(this)
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)

    const received: Array<{ topic: string; isLocal: boolean }> = []
    const unsubscribe = subscribeAutoSignEvents((event, isLocal) => {
      received.push({ topic: event.topic, isLocal })
    })

    broadcastAutoSignEvent({ topic: "storage-mode", owner: "init1owner", revision: 2 })

    expect(received).toEqual([{ topic: "storage-mode", isLocal: true }])
    unsubscribe()
  })
})
