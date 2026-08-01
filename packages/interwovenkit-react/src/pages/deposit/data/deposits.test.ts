import { describe, expect, it } from "vitest"
import {
  assertDepositsAtAddress,
  DepositAddressMismatchError,
  displayBucket,
  isTerminalBucket,
  pollInterval,
  pollUntilTerminal,
  resolveTrackedDeposit,
} from "./deposits"
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

const DEPOSIT_ADDRESS = "0xAbCd000000000000000000000000000000000001"

const deposit = (overrides: Partial<Deposit>): Deposit => ({
  id: "1",
  src_chain_id: "1",
  src_tx_hash: "0xhash",
  src_log_index: 0,
  src_denom: "ethereum-native",
  amount: "1",
  deposit_address: DEPOSIT_ADDRESS,
  wallet_address: "init1wallet",
  dst_chain_id: "interwoven-1",
  dst_denom: "uusdc",
  dst_address: "init1wallet",
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
    const call = () => assertDepositsAtAddress([deposit({}), foreign], DEPOSIT_ADDRESS)
    expect(call).toThrow(/foreign/)
    // Typed so the tracking screen can route it to the hard-error path instead
    // of the transient "retrying" notice.
    expect(call).toThrow(DepositAddressMismatchError)
  })
})
