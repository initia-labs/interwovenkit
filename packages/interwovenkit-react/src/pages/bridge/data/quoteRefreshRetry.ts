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
