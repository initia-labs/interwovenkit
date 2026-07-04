import { describe, expect, it } from "vitest"
import {
  findVisibleRouterAsset,
  getFirstVisibleRouterAsset,
  isVisibleRouterAsset,
  type RouterAsset,
} from "./assets"

function createAsset(overrides: Partial<RouterAsset>): RouterAsset {
  return {
    chain_id: "1",
    denom: "denom",
    decimals: 6,
    symbol: "TOKEN",
    ...overrides,
  } as RouterAsset
}

describe("bridge asset visibility helpers", () => {
  const hiddenIusd = createAsset({ denom: "hidden-iusd", hidden: true, symbol: "iUSD" })
  const visibleUsdc = createAsset({ denom: "visible-usdc", symbol: "USDC" })

  it("treats hidden assets as unavailable for picker-aligned fallback", () => {
    expect(isVisibleRouterAsset(hiddenIusd)).toBe(false)
    expect(isVisibleRouterAsset(visibleUsdc)).toBe(true)
  })

  it("skips hidden pinned assets when selecting the first fallback asset", () => {
    expect(getFirstVisibleRouterAsset([hiddenIusd, visibleUsdc])).toBe(visibleUsdc)
  })

  it("does not consider a hidden denom valid", () => {
    const assets = [hiddenIusd, visibleUsdc]

    expect(findVisibleRouterAsset(assets, hiddenIusd.denom)).toBeUndefined()
    expect(findVisibleRouterAsset(assets, visibleUsdc.denom)).toBe(visibleUsdc)
  })
})
