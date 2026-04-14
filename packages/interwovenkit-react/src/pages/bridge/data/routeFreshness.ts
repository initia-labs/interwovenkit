interface BridgeRouteFreshnessParams {
  srcChainId: string
  dstChainId: string
  srcChainType: string
  layer1ChainId: string
}

interface BridgeQuoteFreshnessParams {
  quoteVerifiedAt?: number
  freshnessMs: number
  now?: number
}

export function getBridgeRouteFreshnessMs({
  srcChainId,
  dstChainId,
  srcChainType,
  layer1ChainId,
}: BridgeRouteFreshnessParams): number {
  const isSameChainRoute = srcChainId === dstChainId
  const isLayer1Swap = isSameChainRoute && srcChainId === layer1ChainId
  const isLayer2Swap = isSameChainRoute && srcChainType === "initia" && !isLayer1Swap

  if (isLayer1Swap) return 5000
  if (isLayer2Swap) return 2000
  return 10000
}

export function isBridgeQuoteFresh({
  quoteVerifiedAt,
  freshnessMs,
  now = Date.now(),
}: BridgeQuoteFreshnessParams): boolean {
  return !!quoteVerifiedAt && quoteVerifiedAt > 0 && now - quoteVerifiedAt <= freshnessMs
}
