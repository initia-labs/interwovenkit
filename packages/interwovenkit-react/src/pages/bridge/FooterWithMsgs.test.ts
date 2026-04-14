import { shouldRetryBridgeMsgsAfterQuoteRefresh } from "./data/messageRequestKey"

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
