import { describe, expect, it } from "vitest"
import { BridgeStatusConflictError, RateLimitedError } from "../data/bridges"
import type { BridgeStatusState } from "../data/types"
import {
  type DepositProgressInputs,
  deriveDepositProgress,
  isResumableDepositSession,
  resumeStageLabel,
  selectResumableSessions,
  trackedSourceHash,
} from "./depositProgressLogic"
import type { DepositSession, DepositSessionPhase } from "./depositSession"

const SOURCE_HASH = `0x${"a".repeat(64)}`
const REPLACEMENT_HASH = `0x${"b".repeat(64)}`

const session = (overrides: Partial<DepositSession> = {}): DepositSession => ({
  version: 1,
  id: "session-1",
  apiUrl: "https://deposit.example.com",
  createdAt: 1,
  updatedAt: 2,
  transport: "lifi",
  phase: "source_sent",
  source: {
    chainId: "8453",
    denom: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    sender: "0xsender",
    amount: "5000000",
    symbol: "USDC",
    chainName: "Base",
  },
  destination: {
    chainId: "interwoven-1",
    denom: "uusdc",
    recipient: "init1recipient",
    symbol: "iUSD",
    chainName: "Initia",
  },
  depositAddress: "0xAbCd000000000000000000000000000000000001",
  cursor: "cursor-1",
  transaction: { chainId: "8453", to: "0xtoken", data: "0xdead", value: "0" },
  currentSourceHash: SOURCE_HASH,
  ...overrides,
})

const inputs = (overrides: Partial<DepositProgressInputs> = {}): DepositProgressInputs => ({
  source: { isError: false, hasProvider: true },
  bridge: {},
  direct: { isError: false },
  deposit: { bucket: "waiting", isError: false, isSelfRecipient: true },
  isDelayed: false,
  ...overrides,
})

/** Source confirmed, so the derivation reaches the transport-specific stage. */
const confirmedSource = {
  source: {
    isError: false,
    hasProvider: true,
    outcome: { status: "confirmed" as const, hash: SOURCE_HASH, blockNumber: 10 },
  },
}

describe("trackedSourceHash", () => {
  it("prefers the current hash so a repriced replacement supersedes the original", () => {
    expect(
      trackedSourceHash(
        session({ currentSourceHash: REPLACEMENT_HASH, originalSourceHash: SOURCE_HASH }),
      ),
    ).toBe(REPLACEMENT_HASH)
  })

  it("falls back to the wallet response before the first session write lands", () => {
    expect(
      trackedSourceHash(
        session({
          currentSourceHash: undefined,
          submitted: { hash: SOURCE_HASH, from: "0xsender" },
        }),
      ),
    ).toBe(SOURCE_HASH)
  })

  it("is empty when nothing was ever returned", () => {
    expect(trackedSourceHash(session({ currentSourceHash: undefined }))).toBe("")
  })
})

describe("isResumableDepositSession", () => {
  it.each<DepositSessionPhase>(["prepared", "approval_prompt", "approval_sent"])(
    "excludes the abandoned form draft %s",
    (phase) => {
      expect(isResumableDepositSession(session({ phase }))).toBe(false)
    },
  )

  it.each<DepositSessionPhase>([
    "send_prompt",
    "submission_unknown",
    "source_sent",
    "deposit_indexed",
  ])("offers %s, where a send may already have happened", (phase) => {
    expect(isResumableDepositSession(session({ phase }))).toBe(true)
  })

  it("excludes terminal sessions", () => {
    expect(isResumableDepositSession(session({ phase: "terminal" }))).toBe(false)
  })
})

describe("selectResumableSessions", () => {
  const mine = session({ id: "mine" })
  const theirs = session({
    id: "theirs",
    destination: { ...session().destination, recipient: "init1somebodyelse" },
  })
  const draft = session({ id: "draft", phase: "prepared" })
  const done = session({ id: "done", phase: "terminal" })

  it("offers only in-flight sessions credited to the connected account", () => {
    expect(
      selectResumableSessions([mine, theirs, draft, done], "init1recipient").map(({ id }) => id),
    ).toEqual(["mine"])
  })

  it("matches the recipient case-insensitively", () => {
    expect(selectResumableSessions([mine], "INIT1RECIPIENT").map(({ id }) => id)).toEqual(["mine"])
  })

  it("offers nothing when no account is connected", () => {
    expect(selectResumableSessions([mine], "")).toEqual([])
  })
})

