import type { KyInstance } from "ky"
import { HTTPError, type NormalizedOptions } from "ky"
import { describe, expect, it } from "vitest"
import {
  assertDirectDeposit,
  assertLifiDeposit,
  bySourceTxPollInterval,
  classifyWalletBucket,
  createDepositBySourceTxQueryOptions,
  walletPollUntilTerminal,
} from "./deposits"
import type { Deposit } from "./types"
import { DEPOSIT_BUCKETS } from "./types"

const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const DEPOSIT_ADDRESS = "0xAbCd000000000000000000000000000000000001"
const SRC_TX_HASH = `0x${"a".repeat(64)}`
const ETH_TX_HASH = `0x${"b".repeat(64)}`
const RECIPIENT = "init1recipient"

const deposit = (overrides: Partial<Deposit> = {}): Deposit =>
  ({
    id: "d1",
    src_chain_id: "1",
    src_tx_hash: SRC_TX_HASH,
    src_log_index: 0,
    src_denom: ETHEREUM_USDC,
    amount: "5000000",
    deposit_address: DEPOSIT_ADDRESS,
    wallet_address: RECIPIENT,
    dst_chain_id: "interwoven-1",
    dst_denom: "uusdc",
    dst_address: RECIPIENT,
    observed_height: 1,
    observed_at: "",
    status: "detected",
    bucket: "waiting",
    status_updated_at: "",
    created_at: "",
    updated_at: "",
    bot_tx_hash: "",
    bot_tx_explorer_url: "",
    ...overrides,
  }) as Deposit

const httpError = (status: number, body?: object) =>
  new HTTPError(
    new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: body ? { "content-type": "application/json" } : undefined,
    }),
    new Request("https://deposit.test/v1/deposits/by-source-tx/0x0"),
    {} as NormalizedOptions,
  )

interface Call {
  url: string
  options?: { searchParams?: Record<string, string> }
}

function stubApi(result: unknown) {
  const calls: Call[] = []
  const api = {
    get: (url: string, options?: Call["options"]) => {
      calls.push({ url, options })
      return {
        json: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
      }
    },
  } as unknown as KyInstance
  return { api, calls }
}

describe("classifyWalletBucket", () => {
  it("reports every known bucket unchanged", () => {
    for (const bucket of DEPOSIT_BUCKETS) {
      expect(classifyWalletBucket(deposit({ bucket }))).toBe(bucket)
    }
  })

  it("reports the pre-discovery frame as waiting", () => {
    expect(classifyWalletBucket(null)).toBe("waiting")
  })

  // Direction-pinning test, and deliberately the opposite of displayBucket: the
  // user has just signed a real transfer, so a bucket this client does not
  // recognize is a tracking-contract problem, never a financial failure.
  it("keeps an unknown bucket unknown instead of calling it failed", () => {
    expect(classifyWalletBucket(deposit({ bucket: "refunding" }))).toBe("unknown")
    expect(classifyWalletBucket(deposit({ bucket: "" }))).toBe("unknown")
  })
})

describe("walletPollUntilTerminal", () => {
  it("polls fast while the deposit is active and backs off once idle", () => {
    expect(walletPollUntilTerminal(deposit({ bucket: "waiting" }), 0)).toBe(3000)
    expect(walletPollUntilTerminal(deposit({ bucket: "processing" }), 6 * 60_000)).toBe(15_000)
  })

  it("keeps polling before the record exists", () => {
    expect(walletPollUntilTerminal(undefined, 0)).toBe(3000)
    expect(walletPollUntilTerminal(null, 0)).toBe(3000)
  })

  it("stops on every terminal bucket", () => {
    for (const bucket of ["completed", "failed", "below_minimum"]) {
      expect(walletPollUntilTerminal(deposit({ bucket }), 0)).toBe(false)
    }
  })

  // Automatic reads cannot resolve a bucket this client does not understand, so
  // the screen switches to manual refresh rather than polling a contract
  // mismatch forever.
  it("stops routine polling on an unknown bucket", () => {
    expect(walletPollUntilTerminal(deposit({ bucket: "refunding" }), 0)).toBe(false)
  })
})

