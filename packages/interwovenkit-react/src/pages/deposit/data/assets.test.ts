import type { KyInstance } from "ky"
import { describe, expect, it } from "vitest"
import { createDepositAssetsQueryOptions, parseAssets } from "./assets"
import type { Asset, DestinationNetwork } from "./types"

const route = (min_deposit_amount: string): Asset => ({
  src_chain_id: "1",
  src_denom: "ethereum-native",
  src_decimals: 18,
  min_deposit_amount,
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [],
})

const network = (processing_time_seconds?: number): DestinationNetwork => ({
  chain_id: "interwoven-1",
  chain_name: "Initia",
  denom: "uusdc",
  decimals: 6,
  vm_type: "move",
  processing_time_seconds,
})

/** Minimal ky stub: only the `get().json()` chain the queryFn touches. */
const stubApi = (payload: unknown): KyInstance =>
  ({ get: () => ({ json: () => Promise.resolve(payload) }) }) as unknown as KyInstance

describe("parseAssets", () => {
  it("passes routes with a valid integer minimum through unchanged", () => {
    const assets = [route("5000000000000000000"), route("0")]
    expect(parseAssets(assets)).toBe(assets)
  })

  // min_deposit_amount is the only value protecting funds: every gate built on
  // it (isBelowRouteMinimum, formatSourceMin) silently disarms on an empty or
  // malformed value, so it must fail loudly at the boundary instead.
  it("throws on an empty minimum", () => {
    expect(() => parseAssets([route("")])).toThrow(/Invalid min_deposit_amount/)
  })

  it("throws on a non-integer minimum", () => {
    expect(() => parseAssets([route("1.5")])).toThrow(/Invalid min_deposit_amount/)
    expect(() => parseAssets([route("abc")])).toThrow(/Invalid min_deposit_amount/)
  })

  it("names the offending route in the error", () => {
    expect(() => parseAssets([route("")])).toThrow(/1:ethereum-native/)
  })

  // src_decimals feeds both formatSourceMin (the displayed minimum) and the
  // isBelowRouteMinimum payout conversion; a missing value renders base units
  // as whole tokens and corrupts the gate instead of failing.
  it("throws on missing or invalid src_decimals", () => {
    const withDecimals = (src_decimals: unknown): Asset => ({
      ...route("1"),
      src_decimals: src_decimals as number,
    })
    expect(() => parseAssets([withDecimals(undefined)])).toThrow(/Invalid src_decimals/)
    expect(() => parseAssets([withDecimals(1.5)])).toThrow(/Invalid src_decimals/)
    expect(() => parseAssets([withDecimals(-1)])).toThrow(/Invalid src_decimals/)
    expect(() => parseAssets([withDecimals("6")])).toThrow(/Invalid src_decimals/)
  })

  it("allows zero src_decimals", () => {
    const assets = [{ ...route("1"), src_decimals: 0 }]
    expect(parseAssets(assets)).toBe(assets)
  })
})

describe("createDepositAssetsQueryOptions", () => {
  describe("queryFn", () => {
    const callQueryFn = (payload: unknown) => {
      const { queryFn } = createDepositAssetsQueryOptions(stubApi(payload))
      if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
      return queryFn({} as unknown as Parameters<typeof queryFn>[0])
    }

    it("returns the routes when the payload passes the boundary guard", async () => {
      const assets = [route("5000000000000000000")]
      await expect(callQueryFn({ assets })).resolves.toBe(assets)
    })

    // The parseAssets boundary tests above are moot if the queryFn ever stops
    // routing the response through parseAssets — this pins the wiring, and the
    // `cause` assertion pins normalizeError preserving the original error for
    // the hub's console.error diagnostics.
    it("rejects with the original error as cause when the guard trips", async () => {
      await expect(callQueryFn({ assets: [route("")] })).rejects.toMatchObject({
        message: expect.stringMatching(/Invalid min_deposit_amount/),
        cause: expect.objectContaining({ message: expect.stringMatching(/ethereum-native/) }),
      })
    })
  })

  // Pins the processing-time polling cap: poll every 5 s only while an estimate
  // is missing, stopping after the initial fetch + 6 refetches (~30 s). The
  // literals below restate the contract rather than importing the constants.
  describe("refetchInterval", () => {
    const getRefetchInterval = (data: Asset[] | undefined, dataUpdateCount: number) => {
      const { refetchInterval } = createDepositAssetsQueryOptions(stubApi(null))
      if (typeof refetchInterval !== "function") {
        throw new Error("refetchInterval must be a function")
      }
      const query = { state: { data, dataUpdateCount } }
      return refetchInterval(query as unknown as Parameters<typeof refetchInterval>[0])
    }

    const complete = [{ ...route("1"), dst_networks: [network(60)] }]
    const missingEstimate = [{ ...route("1"), dst_networks: [network(60), network(undefined)] }]

    it("does not poll while there is no data", () => {
      expect(getRefetchInterval(undefined, 0)).toBe(false)
    })

    it("does not poll when every network has an estimate", () => {
      expect(getRefetchInterval(complete, 1)).toBe(false)
    })

    it("polls every 5 s while an estimate is missing and the budget remains", () => {
      expect(getRefetchInterval(missingEstimate, 1)).toBe(5_000)
      expect(getRefetchInterval(missingEstimate, 6)).toBe(5_000)
    })

    it("stops polling once the fetch budget is spent", () => {
      expect(getRefetchInterval(missingEstimate, 7)).toBe(false)
    })
  })
})