describe("resumeStageLabel", () => {
  it.each([
    ["source_pending", "Source transaction pending"],
    ["source_replaced", "Source transaction replaced"],
    ["bridge_not_found", "Waiting for the bridge"],
    ["bridge_pending", "Bridging to Ethereum"],
    ["deposit_pending", "Waiting for deposit detection"],
    ["bridge_refunding", "Refund in progress"],
    ["waiting", "Confirming your deposit"],
    ["processing", "Delivering"],
    ["deposit_indexed", "Delivering"],
    ["unknown", "Status unavailable"],
  ])("maps lastState %s", (lastState, expected) => {
    expect(resumeStageLabel(session({ lastState }))).toBe(expected)
  })

  it("falls back to the phase when no state was recorded", () => {
    expect(resumeStageLabel(session({ phase: "send_prompt", lastState: undefined }))).toBe(
      "Checking your transaction",
    )
    expect(resumeStageLabel(session({ phase: "submission_unknown", lastState: undefined }))).toBe(
      "Checking your transaction",
    )
    expect(resumeStageLabel(session({ phase: "deposit_indexed", lastState: undefined }))).toBe(
      "Delivering",
    )
    expect(resumeStageLabel(session({ phase: "source_sent", lastState: undefined }))).toBe(
      "Source transaction pending",
    )
  })

  it("ignores an unrecognized recorded state rather than rendering it raw", () => {
    expect(resumeStageLabel(session({ phase: "source_sent", lastState: "moon_phase" }))).toBe(
      "Source transaction pending",
    )
  })
})

describe("deriveDepositProgress: no session", () => {
  it("reports the record is gone without claiming anything about the transfer", () => {
    const view = deriveDepositProgress(null, inputs())
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe("Deposit not found")
    expect(view.message).toContain("Any transfer already sent is unaffected")
    expect(view.showClose).toBe(true)
    expect(view.showRefresh).toBe(false)
  })
})

describe("deriveDepositProgress: no source hash", () => {
  it.each<DepositSessionPhase>(["send_prompt", "submission_unknown"])(
    "%s without a hash is ambiguous: no polling, no resend",
    (phase) => {
      const view = deriveDepositProgress(session({ phase, currentSourceHash: undefined }), inputs())
      expect(view.stage).toBe("none")
      expect(view.variant).toBe("problem")
      expect(view.heading).toBe("Checking your transaction")
      expect(view.message).toContain("may have been submitted")
      expect(view.showClose).toBe(true)
      // Nothing to refresh: no hash means no backend read exists.
      expect(view.showRefresh).toBe(false)
    },
  )

  it("a session that never reached a prompt is not ambiguous", () => {
    const view = deriveDepositProgress(
      session({ phase: "prepared", currentSourceHash: undefined }),
      inputs(),
    )
    expect(view.heading).toBe("Nothing to track yet")
    expect(view.message).toContain("never submitted")
    expect(view.showClose).toBe(true)
  })
})

