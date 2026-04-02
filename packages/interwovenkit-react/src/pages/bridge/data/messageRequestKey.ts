import type { SignedOpHook } from "./tx"

export function getBridgeMsgsRequestKey({
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

export function shouldRetryBridgeMsgsAfterQuoteRefresh({
  previousQuoteVerifiedAt,
  quoteVerifiedAt,
  hasValue,
  hasMessageRefreshError,
}: {
  previousQuoteVerifiedAt?: number
  quoteVerifiedAt?: number
  hasValue: boolean
  hasMessageRefreshError: boolean
}): boolean {
  return (
    hasValue &&
    hasMessageRefreshError &&
    previousQuoteVerifiedAt !== undefined &&
    quoteVerifiedAt !== undefined &&
    quoteVerifiedAt !== previousQuoteVerifiedAt
  )
}
