import { describe, expect, it } from "vitest"
import {
  assertDepositsAtAddress,
  DepositAddressMismatchError,
  displayBucket,
  isTerminalBucket,
  pollInterval,
  pollUntilAllTerminal,
  pollUntilTerminal,
  selectTrackedDeposit,
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

describe("selectTrackedDeposit", () => {
  it("prefers an in-progress deposit over a stale terminal one at the same address", () => {
    const stale = deposit({ id: "old", status: "completed", bucket: "completed" })
    const fresh = deposit({ id: "new", status: "detected", bucket: "waiting" })
    expect(selectTrackedDeposit([stale, fresh])).toBe(fresh)
  })

  it("falls back to a terminal match so a finished deposit still resolves", () => {
    const finished = deposit({ status: "completed", bucket: "completed" })
    expect(selectTrackedDeposit([finished])).toBe(finished)
  })

  // The deposit address is deterministic, so several deposits can coexist at
  // it; the newest one is the transfer the user is acting on.
  it("prefers the newest in-progress deposit when several are in flight", () => {
    const stuck = deposit({
      id: "old",
      status: "bridge_submitting",
      bucket: "processing",
      created_at: "2026-07-01T00:00:00Z",
    })
    const fresh = deposit({
      id: "new",
      status: "detected",
      bucket: "waiting",
      created_at: "2026-07-08T00:00:00Z",
    })
    expect(selectTrackedDeposit([fresh, stuck])).toBe(fresh)
    expect(selectTrackedDeposit([stuck, fresh])).toBe(fresh)
  })

  it("prefers the newest terminal deposit when every match is terminal", () => {
    const older = deposit({
      id: "old",
      status: "completed",
      bucket: "completed",
      created_at: "2026-07-01T00:00:00Z",
    })
    const newer = deposit({
      id: "new",
      status: "completed",
      bucket: "completed",
      created_at: "2026-07-08T00:00:00Z",
    })
    expect(selectTrackedDeposit([older, newer])).toBe(newer)
  })

  it("returns null without a list or with an empty list", () => {
    expect(selectTrackedDeposit(undefined)).toBe(null)
    expect(selectTrackedDeposit([])).toBe(null)
  })

  // An unknown bucket counts as terminal (negated isTerminalBucket), so an old
  // deposit with one can never shadow the real in-progress transfer — even
  // when it is newer.
  it("prefers a known in-progress deposit over a newer unknown-bucket one", () => {
    const unknown = deposit({
      id: "old",
      bucket: "refunding",
      created_at: "2026-07-08T00:00:00Z",
    })
    const known = deposit({ id: "new", bucket: "waiting", created_at: "2026-07-01T00:00:00Z" })
    expect(selectTrackedDeposit([unknown, known])).toBe(known)
  })

  // As the terminal fallback it still resolves (and renders fail-closed via
  // displayBucket) instead of leaving discovery empty.
  it("resolves an unknown-bucket deposit as the terminal fallback", () => {
    const unknown = deposit({ bucket: "refunding" })
    expect(selectTrackedDeposit([unknown])).toBe(unknown)
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

  // A null/undefined deposit is the transient not-yet-fetched frame, not a
  // terminal answer — stopping here would freeze the screen on "Waiting".
  it("keeps polling a not-yet-fetched deposit", () => {
    expect(pollUntilTerminal(null, 0)).not.toBe(false)
    expect(pollUntilTerminal(undefined, 0)).not.toBe(false)
  })
})

describe("pollUntilAllTerminal", () => {
  it("stops polling when every deposit at the address is terminal", () => {
    const finished = deposit({ id: "1", status: "completed", bucket: "completed" })
    const failed = deposit({ id: "2", status: "failed", bucket: "failed" })
    expect(pollUntilAllTerminal([finished, failed], 0)).toBe(false)
  })

  it("keeps polling while anything at the address is in flight", () => {
    const finished = deposit({ id: "1", status: "completed", bucket: "completed" })
    const inFlight = deposit({ id: "2", status: "detected", bucket: "waiting" })
    expect(pollUntilAllTerminal([finished, inFlight], 0)).not.toBe(false)
  })

  // The empty list is the transient re-discovery frame: tracking mounts only
  // after detection saw a deposit, so an empty response means the record is
  // still on its way — stopping here would freeze the screen on "Waiting".
  it("keeps polling an empty or not-yet-fetched list", () => {
    expect(pollUntilAllTerminal([], 0)).not.toBe(false)
    expect(pollUntilAllTerminal(undefined, 0)).not.toBe(false)
  })

  // Direction-pinning test: an unknown bucket counts as terminal (negated
  // isTerminalBucket), so it can never hold the poll open forever.
  it("counts an unknown bucket as terminal (fail-closed)", () => {
    expect(pollUntilAllTerminal([deposit({ bucket: "refunding" })], 0)).toBe(false)
  })

  it("polls in-flight deposits on the idle cadence once backed off", () => {
    const inFlight = deposit({ status: "detected", bucket: "waiting" })
    expect(pollUntilAllTerminal([inFlight], 10 * 60_000)).toBe(15_000)
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
