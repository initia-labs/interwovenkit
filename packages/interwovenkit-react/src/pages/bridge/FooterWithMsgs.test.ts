import { shouldRetryBridgeMsgsAfterQuoteRefresh } from "./data/messageRequestKey"
import type { SignedOpHook } from "./data/tx"

function bridgeMsgsRequestKeySnapshot({
  addressList,
  operations,
  signedOpHook,
}: {
  addressList: string[]
  operations: unknown
  signedOpHook?: SignedOpHook
}): string {
  return JSON.stringify({
    addressList,
    operations,
    signedOpHook: signedOpHook ?? null,
  })
}

describe("bridgeMsgsRequestKeySnapshot", () => {
  it("serializes inputs deterministically", () => {
    expect(
      bridgeMsgsRequestKeySnapshot({
        addressList: ["init1test"],
        operations: [{ transfer: "same-route" }],
        signedOpHook: { signer: "init1test", hook: "hook" },
      }),
    ).toBe(
      '{"addressList":["init1test"],"operations":[{"transfer":"same-route"}],"signedOpHook":{"signer":"init1test","hook":"hook"}}',
    )
  })

  it("changes when hook inputs change", () => {
    const a = bridgeMsgsRequestKeySnapshot({
      addressList: ["init1test"],
      operations: [{ transfer: "same-route" }],
      signedOpHook: { signer: "init1test", hook: "hook-a" },
    })
    const b = bridgeMsgsRequestKeySnapshot({
      addressList: ["init1test"],
      operations: [{ transfer: "same-route" }],
      signedOpHook: { signer: "init1test", hook: "hook-b" },
    })
    expect(a).not.toBe(b)
  })
})

describe("shouldRetryBridgeMsgsAfterQuoteRefresh", () => {
  it("retries when a refreshed quote arrives while preserving a stale preview", () => {
    expect(
      shouldRetryBridgeMsgsAfterQuoteRefresh({
        previousQuoteVerifiedAt: 10,
        quoteVerifiedAt: 20,
        hasValue: true,
        hasMessageRefreshError: true,
      }),
    ).toBe(true)
  })

  it("does not retry when there is no stale preview error to recover", () => {
    expect(
      shouldRetryBridgeMsgsAfterQuoteRefresh({
        previousQuoteVerifiedAt: 10,
        quoteVerifiedAt: 20,
        hasValue: true,
        hasMessageRefreshError: false,
      }),
    ).toBe(false)
  })

  it("does not retry when the quote timestamp is unchanged", () => {
    expect(
      shouldRetryBridgeMsgsAfterQuoteRefresh({
        previousQuoteVerifiedAt: 10,
        quoteVerifiedAt: 10,
        hasValue: true,
        hasMessageRefreshError: true,
      }),
    ).toBe(false)
  })
})
