import { describe, expect, it } from "vitest"
import { assertDepositAddress, selectFreshCursor } from "./depositAddress"
import type { DepositAddressResponse } from "./types"

const REQUEST = {
  walletAddress: "init1veaum7wallet",
  chainId: "interwoven-1",
  // Host-provided EVM denom casing can differ from the server's checksummed
  // echo; the guard must treat them as the same asset.
  assetDenom: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
}

const response = (overrides: Partial<DepositAddressResponse>): DepositAddressResponse => ({
  wallet_address: REQUEST.walletAddress,
  chain_id: REQUEST.chainId,
  asset_denom: REQUEST.assetDenom,
  deposit_address: "0x6f83D3d8966Cd166ADFF61CdC7c36E9FEf06A75a",
  cursor: "v1.eyJhZnRlcl9jcmVhdGVkX2F0IjoiMjAyNi0wNy0xNFQwMDowMDowMFoifQ",
  ...overrides,
})

describe("assertDepositAddress", () => {
  it("passes a matching response through unchanged", () => {
    const target = response({})
    expect(assertDepositAddress(target, REQUEST)).toBe(target)
  })

  it("accepts denom and wallet casing differences", () => {
    const target = response({
      asset_denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      wallet_address: REQUEST.walletAddress.toUpperCase(),
    })
    expect(assertDepositAddress(target, REQUEST)).toBe(target)
  })

  // An empty address would render a blank QR and make list matching silently
  // never match, so it must fail loudly at the boundary.
  it("throws on an empty deposit address", () => {
    expect(() => assertDepositAddress(response({ deposit_address: "" }), REQUEST)).toThrow(
      /missing the deposit address/,
    )
  })

  // Without a cursor the detection query (useNewDeposits) stays disabled and
  // the advance screens would silently never advance.
  it("throws on a missing cursor", () => {
    expect(() => assertDepositAddress(response({ cursor: "" }), REQUEST)).toThrow(
      /missing the cursor/,
    )
    expect(() =>
      assertDepositAddress(response({ cursor: undefined as unknown as string }), REQUEST),
    ).toThrow(/missing the cursor/)
  })

  // A mismatched echo means the server derived an address for a DIFFERENT
  // destination — funds sent there are unrecoverable (no refund).
  it("throws when any destination field does not echo the request", () => {
    expect(() => assertDepositAddress(response({ chain_id: "yominet-1" }), REQUEST)).toThrow(
      /chain_id mismatch/,
    )
    expect(() => assertDepositAddress(response({ asset_denom: "0xdead" }), REQUEST)).toThrow(
      /asset_denom mismatch/,
    )
    expect(() => assertDepositAddress(response({ wallet_address: "init1other" }), REQUEST)).toThrow(
      /wallet_address mismatch/,
    )
  })
})

describe("selectFreshCursor", () => {
  const MOUNTED_AT = 1_000

  it("selects the cursor from a fetch that succeeded after mount", () => {
    expect(
      selectFreshCursor({ data: response({}), dataUpdatedAt: MOUNTED_AT, mountedAt: MOUNTED_AT }),
    ).toBe(response({}).cursor)
    expect(
      selectFreshCursor({
        data: response({}),
        dataUpdatedAt: MOUNTED_AT + 1,
        mountedAt: MOUNTED_AT,
      }),
    ).toBe(response({}).cursor)
  })

  // Direction-pinning test: after a FAILED mount refetch, React Query keeps
  // the cached data but does not advance dataUpdatedAt — the stale cursor
  // predates the deposit just completed at this reused address, so leaking it
  // would bounce "Make another transfer" straight back to tracking. This is
  // exactly why `isFetchedAfterMount` (true even on a failed refetch) was
  // rejected.
  it("returns empty when cached data predates the mount (failed refetch)", () => {
    expect(
      selectFreshCursor({
        data: response({}),
        dataUpdatedAt: MOUNTED_AT - 1,
        mountedAt: MOUNTED_AT,
      }),
    ).toBe("")
  })

  it("returns empty before any data exists", () => {
    expect(selectFreshCursor({ data: undefined, dataUpdatedAt: 0, mountedAt: MOUNTED_AT })).toBe("")
  })
})
