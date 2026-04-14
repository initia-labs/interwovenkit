import {
  BRIDGE_ROUTE_FRESHNESS_MS,
  getBridgeRouteFreshnessMs,
  isBridgeQuoteFresh,
} from "./routeFreshness"

describe("getBridgeRouteFreshnessMs", () => {
  it("uses the shorter L2 freshness window for same-chain initia swaps", () => {
    expect(
      getBridgeRouteFreshnessMs({
        dstChainId: "minievm-1",
        layer1ChainId: "initia-1",
        srcChainId: "minievm-1",
        srcChainType: "initia",
      }),
    ).toBe(BRIDGE_ROUTE_FRESHNESS_MS.LAYER_2_SAME_CHAIN)
  })

  it("uses the layer 1 freshness window for same-chain L1 swaps", () => {
    expect(
      getBridgeRouteFreshnessMs({
        dstChainId: "initia-1",
        layer1ChainId: "initia-1",
        srcChainId: "initia-1",
        srcChainType: "initia",
      }),
    ).toBe(BRIDGE_ROUTE_FRESHNESS_MS.LAYER_1_SAME_CHAIN)
  })

  it("falls back to the default freshness window for cross-chain routes", () => {
    expect(
      getBridgeRouteFreshnessMs({
        dstChainId: "initia-1",
        layer1ChainId: "initia-1",
        srcChainId: "arb-1",
        srcChainType: "evm",
      }),
    ).toBe(BRIDGE_ROUTE_FRESHNESS_MS.DEFAULT)
  })
})

describe("isBridgeQuoteFresh", () => {
  it("marks quotes older than the route-specific freshness window as stale", () => {
    expect(
      isBridgeQuoteFresh({
        freshnessMs: 2000,
        now: 6001,
        quoteVerifiedAt: 4000,
      }),
    ).toBe(false)
  })

  it("keeps quotes within the freshness window fresh", () => {
    expect(
      isBridgeQuoteFresh({
        freshnessMs: 5000,
        now: 9000,
        quoteVerifiedAt: 4001,
      }),
    ).toBe(true)
  })
})
