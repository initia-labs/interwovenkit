export const BRIDGE_ROUTE_FRESHNESS_MS = {
  LAYER_2_SAME_CHAIN: 2000,
  LAYER_1_SAME_CHAIN: 5000,
  DEFAULT: 10000,
} as const

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

  if (isLayer1Swap) return BRIDGE_ROUTE_FRESHNESS_MS.LAYER_1_SAME_CHAIN
  if (isLayer2Swap) return BRIDGE_ROUTE_FRESHNESS_MS.LAYER_2_SAME_CHAIN
  return BRIDGE_ROUTE_FRESHNESS_MS.DEFAULT
}

export function isBridgeQuoteFresh({
  quoteVerifiedAt,
  freshnessMs,
  now = Date.now(),
}: BridgeQuoteFreshnessParams): boolean {
  return !!quoteVerifiedAt && quoteVerifiedAt > 0 && now - quoteVerifiedAt <= freshnessMs
}