describe("deriveDepositProgress: source stage", () => {
  it("waits on the source receipt with the source chain named", () => {
    const view = deriveDepositProgress(session(), inputs())
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.message).toBe("Waiting for your Base transaction to confirm.")
    expect(view.showChips).toBe(true)
    expect(view.showClose).toBe(false)
    expect(view.persist).toEqual({ lastState: "source_pending" })
  })

  it("a pending outcome is not a decision: keep waiting", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ source: { isError: false, hasProvider: true, outcome: { status: "pending" } } }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toBeUndefined()
  })

  it("an RPC read failure keeps the pending copy and says so", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ source: { isError: true, hasProvider: true } }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toBe("Still checking…")
    // An unread node is never rendered as a failed transfer.
    expect(view.showClose).toBe(false)
  })

  it("a missing pinned provider is a capability gap, not evidence", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ source: { isError: false, hasProvider: false } }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toBe("Cannot verify on Base right now. We'll keep trying.")
  })

  it("a repriced replacement keeps tracking under the replacement copy", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          hasProvider: true,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SOURCE_HASH,
            reason: "repriced",
          },
        },
      }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toContain("replaced the transaction")
    expect(view.persist).toEqual({ lastState: "source_replaced" })
  })

  it("persisted replacement lineage survives the reload that loses the outcome", () => {
    const view = deriveDepositProgress(
      session({ originalSourceHash: SOURCE_HASH, currentSourceHash: REPLACEMENT_HASH }),
      inputs(),
    )
    expect(view.note).toContain("replaced the transaction")
    expect(view.persist).toEqual({ lastState: "source_replaced" })
  })

  it("a mined cancellation is the one route to Deposit not sent", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          hasProvider: true,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SOURCE_HASH,
            reason: "cancelled",
          },
        },
      }),
    )
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("failed")
    expect(view.heading).toBe("Deposit not sent")
    // Fees were spent and the approval may stand: this is not "nothing happened".
    expect(view.note).toContain("Network fees were still spent")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "source_cancelled" })
  })

  it("a reverted source transaction is terminal", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          hasProvider: true,
          outcome: { status: "reverted", hash: SOURCE_HASH },
        },
      }),
    )
    expect(view.variant).toBe("failed")
    expect(view.heading).toBe("Deposit not sent")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "source_reverted" })
  })

  it("a different payload on the same nonce is a conflict, never assumed cancellation", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          hasProvider: true,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SOURCE_HASH,
            reason: "replaced",
          },
        },
      }),
    )
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe("Couldn't verify this transfer")
    expect(view.showRefresh).toBe(true)
    // Not terminal: the evidence is preserved, not resolved.
    expect(view.persist).toEqual({ lastState: "source_conflict" })
  })
})

describe("deriveDepositProgress: LI.FI bridge stage", () => {
  const bridgeView = (bridge: DepositProgressInputs["bridge"]) =>
    deriveDepositProgress(session(), inputs({ ...confirmedSource, bridge }))

  it("bridge_not_found keeps polling and never implies a failed send", () => {
    const view = bridgeView({ state: "bridge_not_found" })
    expect(view.stage).toBe("bridge")
    expect(view.variant).toBe("in-flight")
    expect(view.message).toContain("waiting for the bridge to pick it up")
    expect(view.persist).toEqual({ lastState: "bridge_not_found" })
  })

  it("an unread first poll uses the not-indexed copy rather than nothing", () => {
    const view = bridgeView({})
    expect(view.stage).toBe("bridge")
    expect(view.message).toContain("waiting for the bridge to pick it up")
    expect(view.persist).toBeUndefined()
  })

  it("bridge_pending reports the leg in progress", () => {
    const view = bridgeView({ state: "bridge_pending" })
    expect(view.variant).toBe("in-flight")
    expect(view.message).toBe("Your USDC is being bridged to Ethereum.")
  })

  it("deposit_pending means the bridge finished and detection is pending", () => {
    const view = bridgeView({ state: "deposit_pending" })
    expect(view.variant).toBe("in-flight")
    expect(view.message).toContain("reached Ethereum")
    expect(view.persist).toEqual({ lastState: "deposit_pending" })
  })

  it("deposit_indexed stays in flight: only the deposit bucket completes", () => {
    const view = bridgeView({ state: "deposit_indexed" })
    expect(view.variant).toBe("in-flight")
    expect(view.stage).toBe("bridge")
  })

  it("bridge_refunding keeps polling under refund copy", () => {
    const view = bridgeView({ state: "bridge_refunding" })
    expect(view.stage).toBe("bridge")
    expect(view.variant).toBe("in-flight")
    expect(view.heading).toBe("Refund in progress")
  })

  it.each<[BridgeStatusState, string]>([
    ["bridge_refunded", "Refund confirmed"],
    ["bridge_failed", "Bridge failed"],
  ])("%s is its own terminal outcome, not completion", (state, heading) => {
    const view = bridgeView({ state })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("failed")
    expect(view.heading).toBe(heading)
    expect(view.persist).toEqual({ phase: "terminal", lastState: state })
  })

  it.each<[BridgeStatusState, string]>([
    ["bridge_partial", "Deposit needs attention"],
    ["bridge_refund_required", "Refund needs attention"],
  ])("%s preserves ambiguity and offers refresh", (state, heading) => {
    const view = bridgeView({ state })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe(heading)
    expect(view.showRefresh).toBe(true)
    expect(view.note).toContain("Don't send a replacement deposit")
    // Needs attention, not settled: the session must stay resumable so later
    // exact evidence (or support) can resolve it.
    expect(view.persist).toEqual({ lastState: state })
  })

  it("upstream_conflict is a hard recovery state with automatic reads stopped", () => {
    const view = bridgeView({
      state: "bridge_pending",
      error: new BridgeStatusConflictError("upstream_conflict", "evidence disagrees"),
    })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe("Couldn't verify this transfer")
    expect(view.showRefresh).toBe(true)
    expect(view.isRetrying).toBe(false)
  })

  it("a rate limit is transient: keep the stage copy and the retry notice", () => {
    const view = bridgeView({
      state: "bridge_pending",
      error: new RateLimitedError("slow down", 5000),
    })
    expect(view.stage).toBe("bridge")
    expect(view.variant).toBe("in-flight")
    expect(view.isRetrying).toBe(true)
    expect(view.message).toBe("Your USDC is being bridged to Ethereum.")
  })

  it("any other coded or transport error is also transient", () => {
    expect(
      bridgeView({
        state: "bridge_pending",
        error: new BridgeStatusConflictError("upstream_unavailable", "down"),
      }).isRetrying,
    ).toBe(true)
    expect(bridgeView({ state: "bridge_pending", error: new Error("network") }).isRetrying).toBe(
      true,
    )
  })

  it("a failed identity assertion on an indexed envelope never completes the flow", () => {
    const view = bridgeView({ state: "deposit_indexed", conflict: "deposit_address mismatch" })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe("Couldn't verify this transfer")
    expect(view.message).toBe("deposit_address mismatch")
  })
})

