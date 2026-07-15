import { describe, expect, it } from "vitest"
import { assertDepositAddress, selectFreshDepositAddress } from "./depositAddress"
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
  it("parses a matching response", () => {
    const target = response({})
    expect(assertDepositAddress(target, REQUEST)).toEqual(target)
  })

  it("accepts denom and wallet casing differences", () => {
    const target = response({
      asset_denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      wallet_address: REQUEST.walletAddress.toUpperCase(),
    })
    expect(assertDepositAddress(target, REQUEST)).toEqual(target)
  })

  // Every accepted value is rendered as a payment destination, so non-hex,
  // truncated, oversized and prefix-less values must fail at the boundary.
  it.each(["", "0x1234", `0x${"12".repeat(21)}`, `0X${"12".repeat(20)}`, `0x${"zz".repeat(20)}`])(
    "throws on an invalid deposit address: %s",
    (depositAddress) => {
      expect(() =>
        assertDepositAddress(response({ deposit_address: depositAddress }), REQUEST),
      ).toThrow(/invalid deposit address/)
    },
  )

  it("accepts lower-case and checksummed 20-byte addresses", () => {
    expect(() =>
      assertDepositAddress(
        response({ deposit_address: "0x6f83d3d8966cd166adff61cdc7c36e9fef06a75a" }),
        REQUEST,
      ),
    ).not.toThrow()
    expect(() => assertDepositAddress(response({}), REQUEST)).not.toThrow()
  })

  it("throws when the deposit address is missing or not a string", () => {
    const target = response({})
    expect(() => assertDepositAddress({ ...target, deposit_address: undefined }, REQUEST)).toThrow(
      /invalid deposit address/,
    )
    expect(() => assertDepositAddress({ ...target, deposit_address: 123 }, REQUEST)).toThrow(
      /invalid deposit address/,
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

describe("selectFreshDepositAddress", () => {
  it("returns data only after a successful fetch following mount", () => {
    const data = response({})
    expect(selectFreshDepositAddress({ data, isFetchedAfterMount: true, isSuccess: true })).toBe(
      data,
    )
  })

  // Cached data must not expose either the address or cursor before the mount
  // refetch succeeds; displaying it would let a transfer beat cursor issuance.
  it("withholds cached data before the mount refetch settles", () => {
    expect(
      selectFreshDepositAddress({
        data: response({}),
        isFetchedAfterMount: false,
        isSuccess: true,
      }),
    ).toBeUndefined()
  })

  // `isFetchedAfterMount` also turns true after a failed refetch while React
  // Query retains cached data. The success gate keeps that stale pair hidden.
  it("withholds cached data after a failed mount refetch", () => {
    expect(
      selectFreshDepositAddress({
        data: response({}),
        isFetchedAfterMount: true,
        isSuccess: false,
      }),
    ).toBeUndefined()
  })

  it("returns undefined before any data exists", () => {
    expect(
      selectFreshDepositAddress({
        data: undefined,
        isFetchedAfterMount: true,
        isSuccess: true,
      }),
    ).toBeUndefined()
  })
})