describe("bySourceTxPollInterval", () => {
  it("polls around 5 s while the record is missing", () => {
    expect(bySourceTxPollInterval(null, 0)).toBe(5000)
    expect(bySourceTxPollInterval(null, 1)).toBe(6000)
    expect(bySourceTxPollInterval(undefined, 0.5)).toBe(5500)
  })

  it("stops once the deposit id is available", () => {
    expect(bySourceTxPollInterval(deposit(), 0)).toBe(false)
  })
})

describe("createDepositBySourceTxQueryOptions", () => {
  const PARAMS = { srcChainId: "1", srcTxHash: SRC_TX_HASH } as const

  it("reads the single record for the exact source transaction", async () => {
    const record = deposit()
    const { api, calls } = stubApi(record)
    const { queryFn } = createDepositBySourceTxQueryOptions(api, PARAMS, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).resolves.toBe(record)
    expect(calls[0].url).toBe(`v1/deposits/by-source-tx/${SRC_TX_HASH}`)
    expect(calls[0].options?.searchParams).toEqual({ src_chain_id: "1" })
  })

  // Telling a user whose funds are already in flight that something went wrong
  // would be false: the indexer simply has not observed the transfer yet.
  it("treats a 404 as an indexing delay, not an error", async () => {
    const { api } = stubApi(httpError(404, { message: "not found" }))
    const { queryFn } = createDepositBySourceTxQueryOptions(api, PARAMS, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).resolves.toBeNull()
  })

  it("surfaces every other failure normalized", async () => {
    const { api } = stubApi(httpError(500, { message: "boom" }))
    const { queryFn } = createDepositBySourceTxQueryOptions(api, PARAMS, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).rejects.toThrow("boom")
  })

  it("passes the enabled gate through and never caches", () => {
    const { api } = stubApi(null)
    const options = createDepositBySourceTxQueryOptions(api, PARAMS, false)
    expect(options.enabled).toBe(false)
    expect(options.staleTime).toBe(0)
  })

  it("keys on the source transaction", () => {
    const { api } = stubApi(null)
    expect(createDepositBySourceTxQueryOptions(api, PARAMS, true).queryKey).toContain(SRC_TX_HASH)
  })
})

const DIRECT_IDENTITY = {
  srcTxHash: SRC_TX_HASH,
  amount: "5000000",
  srcDenom: ETHEREUM_USDC,
  depositAddress: DEPOSIT_ADDRESS,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  recipient: RECIPIENT,
}

describe("assertDirectDeposit", () => {
  it("accepts the record the session actually sent", () => {
    const record = deposit()
    expect(assertDirectDeposit(record, DIRECT_IDENTITY)).toBe(record)
  })

  it("compares hashes and the issued address case-insensitively", () => {
    const record = deposit({
      src_tx_hash: `0x${SRC_TX_HASH.slice(2).toUpperCase()}`,
      deposit_address: DEPOSIT_ADDRESS.toLowerCase(),
    })
    expect(assertDirectDeposit(record, DIRECT_IDENTITY)).toBe(record)
  })

  it("compares EVM denoms through normalizeDenom", () => {
    const record = deposit({ src_denom: ETHEREUM_USDC.toLowerCase() })
    expect(assertDirectDeposit(record, DIRECT_IDENTITY)).toBe(record)
  })

  it("rejects a record from another source chain", () => {
    expect(() => assertDirectDeposit(deposit({ src_chain_id: "8453" }), DIRECT_IDENTITY)).toThrow(
      /src_chain_id is 8453/,
    )
  })

  // The direct executor sends exactly one transfer of a known size, so an
  // amount or hash disagreement means this is somebody else's deposit at the
  // same reused address.
  it("rejects another transaction or another amount", () => {
    expect(() =>
      assertDirectDeposit(deposit({ src_tx_hash: ETH_TX_HASH }), DIRECT_IDENTITY),
    ).toThrow(/src_tx_hash/)
    expect(() => assertDirectDeposit(deposit({ amount: "4000000" }), DIRECT_IDENTITY)).toThrow(
      /amount 4000000/,
    )
  })

  it("rejects another asset, address, destination or recipient", () => {
    expect(() =>
      assertDirectDeposit(deposit({ src_denom: "ethereum-native" }), DIRECT_IDENTITY),
    ).toThrow(/src_denom/)
    expect(() =>
      assertDirectDeposit(
        deposit({ deposit_address: "0x9999999999999999999999999999999999999999" }),
        DIRECT_IDENTITY,
      ),
    ).toThrow(/deposit_address/)
    expect(() =>
      assertDirectDeposit(deposit({ dst_chain_id: "yominet-1" }), DIRECT_IDENTITY),
    ).toThrow(/dst_chain_id/)
    expect(() => assertDirectDeposit(deposit({ dst_denom: "uinit" }), DIRECT_IDENTITY)).toThrow(
      /dst_denom/,
    )
    expect(() =>
      assertDirectDeposit(deposit({ wallet_address: "init1someoneelse" }), DIRECT_IDENTITY),
    ).toThrow(/wallet_address/)
  })
})