describe("deriveDepositProgress: direct Ethereum correlation", () => {
  const directSession = session({
    transport: "direct",
    source: { ...session().source, chainId: "1", chainName: "Ethereum" },
  })

  it("a 404 is an indexing delay, not a missing transfer", () => {
    const view = deriveDepositProgress(
      directSession,
      inputs({ ...confirmedSource, direct: { isError: false, found: false } }),
    )
    expect(view.stage).toBe("correlate")
    expect(view.variant).toBe("in-flight")
    expect(view.message).toContain("waiting for the deposit to be detected")
    expect(view.persist).toEqual({ lastState: "deposit_pending" })
  })

  it("a read failure shows the retry notice without changing the stage", () => {
    const view = deriveDepositProgress(
      directSession,
      inputs({ ...confirmedSource, direct: { isError: true } }),
    )
    expect(view.stage).toBe("correlate")
    expect(view.isRetrying).toBe(true)
  })

  it("a failed identity assertion is a conflict, not a completion", () => {
    const view = deriveDepositProgress(
      directSession,
      inputs({ ...confirmedSource, direct: { isError: false, conflict: "amount mismatch" } }),
    )
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.message).toBe("amount mismatch")
  })
})

describe("deriveDepositProgress: deposit id stage", () => {
  const tracked = session({ depositId: "deposit-1", phase: "deposit_indexed" })
  const depositView = (deposit: Partial<DepositProgressInputs["deposit"]>) =>
    deriveDepositProgress(
      tracked,
      inputs({ deposit: { bucket: "waiting", isError: false, isSelfRecipient: true, ...deposit } }),
    )

  it("the deposit id supersedes the source stage entirely", () => {
    // No confirmed source outcome supplied: the correlated id is authoritative.
    expect(depositView({ bucket: "waiting" }).stage).toBe("deposit")
  })

  it("waiting confirms on Ethereum for both transports", () => {
    const view = depositView({ bucket: "waiting" })
    expect(view.title).toBe("Confirming your deposit…")
    expect(view.message).toBe("Your deposit is confirming on Ethereum.")
    expect(view.persist).toEqual({ lastState: "waiting" })
  })

  it("processing names the destination", () => {
    const view = depositView({ bucket: "processing" })
    expect(view.title).toBe("Transferring…")
    expect(view.message).toBe("Your deposit is being delivered to Initia.")
    expect(view.heading).toBeUndefined()
  })

  it("advance_status pending adds a heading without changing the outcome", () => {
    const view = depositView({ bucket: "processing", advanceStatus: "pending" })
    expect(view.heading).toBe("Fast delivery is processing")
    expect(view.variant).toBe("in-flight")
    expect(view.stage).toBe("deposit")
  })

  it("advance_status completed alone never completes the flow", () => {
    const view = depositView({ bucket: "processing", advanceStatus: "completed" })
    expect(view.variant).toBe("in-flight")
  })

  it("completed to the connected wallet reuses the tracker's amount copy", () => {
    const view = depositView({
      bucket: "completed",
      completedAmount: "5 iUSD",
      isSelfRecipient: true,
    })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("completed")
    expect(view.title).toBe("Transfer complete")
    expect(view.message).toBe(
      "5 iUSD was delivered to your wallet on Initia. It may take a moment to appear in your activity.",
    )
    expect(view.persist).toEqual({ phase: "terminal", lastState: "completed" })
  })

  it("a custom recipient does not claim the sender received funds", () => {
    const view = depositView({
      bucket: "completed",
      completedAmount: "5 iUSD",
      isSelfRecipient: false,
    })
    expect(view.message).toBe("5 iUSD was delivered to the recipient on Initia.")
    expect(view.message).not.toContain("your wallet")
  })

  it("below_minimum shows the formatted minimum and no refund promise", () => {
    const view = depositView({ bucket: "below_minimum", minLabel: "3 USDC" })
    expect(view.variant).toBe("below-minimum")
    expect(view.heading).toBe("Amount below minimum")
    expect(view.message).toBe(
      "Deposits below 3 USDC can't be processed. Your funds remain at the deposit address with no automatic refund.",
    )
    expect(view.persist).toEqual({ phase: "terminal", lastState: "below_minimum" })
  })

  it("below_minimum falls back to the generic sentence when the route is gone", () => {
    const view = depositView({ bucket: "below_minimum", minLabel: "" })
    expect(view.message).toBe("Your funds remain at the deposit address with no automatic refund.")
  })

  it("failed keeps the existing terminal copy", () => {
    const view = depositView({ bucket: "failed" })
    expect(view.variant).toBe("failed")
    expect(view.heading).toBe("Deposit failed")
    expect(view.message).toContain("no automatic refund")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "failed" })
  })

  it("an unknown bucket is a contract problem, never a financial outcome", () => {
    const view = depositView({ bucket: "unknown" })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.heading).toBe("Status unavailable")
    expect(view.showRefresh).toBe(true)
    // Deliberately not terminal: a corrected response can still resolve it.
    expect(view.persist).toEqual({ lastState: "unknown" })
  })

  it("a transient detail-read failure shows the retry notice while in flight", () => {
    expect(depositView({ bucket: "processing", isError: true }).isRetrying).toBe(true)
    // Terminal screens have nothing left to retry.
    expect(depositView({ bucket: "failed", isError: true }).isRetrying).toBe(false)
  })
})

describe("deriveDepositProgress: stall reassurance", () => {
  it("replaces the heading but keeps the stage copy", () => {
    const view = deriveDepositProgress(session(), inputs({ isDelayed: true }))
    expect(view.heading).toBe("This is taking a little longer")
    expect(view.message).toBe("Waiting for your Base transaction to confirm.")
    expect(view.note).toBe("We're still checking. Your transfer stays saved.")
  })

  it("keeps a more specific note when one exists", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ isDelayed: true, source: { isError: true, hasProvider: true } }),
    )
    expect(view.heading).toBe("This is taking a little longer")
    expect(view.note).toBe("Still checking…")
  })

  it("never applies to a settled screen", () => {
    const view = deriveDepositProgress(
      session({ depositId: "deposit-1" }),
      inputs({
        isDelayed: true,
        deposit: { bucket: "failed", isError: false, isSelfRecipient: true },
      }),
    )
    expect(view.heading).toBe("Deposit failed")
  })
})
