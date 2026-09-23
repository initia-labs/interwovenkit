import { describe, expect, it } from "vitest"
import { BridgeStatusError } from "../data/bridges"
import { SRC_TX_HASH } from "../data/testing"
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
import { buildDepositSession, REPLACEMENT_HASH } from "./testing"

/** A broadcast transfer: the state every stage below starts from. */
const session = (overrides: Partial<DepositSession> = {}): DepositSession =>
  buildDepositSession({ phase: "source_sent", currentSourceHash: SRC_TX_HASH, ...overrides })

const inputs = (overrides: Partial<DepositProgressInputs> = {}): DepositProgressInputs => ({
  source: { isError: false },
  bridge: {},
  direct: { isError: false },
  deposit: { bucket: "waiting", isError: false, isSelfRecipient: true },
  isDelayed: false,
  now: 0,
  ...overrides,
})

const confirmedSource = {
  source: {
    isError: false,
    outcome: { status: "confirmed" as const, hash: SRC_TX_HASH, blockNumber: 10 },
  },
}

describe("trackedSourceHash", () => {
  it("prefers the current hash so a repriced replacement supersedes the original", () => {
    expect(
      trackedSourceHash(
        session({ currentSourceHash: REPLACEMENT_HASH, originalSourceHash: SRC_TX_HASH }),
      ),
    ).toBe(REPLACEMENT_HASH)
  })

  it("is empty when nothing was ever returned", () => {
    expect(trackedSourceHash(session({ currentSourceHash: undefined }))).toBe("")
  })
})

