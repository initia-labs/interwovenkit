import { describe, expect, it } from "vitest"
import {
  assertDepositsAtAddress,
  assertDirectDeposit,
  assertLifiDeposit,
  bySourceTxPollInterval,
  classifyWalletBucket,
  createDepositBySourceTxQueryOptions,
  DepositAddressMismatchError,
  displayBucket,
  isTerminalBucket,
  pollInterval,
  pollUntilTerminal,
  resolveTrackedDeposit,
} from "./deposits"
import { ETHEREUM_USDC_DENOM } from "./source"
import {
  deposit,
  DEPOSIT_ADDRESS,
  DST_TX_HASH,
  httpError,
  RECIPIENT,
  runQueryFn,
  SRC_TX_HASH,
  stubApi,
} from "./testing"
import type { Deposit } from "./types"
import { ACTIVE_DEPOSIT_BUCKETS, DEPOSIT_BUCKETS, TERMINAL_DEPOSIT_BUCKETS } from "./types"

// Completeness guard: if the bucket contract gains a value, this fails until
// the active/terminal split covers it too.
it("splits every bucket in the contract into active or terminal", () => {
  expect(new Set([...ACTIVE_DEPOSIT_BUCKETS, ...TERMINAL_DEPOSIT_BUCKETS])).toEqual(
    new Set(DEPOSIT_BUCKETS),
  )
})

describe("isTerminalBucket", () => {
  it("treats the terminal set as terminal", () => {
    for (const bucket of TERMINAL_DEPOSIT_BUCKETS) expect(isTerminalBucket(bucket)).toBe(true)
  })

  it("treats the active set as non-terminal", () => {
    for (const bucket of ACTIVE_DEPOSIT_BUCKETS) expect(isTerminalBucket(bucket)).toBe(false)
  })

  // Direction-pinning test: a bucket outside the known contract must count as
  // TERMINAL so polling stops — the fail-closed direction this judgment exists
  // for. Flipping the implementation to positive-set membership breaks this.
  it("treats an unknown bucket as terminal (fail-closed)", () => {
    expect(isTerminalBucket("refunding")).toBe(true)
    expect(isTerminalBucket("")).toBe(true)
    expect(isTerminalBucket(undefined as unknown as string)).toBe(true)
  })
})

describe("pollInterval", () => {
  const FIVE_MINUTES = 5 * 60_000

  it("keeps the fast cadence while the screen is fresh", () => {
    expect(pollInterval(0)).toBe(3000)
    expect(pollInterval(FIVE_MINUTES - 1)).toBe(3000)
  })

  // A deposit screen can stay open far longer than one transfer takes (a QR
  // left open during an exchange withdrawal, an onramp KYC); past the idle
  // threshold the interval must relax so an idle screen stops costing the
  // backend the full detection cadence.
  it("relaxes to the idle cadence once the screen has been open long enough", () => {
    expect(pollInterval(FIVE_MINUTES)).toBe(15_000)
    expect(pollInterval(FIVE_MINUTES * 100)).toBe(15_000)
  })
})

describe("pollUntilTerminal", () => {
  it("stops polling once the deposit is terminal", () => {
    expect(pollUntilTerminal(deposit({ status: "completed", bucket: "completed" }), 0)).toBe(false)
  })

  // A null/undefined deposit covers both the not-yet-fetched frame and a query
  // error before data exists. Neither is terminal: stopping would freeze the
  // screen and make the UI's automatic-recovery message false.
  it("keeps polling without data so transient errors can recover", () => {
    expect(pollUntilTerminal(null, 0)).not.toBe(false)
    expect(pollUntilTerminal(undefined, 0)).not.toBe(false)
  })
})

describe("resolveTrackedDeposit", () => {
  // Tracking receives the exact id detected by useNewDeposits, so a newly
  // terminal record remains the target even when another deposit is active at
  // the reused address.
  it("keeps the id-addressed terminal deposit as the tracking target", () => {
    const detected = deposit({ id: "new", status: "completed", bucket: "completed" })
    expect(resolveTrackedDeposit(detected, DEPOSIT_ADDRESS, null).deposit).toBe(detected)
  })

  it("rejects an id-addressed record from another deposit address", () => {
    const foreign = deposit({ deposit_address: "0x0000000000000000000000000000000000000bad" })
    const result = resolveTrackedDeposit(foreign, DEPOSIT_ADDRESS, null)
    expect(result.deposit).toBeNull()
    expect(result.error).toBeInstanceOf(DepositAddressMismatchError)
  })
})