const LIFI_IDENTITY = {
  depositAddress: DEPOSIT_ADDRESS,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  recipient: RECIPIENT,
  ethereumUsdc: ETHEREUM_USDC,
}

// The deposit records the Ethereum leg, so its hash and amount belong to the
// receiving transaction — not the Base/Arbitrum transfer the user signed.
const lifiDeposit = (overrides: Partial<Deposit> = {}) =>
  deposit({ src_tx_hash: ETH_TX_HASH, amount: "4950000", ...overrides })

describe("assertLifiDeposit", () => {
  it("accepts an indexed record without any amount comparison", () => {
    const record = lifiDeposit()
    expect(assertLifiDeposit(record, LIFI_IDENTITY)).toBe(record)
  })

  it("accepts a valid handoff when the envelope supplied no dst_tx_hash", () => {
    const record = lifiDeposit({ src_tx_hash: `0x${"e".repeat(64)}` })
    expect(assertLifiDeposit(record, LIFI_IDENTITY)).toBe(record)
  })

  it("binds to the reported Ethereum delivery when the envelope supplies one", () => {
    const record = lifiDeposit()
    expect(assertLifiDeposit(record, { ...LIFI_IDENTITY, dstTxHash: ETH_TX_HASH })).toBe(record)
    expect(
      assertLifiDeposit(record, {
        ...LIFI_IDENTITY,
        dstTxHash: `0x${ETH_TX_HASH.slice(2).toUpperCase()}`,
      }),
    ).toBe(record)
  })

  it("rejects a record whose hash is not the reported Ethereum delivery", () => {
    expect(() =>
      assertLifiDeposit(lifiDeposit(), { ...LIFI_IDENTITY, dstTxHash: SRC_TX_HASH }),
    ).toThrow(/reported Ethereum delivery/)
  })

  it("requires the Ethereum leg's chain and canonical asset", () => {
    expect(() => assertLifiDeposit(lifiDeposit({ src_chain_id: "8453" }), LIFI_IDENTITY)).toThrow(
      /src_chain_id is 8453/,
    )
    expect(() =>
      assertLifiDeposit(lifiDeposit({ src_denom: "ethereum-native" }), LIFI_IDENTITY),
    ).toThrow(/not Ethereum USDC/)
  })

  it("requires the issued address, destination and recipient", () => {
    expect(() =>
      assertLifiDeposit(
        lifiDeposit({ deposit_address: "0x9999999999999999999999999999999999999999" }),
        LIFI_IDENTITY,
      ),
    ).toThrow(/deposit_address/)
    expect(() => assertLifiDeposit(lifiDeposit({ dst_denom: "uinit" }), LIFI_IDENTITY)).toThrow(
      /dst_denom/,
    )
    expect(() =>
      assertLifiDeposit(lifiDeposit({ wallet_address: "init1someoneelse" }), LIFI_IDENTITY),
    ).toThrow(/wallet_address/)
  })
})