describe("isResumableDepositSession", () => {
  it("excludes the abandoned form draft", () => {
    expect(isResumableDepositSession(session({ phase: "prepared" }))).toBe(false)
  })

  it.each<DepositSessionPhase>(["send_prompt", "submission_unknown", "source_sent"])(
    "offers %s, where a send may already have happened",
    (phase) => {
      expect(isResumableDepositSession(session({ phase }))).toBe(true)
    },
  )

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

  const match = {
    recipient: "init1recipient",
    dstChainId: mine.destination.chainId,
    dstDenom: mine.destination.denom,
    remoteOptions: [],
  }

  it("offers only in-flight sessions credited to the connected account", () => {
    expect(selectResumableSessions([mine, theirs, draft, done], match).map(({ id }) => id)).toEqual(
      ["mine"],
    )
  })

  it("matches the recipient case-insensitively", () => {
    expect(
      selectResumableSessions([mine], { ...match, recipient: "INIT1RECIPIENT" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["mine"])
  })

  it("offers nothing when no account is connected", () => {
    expect(selectResumableSessions([mine], { ...match, recipient: "" })).toEqual([])
  })

  it("hides sessions for another destination or a source the host excluded", () => {
    expect(selectResumableSessions([mine], { ...match, dstChainId: "other-1" })).toEqual([])
    const excluded = [{ chainId: "1", denom: "0x0000000000000000000000000000000000000001" }]
    expect(selectResumableSessions([mine], { ...match, remoteOptions: excluded })).toEqual([])
    // The allowlist is matched on normalized denoms, like every other source comparison.
    const allowed = [
      { chainId: mine.source.chainId, denom: `0x${mine.source.denom.slice(2).toUpperCase()}` },
    ]
    expect(
      selectResumableSessions([mine], { ...match, remoteOptions: allowed }).map(({ id }) => id),
    ).toEqual(["mine"])
  })
})

describe("resumeStageLabel", () => {
  it("prefers the recorded state's label from the shared copy table", () => {
    expect(resumeStageLabel(session({ lastState: "bridge_pending" }))).toBe("Bridging to Ethereum")
    expect(resumeStageLabel(session({ lastState: "waiting" }))).toBe("Confirming your deposit")
    expect(resumeStageLabel(session({ lastState: "unknown" }))).toBe("Status unavailable")
  })

  it("falls back to the phase when the recorded state carries no resume label", () => {
    expect(resumeStageLabel(session({ phase: "send_prompt" }))).toBe("Checking your transaction")
    expect(resumeStageLabel(session({ phase: "submission_unknown" }))).toBe(
      "Checking your transaction",
    )
    expect(resumeStageLabel(session({ phase: "source_sent" }))).toBe("Source transaction pending")
    expect(resumeStageLabel(session({ lastState: "tracking_conflict" }))).toBe(
      "Source transaction pending",
    )
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
      expect(view.note).toContain("Don't send again until you know")
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
    expect(view.note).toBeUndefined()
    expect(view.showClose).toBe(true)
  })
})

describe("deriveDepositProgress: source stage", () => {
  it("waits on the source receipt with the source chain named", () => {
    const view = deriveDepositProgress(session(), inputs())
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.message).toContain("Base")
    expect(view.showChips).toBe(true)
    expect(view.showClose).toBe(false)
    expect(view.persist).toEqual({ lastState: "source_pending" })
  })

  it("a pending outcome is not a decision: keep waiting", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ source: { isError: false, outcome: { status: "pending" } } }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toBeUndefined()
  })

  it("an RPC read failure keeps the pending copy and says so", () => {
    const view = deriveDepositProgress(session(), inputs({ source: { isError: true } }))
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.note).toBe("Still checking…")
    // An unread node is never rendered as a failed transfer.
    expect(view.showClose).toBe(false)
  })

  it("a repriced replacement keeps tracking under the replacement copy", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SRC_TX_HASH,
            reason: "repriced",
          },
        },
      }),
    )
    expect(view.stage).toBe("source")
    expect(view.variant).toBe("in-flight")
    expect(view.persist).toEqual({ lastState: "source_replaced" })
  })

  it("persisted replacement lineage survives the reload that loses the outcome", () => {
    const view = deriveDepositProgress(
      session({ originalSourceHash: SRC_TX_HASH, currentSourceHash: REPLACEMENT_HASH }),
      inputs(),
    )
    expect(view.variant).toBe("in-flight")
    expect(view.persist).toEqual({ lastState: "source_replaced" })
  })

  it("a mined cancellation is the one route to Deposit not sent", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SRC_TX_HASH,
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
        source: { isError: false, outcome: { status: "reverted", hash: SRC_TX_HASH } },
      }),
    )
    expect(view.variant).toBe("failed")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "source_reverted" })
  })

  it("a different payload on the same nonce is a conflict, never assumed cancellation", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          outcome: {
            status: "replaced",
            hash: REPLACEMENT_HASH,
            originalHash: SRC_TX_HASH,
            reason: "replaced",
          },
        },
      }),
    )
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
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
    expect(view.persist).toEqual({ lastState: "bridge_not_found" })
  })

  it("an unread first poll uses the not-indexed copy rather than nothing", () => {
    const view = bridgeView({})
    expect(view.stage).toBe("bridge")
    expect(view.message).toBe(bridgeView({ state: "bridge_not_found" }).message)
    // Nothing was read, so nothing is recorded.
    expect(view.persist).toBeUndefined()
  })

  it.each<BridgeStatusState>(["bridge_pending", "deposit_pending", "deposit_indexed"])(
    "%s stays in flight: only the deposit bucket completes",
    (state) => {
      const view = bridgeView({ state })
      expect(view.stage).toBe("bridge")
      expect(view.variant).toBe("in-flight")
      expect(view.persist).toEqual({ lastState: state })
    },
  )

  it("bridge_refunding keeps polling under refund copy", () => {
    const view = bridgeView({ state: "bridge_refunding" })
    expect(view.stage).toBe("bridge")
    expect(view.variant).toBe("in-flight")
    expect(view.heading).toBe("Refund in progress")
  })

  it.each<BridgeStatusState>(["bridge_refunded", "bridge_failed"])(
    "%s is its own terminal outcome, not completion",
    (state) => {
      const view = bridgeView({ state })
      expect(view.stage).toBe("none")
      expect(view.variant).toBe("failed")
      expect(view.heading).toBeTruthy()
      expect(view.persist).toEqual({ phase: "terminal", lastState: state })
    },
  )

  it.each<BridgeStatusState>(["bridge_partial", "bridge_refund_required"])(
    "%s preserves ambiguity and offers refresh",
    (state) => {
      const view = bridgeView({ state })
      expect(view.stage).toBe("none")
      expect(view.variant).toBe("problem")
      expect(view.showRefresh).toBe(true)
      expect(view.note).toContain("Don't send a replacement deposit")
      // Needs attention, not settled: the session must stay resumable so later evidence can resolve it.
      expect(view.persist).toEqual({ lastState: state })
    },
  )

  it("upstream_conflict is a hard recovery state with automatic reads stopped", () => {
    const view = bridgeView({
      state: "bridge_pending",
      error: new BridgeStatusError("upstream_conflict", "evidence disagrees"),
    })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
    expect(view.showRefresh).toBe(true)
    expect(view.isRetrying).toBe(false)
    expect(view.persist).toEqual({ lastState: "tracking_conflict" })
  })

  it("every other coded or transport error is transient: keep the stage copy and retry", () => {
    const view = bridgeView({ state: "bridge_pending", error: new Error("network") })
    expect(view.stage).toBe("bridge")
    expect(view.variant).toBe("in-flight")
    expect(view.isRetrying).toBe(true)
    expect(view.message).toBe(bridgeView({ state: "bridge_pending" }).message)
    expect(
      bridgeView({
        state: "bridge_pending",
        error: new BridgeStatusError("upstream_unavailable", "down"),
      }).isRetrying,
    ).toBe(true)
  })

  it("a failed identity assertion on an indexed envelope never completes the flow", () => {
    const view = bridgeView({ state: "deposit_indexed", conflict: "deposit_address mismatch" })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
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
  const tracked = session({ depositId: "deposit-1" })
  const depositView = (deposit: Partial<DepositProgressInputs["deposit"]>) =>
    deriveDepositProgress(
      tracked,
      inputs({ deposit: { bucket: "waiting", isError: false, isSelfRecipient: true, ...deposit } }),
    )

  it("the deposit id supersedes the source stage and confirms on Ethereum", () => {
    // No confirmed source outcome supplied: the correlated id is authoritative, and both
    // transports reach the issued address on Ethereum.
    const view = depositView({ bucket: "waiting" })
    expect(view.stage).toBe("deposit")
    expect(view.variant).toBe("in-flight")
    expect(view.title).toBe("Confirming your deposit…")
    expect(view.message).toContain("Ethereum")
    expect(view.persist).toEqual({ lastState: "waiting" })
  })

  it("processing names the destination", () => {
    const view = depositView({ bucket: "processing" })
    expect(view.title).toBe("Transferring…")
    expect(view.message).toContain("Initia")
    expect(view.heading).toBeUndefined()
    expect(view.persist).toEqual({ lastState: "processing" })
  })

  it("advance_status pending changes the copy without changing the outcome", () => {
    const view = depositView({ bucket: "processing", advanceStatus: "pending" })
    expect(view.message).not.toBe(depositView({ bucket: "processing" }).message)
    expect(view.variant).toBe("in-flight")
    expect(view.stage).toBe("deposit")
  })

  it("advance_status completed alone never completes the flow", () => {
    expect(depositView({ bucket: "processing", advanceStatus: "completed" }).variant).toBe(
      "in-flight",
    )
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
    expect(view.message).toContain("5 iUSD")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "completed" })
  })

  it("a custom recipient does not claim the sender received funds", () => {
    const view = depositView({
      bucket: "completed",
      completedAmount: "5 iUSD",
      isSelfRecipient: false,
    })
    expect(view.message).not.toContain("your wallet")
  })

  it("below_minimum shows the formatted minimum and no refund promise", () => {
    const view = depositView({ bucket: "below_minimum", minLabel: "3 USDC" })
    expect(view.variant).toBe("below-minimum")
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
    expect(view.message).toContain("no automatic refund")
    expect(view.persist).toEqual({ phase: "terminal", lastState: "failed" })
  })

  it("an unknown bucket is a contract problem, never a financial outcome", () => {
    const view = depositView({ bucket: "unknown" })
    expect(view.stage).toBe("none")
    expect(view.variant).toBe("problem")
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
    expect(view.heading).toBe("Taking longer than usual")
    expect(view.message).toBe(deriveDepositProgress(session(), inputs()).message)
    expect(view.note).toBeUndefined()
  })

  it("keeps a more specific note when one exists", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({ isDelayed: true, source: { isError: true } }),
    )
    expect(view.heading).toBe("Taking longer than usual")
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
    expect(view.variant).toBe("failed")
  })
})