describe("displayBucket", () => {
  it("renders the transient null frame as waiting", () => {
    expect(displayBucket(null)).toBe("waiting")
  })

  it("passes every known bucket through unchanged", () => {
    for (const bucket of DEPOSIT_BUCKETS) {
      expect(displayBucket(deposit({ bucket }))).toBe(bucket)
    }
  })

  // Direction-pinning test: an unknown (or missing) bucket renders as the
  // failed screen — safe, actionable copy — never as an in-flight screen that
  // would pair with stopped polling.
  it("renders an unknown bucket as failed (fail-closed)", () => {
    expect(displayBucket(deposit({ bucket: "refunding" }))).toBe("failed")
    expect(displayBucket(deposit({ bucket: undefined as unknown as string }))).toBe("failed")
  })
})

describe("assertDepositsAtAddress", () => {
  it("passes deposits through when every address matches", () => {
    const deposits = [deposit({ id: "1" }), deposit({ id: "2" })]
    expect(assertDepositsAtAddress(deposits, DEPOSIT_ADDRESS)).toBe(deposits)
  })

  // The server matches the filter case-insensitively; the guard must not
  // reject its own contract.
  it("matches case-insensitively like the server filter", () => {
    const deposits = [deposit({ deposit_address: DEPOSIT_ADDRESS.toUpperCase() })]
    expect(assertDepositsAtAddress(deposits, DEPOSIT_ADDRESS.toLowerCase())).toBe(deposits)
  })

  it("passes an empty list", () => {
    expect(assertDepositsAtAddress([], DEPOSIT_ADDRESS)).toEqual([])
  })

  // A foreign deposit means the server filter misbehaved (or an older server
  // ignored the parameter); trusting it would track someone else's deposit.
  it("throws when the list contains a deposit for another address", () => {
    const foreign = deposit({
      id: "foreign",
      deposit_address: "0x0000000000000000000000000000000000000bad",
    })
    const call = () => assertDepositsAtAddress([deposit(), foreign], DEPOSIT_ADDRESS)
    expect(call).toThrow(/foreign/)
    // Typed so the tracking screen can route it to the hard-error path instead
    // of the transient "retrying" notice.
    expect(call).toThrow(DepositAddressMismatchError)
  })
})

describe("classifyWalletBucket", () => {
  it("reports every known bucket unchanged and the pre-discovery frame as waiting", () => {
    for (const bucket of DEPOSIT_BUCKETS) {
      expect(classifyWalletBucket(deposit({ bucket }))).toBe(bucket)
    }
    expect(classifyWalletBucket(null)).toBe("waiting")
  })

  // Unlike displayBucket: the user has just signed a real transfer.
  it("keeps an unknown bucket unknown instead of calling it failed", () => {
    expect(classifyWalletBucket(deposit({ bucket: "refunding" }))).toBe("unknown")
    expect(classifyWalletBucket(deposit({ bucket: "" }))).toBe("unknown")
  })
})

describe("bySourceTxPollInterval", () => {
  it("polls on the shared cadence until the record exists", () => {
    expect(bySourceTxPollInterval(null, 0)).toBe(3000)
    expect(bySourceTxPollInterval(undefined, 6 * 60_000)).toBe(15_000)
    expect(bySourceTxPollInterval(deposit(), 0)).toBe(false)
  })
})

