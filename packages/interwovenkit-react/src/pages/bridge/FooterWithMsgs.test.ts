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
  it("is stable when route inputs stay the same", () => {
    expect(
      bridgeMsgsRequestKeySnapshot({
        addressList: ["init1test"],
        operations: [{ transfer: "same-route" }],
        signedOpHook: { signer: "init1test", hook: "hook" },
      }),
    ).toBe(
      bridgeMsgsRequestKeySnapshot({
        addressList: ["init1test"],
        operations: [{ transfer: "same-route" }],
        signedOpHook: { signer: "init1test", hook: "hook" },
      }),
    )
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