describe("deriveDepositProgress: delivery estimate", () => {
  const NOW = Date.parse("2026-09-23T00:00:00Z")
  const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString()
  const view = (
    deposit: Partial<DepositProgressInputs["deposit"]>,
    overrides: Partial<DepositSession> = {},
    isDelayed = false,
  ) =>
    deriveDepositProgress(
      session({ depositId: "deposit-1", ...overrides }),
      inputs({
        now: NOW,
        isDelayed,
        deposit: { bucket: "processing", isError: false, isSelfRecipient: true, ...deposit },
      }),
    )

  it("shows the time left while the estimate is ahead, rounded up to the minute", () => {
    const { message } = view({ delivery: { method: "advance", estimated_completion_at: at(45) } })
    expect(message).toBe("Delivering to Initia. About 1m left.")
    expect(
      view({ delivery: { method: "standard", estimated_completion_at: at(301) } }).message,
    ).toBe("Delivering to Initia. About 6m left.")
  })

  it.each([
    ["passed", at(-1)],
    ["null", null],
    ["malformed", "soon"],
  ])("hides the time left when the estimate is %s", (_, estimatedCompletionAt) => {
    const delivery = { method: "standard", estimated_completion_at: estimatedCompletionAt }
    expect(view({ delivery }).message).toBe("Delivering to Initia.")
  })

  it("hides the time left once the deposit is terminal", () => {
    const delivery = { method: "advance", estimated_completion_at: at(60) }
    const completed = view({ bucket: "completed", completedAmount: "5 iUSD", delivery })
    expect(completed.message).not.toContain("left")
  })

  it("keeps the stall heading back while the estimate is ahead", () => {
    const delivery = { method: "standard", estimated_completion_at: at(120) }
    expect(view({ delivery }, {}, true).heading).toBeUndefined()
    expect(
      view({ delivery: { ...delivery, estimated_completion_at: at(-1) } }, {}, true).heading,
    ).toBe("Taking longer than usual")
  })

  const FELL_BACK = "Fast delivery wasn't available, so this deposit is using standard delivery."

  it.each<[string, string | undefined, string | undefined, string | undefined]>([
    ["advance fell back to standard", "advance", "standard", FELL_BACK],
    ["advance still advance", "advance", "advance", undefined],
    ["standard as predicted", "standard", "standard", undefined],
    ["no prediction", undefined, "standard", undefined],
    ["not classified yet", "advance", undefined, undefined],
    ["an unknown method", "advance", "priority", undefined],
  ])("fallback line: %s", (_, predicted, method, note) => {
    const delivery = method ? { method, estimated_completion_at: null } : undefined
    expect(view({ delivery }, { predictedDelivery: predicted }).note).toBe(note)
  })

  it("drops the fallback line once the deposit is terminal", () => {
    const delivery = { method: "standard", estimated_completion_at: null }
    expect(
      view({ bucket: "failed", delivery }, { predictedDelivery: "advance" }).note,
    ).toBeUndefined()
  })
})