describe("createDepositBySourceTxQueryOptions", () => {
  const run = (result: unknown) => {
    const { api, calls } = stubApi(result)
    const promise = runQueryFn(
      createDepositBySourceTxQueryOptions(api, SRC_TX_HASH, true, Date.now()),
    )
    return { promise, calls }
  }

  // ky's own retries would re-send a deterministic failure behind the poll interval.
  it("reads the record for the exact source transaction without ky retries", async () => {
    const record = deposit()
    const { promise, calls } = run(record)
    await expect(promise).resolves.toBe(record)
    expect(calls[0].url).toBe(`v1/deposits/by-source-tx/${SRC_TX_HASH}`)
    expect(calls[0].options).toEqual({ searchParams: { src_chain_id: "1" }, retry: 0 })
  })

  it("treats a 404 as an indexing delay, not an error", async () => {
    await expect(run(httpError(404, { message: "not found" })).promise).resolves.toBeNull()
  })

  it("surfaces every other failure normalized", async () => {
    await expect(run(httpError(500, { message: "boom" })).promise).rejects.toThrow("boom")
  })
})

const IDENTITY = {
  depositAddress: DEPOSIT_ADDRESS,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  recipient: RECIPIENT,
}

const OTHER_ADDRESS = "0x9999999999999999999999999999999999999999"

// Shared by both transports: the record is always the Ethereum USDC leg at the issued address.
const IDENTITY_MISMATCHES: [Partial<Deposit>, RegExp][] = [
  [{ src_chain_id: "8453" }, /src_chain_id is 8453/],
  [{ src_denom: "ethereum-native" }, /not Ethereum USDC/],
  [{ deposit_address: OTHER_ADDRESS }, /deposit_address/],
  [{ dst_chain_id: "yominet-1" }, /dst_chain_id/],
  [{ dst_denom: "uinit" }, /dst_denom/],
  [{ wallet_address: "init1someoneelse" }, /wallet_address/],
]

describe("assertDirectDeposit", () => {
  const DIRECT = { ...IDENTITY, srcTxHash: SRC_TX_HASH, amount: "5000000" }

  it("accepts the record the session sent, in any casing", () => {
    for (const record of [
      deposit(),
      deposit({
        src_tx_hash: `0x${SRC_TX_HASH.slice(2).toUpperCase()}`,
        deposit_address: DEPOSIT_ADDRESS.toLowerCase(),
        src_denom: ETHEREUM_USDC_DENOM.toLowerCase(),
      }),
    ]) {
      expect(assertDirectDeposit(record, DIRECT)).toBe(record)
    }
  })

  it.each<[Partial<Deposit>, RegExp]>([
    [{ src_tx_hash: DST_TX_HASH }, /src_tx_hash/],
    [{ amount: "4000000" }, /amount 4000000/],
    ...IDENTITY_MISMATCHES,
  ])("rejects %o", (overrides, message) => {
    expect(() => assertDirectDeposit(deposit(overrides), DIRECT)).toThrow(message)
  })

  it("rejects a malformed record with a shape error, not a TypeError", () => {
    const missingHash = { ...deposit(), src_tx_hash: undefined }
    expect(() => assertDirectDeposit(missingHash, DIRECT)).toThrow(
      "Deposit record has an invalid src_tx_hash: undefined",
    )
    expect(() => assertDirectDeposit("nope", DIRECT)).toThrow("Deposit record is not an object")
  })
})

describe("assertLifiDeposit", () => {
  // The Ethereum leg's hash and post-slippage amount, never the source transfer's.
  const lifiDeposit = (overrides: Partial<Deposit> = {}) =>
    deposit({ src_tx_hash: DST_TX_HASH, amount: "4950000", ...overrides })

  it("accepts an indexed record without comparing the amount or, when unreported, the hash", () => {
    const record = lifiDeposit()
    expect(assertLifiDeposit(record, IDENTITY)).toBe(record)
    expect(
      assertLifiDeposit(record, {
        ...IDENTITY,
        dstTxHash: `0x${DST_TX_HASH.slice(2).toUpperCase()}`,
      }),
    ).toBe(record)
  })

  it("rejects a record whose hash is not the reported Ethereum delivery", () => {
    expect(() => assertLifiDeposit(lifiDeposit(), { ...IDENTITY, dstTxHash: SRC_TX_HASH })).toThrow(
      /reported Ethereum delivery/,
    )
  })

  it.each(IDENTITY_MISMATCHES)("rejects %o", (overrides, message) => {
    expect(() => assertLifiDeposit(lifiDeposit(overrides), IDENTITY)).toThrow(message)
  })
})
