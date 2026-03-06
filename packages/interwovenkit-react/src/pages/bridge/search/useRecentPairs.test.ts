import type { RecentPair } from "./types"
import { addPairToList, isSamePair, MAX_RECENT_PAIRS } from "./useRecentPairs"

const pair1: RecentPair = {
  srcChainId: "chain-a",
  srcDenom: "uusdc",
  dstChainId: "chain-b",
  dstDenom: "uinit",
}

const pair2: RecentPair = {
  srcChainId: "chain-a",
  srcDenom: "ueth",
  dstChainId: "chain-c",
  dstDenom: "uatom",
}

describe("isSamePair", () => {
  it("returns true for identical pairs", () => {
    expect(isSamePair(pair1, { ...pair1 })).toBe(true)
  })

  it("returns false when any field differs", () => {
    expect(isSamePair(pair1, { ...pair1, srcDenom: "other" })).toBe(false)
    expect(isSamePair(pair1, { ...pair1, dstChainId: "other" })).toBe(false)
    expect(isSamePair(pair1, { ...pair1, dstDenom: "other" })).toBe(false)
    expect(isSamePair(pair1, { ...pair1, srcChainId: "other" })).toBe(false)
  })
})

describe("addPairToList", () => {
  it("adds a new pair to the front", () => {
    const result = addPairToList([], pair1)
    expect(result).toEqual([pair1])
  })

  it("prepends new pair before existing ones", () => {
    const result = addPairToList([pair1], pair2)
    expect(result).toEqual([pair2, pair1])
  })

  it("deduplicates by moving existing pair to front", () => {
    const result = addPairToList([pair2, pair1], pair1)
    expect(result).toEqual([pair1, pair2])
  })

  it("limits to MAX_RECENT_PAIRS", () => {
    const pairs: RecentPair[] = Array.from({ length: MAX_RECENT_PAIRS }, (_, i) => ({
      srcChainId: `chain-${i}`,
      srcDenom: "uusdc",
      dstChainId: "chain-dst",
      dstDenom: "uinit",
    }))

    const newPair: RecentPair = {
      srcChainId: "chain-new",
      srcDenom: "uusdc",
      dstChainId: "chain-dst",
      dstDenom: "uinit",
    }

    const result = addPairToList(pairs, newPair)
    expect(result).toHaveLength(MAX_RECENT_PAIRS)
    expect(result[0]).toEqual(newPair)
    expect(result[MAX_RECENT_PAIRS - 1].srcChainId).toBe(`chain-${MAX_RECENT_PAIRS - 2}`)
  })

  it("does not exceed limit when deduplicating", () => {
    const pairs: RecentPair[] = Array.from({ length: MAX_RECENT_PAIRS }, (_, i) => ({
      srcChainId: `chain-${i}`,
      srcDenom: "uusdc",
      dstChainId: "chain-dst",
      dstDenom: "uinit",
    }))

    const result = addPairToList(pairs, pairs[2])
    expect(result).toHaveLength(MAX_RECENT_PAIRS)
    expect(result[0]).toEqual(pairs[2])
  })
})
