import { BridgeStatusError } from "../data/bridges"
import { RECIPIENT, SRC_TX_HASH } from "../data/testing"
import type { BridgeStatusState } from "../data/types"
import {
  checkHashlessSend,
  type DepositProgressInputs,
  deriveDepositProgress,
  progressHeading,
  type ResumeMatch,
  resumeStageLabel,
  selectResumableSessions,
} from "./depositProgressLogic"
import type { DepositSession, DepositSessionPhase } from "./depositSession"
import { buildDepositSession } from "./testing"

const REPLACEMENT_HASH = `0x${"b".repeat(64)}`
const MISMATCH =
  "The tracking details don't match this deposit. Your submitted transaction is still saved."
const MINUTE = 60_000

/** A broadcast transfer: the state every stage below starts from. */
const session = (overrides: Partial<DepositSession> = {}): DepositSession =>
  buildDepositSession({ phase: "source_sent", currentSourceHash: SRC_TX_HASH, ...overrides })

const inputs = (overrides: Partial<DepositProgressInputs> = {}): DepositProgressInputs => ({
  source: { isError: false },
  bridge: {},
  direct: { isError: false },
  deposit: { bucket: "waiting", isError: false, isSelfRecipient: true },
  nonces: { readAt: 0, isError: false },
  now: 0,
  ...overrides,
})

const confirmedSource = { source: { isError: false, outcome: { status: "confirmed" as const } } }

const directSession = session({
  transport: "direct",
  source: { ...session().source, chainId: "1", chainName: "Ethereum" },
})

const depositView = (
  deposit: Partial<DepositProgressInputs["deposit"]>,
  overrides: Partial<DepositSession> = {},
  extra: Partial<DepositProgressInputs> = {},
) =>
  deriveDepositProgress(
    session({ depositId: "deposit-1", ...overrides }),
    inputs({
      ...extra,
      deposit: { bucket: "waiting", isError: false, isSelfRecipient: true, ...deposit },
    }),
  )

describe("selectResumableSessions", () => {
  const match: ResumeMatch = {
    recipient: RECIPIENT,
    dstChainId: session().destination.chainId,
    dstDenom: session().destination.denom,
    remoteOptions: [],
  }
  const offered = (sessions: DepositSession[], overrides: Partial<ResumeMatch> = {}) =>
    selectResumableSessions(sessions, { ...match, ...overrides }).map(({ id }) => id)

  it.each<[DepositSessionPhase, string[]]>([
    ["prepared", []],
    ["send_prompt", ["session-1"]],
    ["submission_unknown", ["session-1"]],
    ["source_sent", ["session-1"]],
    ["terminal", []],
  ])("offers a %s session only once a send may have happened", (phase, expected) => {
    expect(offered([session({ phase })])).toEqual(expected)
  })

  it.each([
    ["another recipient", { recipient: "init1somebodyelse" }],
    ["another destination", { dstChainId: "other-1" }],
    [
      "a source the host excluded",
      { remoteOptions: [{ chainId: "1", denom: "0x0000000000000000000000000000000000000001" }] },
    ],
  ])("hides a session for %s", (_, overrides) => {
    expect(offered([session()], overrides)).toEqual([])
  })

  it.each([
    ["the recipient in another case", { recipient: RECIPIENT.toUpperCase() }],
    [
      "an allowlisted source in another denom case",
      {
        remoteOptions: [
          {
            chainId: session().source.chainId,
            denom: `0x${session().source.denom.slice(2).toUpperCase()}`,
          },
        ],
      },
    ],
  ])("matches %s", (_, overrides) => {
    expect(offered([session()], overrides)).toEqual(["session-1"])
  })
})

describe("resumeStageLabel", () => {
  it.each<[string, Partial<DepositSession>, string]>([
    ["a recorded state's label", { lastState: "bridge_pending" }, "Bridging to Ethereum"],
    ["an open prompt", { phase: "send_prompt" }, "Checking your transaction"],
    [
      "an ambiguous send whose state has no label",
      { phase: "submission_unknown", lastState: "source_reverted" },
      "Checking your transaction",
    ],
    ["a sent transfer with no state", { phase: "source_sent" }, "Source transaction pending"],
  ])("labels %s", (_, overrides, label) => {
    expect(resumeStageLabel(session(overrides))).toBe(label)
  })
})

describe("checkHashlessSend", () => {
  const prompted = { promptNonce: 7, promptedAt: 0, updatedAt: 0 }
  const read = (latest: number, pending: number, readAt: number, isError = false) => ({
    data: { latest, pending },
    readAt,
    isError,
  })

  it("releases only once an unchanged nonce is read two minutes after the prompt", () => {
    expect(checkHashlessSend(prompted, read(7, 7, 2 * MINUTE - 1), 2 * MINUTE).release).toBe(false)
    expect(checkHashlessSend(prompted, read(7, 7, 2 * MINUTE), 2 * MINUTE)).toEqual({
      release: true,
      nonceMoved: false,
      canMarkNotSent: false,
    })
  })

  it("waits two minutes after the last heartbeat from a tab holding the prompt", () => {
    const held = { ...prompted, promptSeenAt: 3 * MINUTE }
    expect(checkHashlessSend(held, read(7, 7, 4 * MINUTE), 4 * MINUTE).release).toBe(false)
    expect(checkHashlessSend(held, read(7, 7, 5 * MINUTE), 5 * MINUTE).release).toBe(true)
  })

  it.each([
    ["the read failed", prompted, read(7, 7, 5 * MINUTE, true), false],
    ["the read failed over stale data that moved", prompted, read(8, 8, 5 * MINUTE, true), true],
    ["the node lags behind the prompt nonce", prompted, read(6, 6, 5 * MINUTE), false],
    [
      "no prompt nonce was recorded",
      { ...prompted, promptNonce: undefined },
      read(7, 7, 5 * MINUTE),
      false,
    ],
    ["nothing was read yet", prompted, { readAt: 5 * MINUTE, isError: false }, false],
    ["the mined nonce moved", prompted, read(8, 8, 5 * MINUTE), true],
    ["the pending nonce moved", prompted, read(7, 8, 5 * MINUTE), true],
  ])("never releases when %s", (_, sent, nonces, nonceMoved) => {
    expect(checkHashlessSend(sent, nonces, 5 * MINUTE)).toMatchObject({
      release: false,
      nonceMoved,
    })
  })

  it.each([
    ["before ten minutes", prompted, 10 * MINUTE - 1, false],
    ["at ten minutes", prompted, 10 * MINUTE, true],
    [
      "at ten minutes while a tab still holds the prompt",
      { ...prompted, promptSeenAt: 10 * MINUTE },
      10 * MINUTE,
      true,
    ],
    [
      "before ten minutes from the last update without a prompt time",
      { updatedAt: MINUTE },
      11 * MINUTE - 1,
      false,
    ],
    [
      "ten minutes from the last update without a prompt time",
      { updatedAt: MINUTE },
      11 * MINUTE,
      true,
    ],
  ])("offers the manual release %s", (_, sent, now, canMarkNotSent) => {
    expect(checkHashlessSend(sent, read(8, 8, now), now).canMarkNotSent).toBe(canMarkNotSent)
  })
})

describe("deriveDepositProgress: no source hash", () => {
  const hashless = (overrides: Partial<DepositSession> = {}) =>
    session({
      phase: "submission_unknown",
      currentSourceHash: undefined,
      promptedAt: 0,
      ...overrides,
    })
  const unchanged = { data: { latest: 7, pending: 7 }, readAt: 2 * MINUTE, isError: false }
  const moved = { data: { latest: 8, pending: 8 }, readAt: 10 * MINUTE, isError: false }

  it.each<[string, Partial<DepositSession>, Partial<DepositProgressInputs>, string, boolean]>([
    [
      "an open prompt",
      { phase: "send_prompt", promptNonce: 7 },
      {},
      "Checking your transaction",
      false,
    ],
    ["an ambiguous send", { promptNonce: 7 }, {}, "Checking your transaction", false],
    ["an ambiguous send without a prompt nonce", {}, {}, "Transfer status unknown", false],
    [
      "an ambiguous send whose nonce moved",
      { promptNonce: 7 },
      { nonces: moved, now: 10 * MINUTE },
      "Check your wallet",
      true,
    ],
  ])("%s stays locked without a verdict", (_, overrides, extra, heading, canMarkNotSent) => {
    const view = deriveDepositProgress(hashless(overrides), inputs(extra))
    expect(view).toMatchObject({ variant: "problem", heading, canMarkNotSent })
    expect(view.persist).toBeUndefined()
  })

  it.each([
    [
      "the unchanged nonce is confirmed",
      hashless({ promptNonce: 7 }),
      inputs({ nonces: unchanged }),
    ],
    ["it was already released", hashless({ phase: "terminal", lastState: "not_sent" }), inputs()],
  ])("closes as not sent when %s", (_, released, releaseInputs) => {
    expect(deriveDepositProgress(released, releaseInputs)).toMatchObject({
      variant: "failed",
      heading: "Deposit not sent",
      persist: { phase: "terminal", lastState: "not_sent" },
    })
  })

  it("a session that never reached a prompt is not ambiguous", () => {
    const view = deriveDepositProgress(
      session({ phase: "prepared", currentSourceHash: undefined }),
      inputs(),
    )
    expect(view).toMatchObject({ variant: "problem", heading: "Nothing to track yet" })
    expect(view.note).toBeUndefined()
  })
})

describe("deriveDepositProgress: which stage reads the evidence", () => {
  const pending = { isError: false, outcome: { status: "pending" as const } }
  const reverted = { isError: false, outcome: { status: "reverted" as const } }

  it.each<[string, DepositSession, Partial<DepositProgressInputs>, string]>([
    [
      "bridge_pending before any receipt",
      session(),
      { bridge: { state: "bridge_pending" } },
      "bridge_pending",
    ],
    [
      "bridge_pending over a pending receipt",
      session(),
      { source: pending, bridge: { state: "bridge_pending" } },
      "bridge_pending",
    ],
    [
      "bridge_pending over a reverted receipt",
      session(),
      { source: reverted, bridge: { state: "bridge_pending" } },
      "bridge_pending",
    ],
    [
      "bridge_not_found before any receipt",
      session(),
      { bridge: { state: "bridge_not_found" } },
      "source_pending",
    ],
    [
      "a found direct deposit before any receipt",
      directSession,
      { direct: { isError: false, found: true } },
      "deposit_pending",
    ],
    [
      "a direct 404 before any receipt",
      directSession,
      { direct: { isError: false, found: false } },
      "source_pending",
    ],
  ])("routes %s to its stage", (_, tracked, extra, lastState) => {
    expect(deriveDepositProgress(tracked, inputs(extra)).persist).toEqual({ lastState })
  })
})

describe("deriveDepositProgress: source stage", () => {
  it.each([
    ["no receipt yet", undefined],
    ["a pending receipt", { status: "pending" as const }],
  ])("keeps waiting on %s with the source chain named", (_, outcome) => {
    const view = deriveDepositProgress(session(), inputs({ source: { isError: false, outcome } }))
    expect(view).toMatchObject({
      variant: "in-flight",
      message: "Confirming on Base.",
      persist: { lastState: "source_pending" },
    })
    expect(view.note).toBeUndefined()
  })

  it("an RPC read failure keeps the pending copy and says so", () => {
    expect(deriveDepositProgress(session(), inputs({ source: { isError: true } }))).toMatchObject({
      variant: "in-flight",
      note: "Still checking…",
    })
  })

  it.each([
    [
      "a repriced outcome",
      session(),
      {
        isError: false,
        outcome: {
          status: "replaced" as const,
          hash: REPLACEMENT_HASH,
          reason: "repriced" as const,
        },
      },
    ],
    [
      "the persisted lineage after a reload",
      session({ originalSourceHash: SRC_TX_HASH, currentSourceHash: REPLACEMENT_HASH }),
      { isError: false },
    ],
  ])("tracks the replacement from %s", (_, tracked, source) => {
    expect(deriveDepositProgress(tracked, inputs({ source }))).toMatchObject({
      variant: "in-flight",
      note: "Your wallet replaced the transaction. Tracking the new one.",
      persist: { lastState: "source_replaced" },
    })
  })

  it.each([
    ["reverted", { status: "reverted" as const }, "source_reverted"],
    [
      "cancelled",
      { status: "replaced" as const, hash: REPLACEMENT_HASH, reason: "cancelled" as const },
      "source_cancelled",
    ],
  ])("closes as not sent when the source transaction was %s", (_, outcome, lastState) => {
    const view = deriveDepositProgress(session(), inputs({ source: { isError: false, outcome } }))
    expect(view).toMatchObject({
      variant: "failed",
      heading: "Deposit not sent",
      persist: { phase: "terminal", lastState },
    })
    expect(view.note).toContain("Network fees were still spent")
  })

  it("a different payload on the same nonce is a conflict, never assumed cancellation", () => {
    const view = deriveDepositProgress(
      session(),
      inputs({
        source: {
          isError: false,
          outcome: { status: "replaced", hash: REPLACEMENT_HASH, reason: "replaced" },
        },
      }),
    )
    expect(view).toMatchObject({ variant: "problem", persist: { lastState: "source_conflict" } })
  })
})

describe("deriveDepositProgress: LI.FI bridge stage", () => {
  const bridgeView = (bridge: DepositProgressInputs["bridge"]) =>
    deriveDepositProgress(session(), inputs({ ...confirmedSource, bridge }))

  it.each<[BridgeStatusState, string | undefined]>([
    ["bridge_not_found", undefined],
    ["bridge_pending", undefined],
    ["deposit_pending", undefined],
    ["deposit_indexed", undefined],
    ["bridge_refunding", "Refund in progress"],
  ])("%s stays in flight: only the deposit bucket completes", (state, heading) => {
    const view = bridgeView({ state })
    expect(view).toMatchObject({ variant: "in-flight", persist: { lastState: state } })
    expect(view.heading).toBe(heading)
  })

  it("an unread first poll uses the not-indexed copy and records nothing", () => {
    const view = bridgeView({})
    expect(view.message).toBe(bridgeView({ state: "bridge_not_found" }).message)
    expect(view.persist).toBeUndefined()
  })

  it.each<BridgeStatusState>(["bridge_refunded", "bridge_failed"])(
    "%s is its own terminal outcome, not completion",
    (state) => {
      expect(bridgeView({ state })).toMatchObject({
        variant: "failed",
        persist: { phase: "terminal", lastState: state },
      })
    },
  )

  it.each<BridgeStatusState>(["bridge_partial", "bridge_refund_required"])(
    "%s preserves ambiguity and offers refresh",
    (state) => {
      const view = bridgeView({ state })
      expect(view).toMatchObject({ variant: "problem", persist: { lastState: state } })
      expect(view.note).toContain("Don't send a replacement deposit")
    },
  )

  it.each<[string, DepositProgressInputs["bridge"], object]>([
    [
      "upstream_conflict stops tracking",
      { state: "bridge_pending", error: new BridgeStatusError("upstream_conflict", "disagrees") },
      { variant: "problem", persist: { lastState: "tracking_conflict" } },
    ],
    [
      "invalid_request stops tracking",
      { state: "bridge_pending", error: new BridgeStatusError("invalid_request", "rejected") },
      { variant: "problem", persist: { lastState: "tracking_conflict" } },
    ],
    [
      "upstream_unavailable retries the stage",
      { state: "bridge_pending", error: new BridgeStatusError("upstream_unavailable", "down") },
      { variant: "in-flight", isRetrying: true, persist: { lastState: "bridge_pending" } },
    ],
    [
      "a transport error retries the stage",
      { state: "bridge_pending", error: new Error("network") },
      { variant: "in-flight", isRetrying: true, persist: { lastState: "bridge_pending" } },
    ],
    [
      "an error before any state reads as not picked up yet",
      { error: new Error("network") },
      { variant: "in-flight", isRetrying: false },
    ],
  ])("%s", (_, bridge, expected) => {
    expect(bridgeView(bridge)).toMatchObject(expected)
  })

  it("a failed identity assertion on an indexed envelope never completes the flow", () => {
    expect(bridgeView({ state: "deposit_indexed", conflict: true })).toMatchObject({
      variant: "problem",
      message: MISMATCH,
      persist: { lastState: "tracking_conflict" },
    })
  })
})

describe("deriveDepositProgress: direct Ethereum correlation", () => {
  const correlate = (direct: DepositProgressInputs["direct"]) =>
    deriveDepositProgress(directSession, inputs({ ...confirmedSource, direct }))

  it("a 404 is an indexing delay, not a missing transfer", () => {
    expect(correlate({ isError: false, found: false })).toMatchObject({
      variant: "in-flight",
      isRetrying: false,
      persist: { lastState: "deposit_pending" },
    })
  })

  it("a read failure shows the retry notice without changing the stage", () => {
    expect(correlate({ isError: true })).toMatchObject({
      variant: "in-flight",
      isRetrying: true,
      persist: { lastState: "deposit_pending" },
    })
  })

  it("a failed identity assertion is a conflict, not a completion", () => {
    expect(correlate({ isError: false, conflict: true })).toMatchObject({
      variant: "problem",
      message: MISMATCH,
      persist: { lastState: "tracking_conflict" },
    })
  })
})

describe("deriveDepositProgress: deposit id stage", () => {
  it("the deposit id supersedes the source stage and confirms on Ethereum", () => {
    expect(depositView({ bucket: "waiting" })).toMatchObject({
      variant: "in-flight",
      title: "Confirming your deposit…",
      message: "Confirming on Ethereum.",
      persist: { lastState: "waiting" },
    })
  })

  it.each([
    ["completed", "Delivering to Initia."],
    ["pending", "Fast delivery to Initia in progress."],
  ])("processing with advance_status %s stays in flight", (advanceStatus, message) => {
    expect(depositView({ bucket: "processing", advanceStatus })).toMatchObject({
      variant: "in-flight",
      title: "Transferring…",
      message,
      persist: { lastState: "processing" },
    })
  })

  it.each([
    [true, "5 iUSD delivered to your wallet on Initia."],
    [false, "5 iUSD delivered to the recipient on Initia."],
  ])("completed (self recipient: %s) names who received the funds", (isSelfRecipient, message) => {
    expect(
      depositView({ bucket: "completed", completedAmount: "5 iUSD", isSelfRecipient }),
    ).toMatchObject({
      variant: "completed",
      title: "Transfer complete",
      message,
      persist: { phase: "terminal", lastState: "completed" },
    })
  })

  it.each([
    [
      "3 USDC",
      "Deposits below 3 USDC can't be processed. Your funds remain at the deposit address with no automatic refund.",
    ],
    ["", "Your funds remain at the deposit address with no automatic refund."],
  ])("below_minimum with minimum %j makes no refund promise", (minLabel, message) => {
    expect(depositView({ bucket: "below_minimum", minLabel })).toMatchObject({
      variant: "below-minimum",
      message,
      persist: { phase: "terminal", lastState: "below_minimum" },
    })
  })

  it("failed keeps the existing terminal copy", () => {
    const view = depositView({ bucket: "failed" })
    expect(view).toMatchObject({
      variant: "failed",
      persist: { phase: "terminal", lastState: "failed" },
    })
    expect(view.message).toContain("no automatic refund")
  })

  it("an unknown bucket is a contract problem, never a financial outcome", () => {
    expect(depositView({ bucket: "unknown" })).toMatchObject({
      variant: "problem",
      persist: { lastState: "unknown" },
    })
  })

  it("a transient detail-read failure shows the retry notice only while in flight", () => {
    expect(depositView({ bucket: "processing", isError: true }).isRetrying).toBe(true)
    expect(depositView({ bucket: "failed", isError: true }).isRetrying).toBeFalsy()
  })
})

describe("progressHeading", () => {
  const delayedHeading = (target: DepositSession, extra: Partial<DepositProgressInputs> = {}) => {
    const stage = inputs(extra)
    return progressHeading(deriveDepositProgress(target, stage), target, stage, true)
  }

  it.each<[string, DepositSession, Partial<DepositProgressInputs>]>([
    ["the source stage", session(), {}],
    ["a source read failure", session(), { source: { isError: true } }],
    [
      "the Ethereum leg after a bridge",
      session(),
      { ...confirmedSource, bridge: { state: "deposit_pending" } },
    ],
    ["an indexed bridge", session(), { ...confirmedSource, bridge: { state: "deposit_indexed" } }],
    ["direct correlation", directSession, { ...confirmedSource, direct: { isError: false } }],
    ["a deposit without an estimate", session({ depositId: "deposit-1" }), {}],
  ])("replaces the heading of a stalled %s", (_, target, extra) => {
    expect(delayedHeading(target, extra)).toBe("Taking longer than usual")
  })

  it.each<[string, DepositProgressInputs["bridge"], string | undefined]>([
    ["an unread first poll", {}, undefined],
    ["bridge_not_found", { state: "bridge_not_found" }, undefined],
    ["bridge_pending", { state: "bridge_pending" }, undefined],
    ["bridge_refunding", { state: "bridge_refunding" }, "Refund in progress"],
  ])("leaves a bridge that takes minutes alone: %s", (_, bridge, heading) => {
    expect(delayedHeading(session(), { ...confirmedSource, bridge })).toBe(heading)
  })

  it("never applies to a settled screen or before the stage stalls", () => {
    const failed = session({ depositId: "deposit-1" })
    const stage = inputs({ deposit: { bucket: "failed", isError: false, isSelfRecipient: true } })
    expect(progressHeading(deriveDepositProgress(failed, stage), failed, stage, true)).toBe(
      "Deposit failed",
    )
    const pending = inputs()
    expect(
      progressHeading(deriveDepositProgress(session(), pending), session(), pending, false),
    ).toBe(undefined)
  })
})

describe("deriveDepositProgress: delivery estimate", () => {
  const NOW = Date.parse("2026-09-23T00:00:00Z")
  const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString()
  const estimate = (
    deposit: Partial<DepositProgressInputs["deposit"]>,
    overrides: Partial<DepositSession> = {},
  ) => depositView({ bucket: "processing", ...deposit }, overrides, { now: NOW })

  it.each([
    ["processing", 45, "Delivering to Initia. About 1m left."],
    ["processing", 301, "Delivering to Initia. About 6m left."],
    ["waiting", 120, "Confirming on Ethereum. About 2m left."],
  ] as const)(
    "shows the time left while %s, rounded up to the minute",
    (bucket, seconds, message) => {
      const delivery = { method: "standard", estimated_completion_at: at(seconds) }
      expect(estimate({ bucket, delivery }).message).toBe(message)
    },
  )

  it.each([
    ["due now", at(0)],
    ["passed", at(-1)],
    ["null", null],
    ["malformed", "soon"],
  ])("hides the time left when the estimate is %s", (_, estimatedCompletionAt) => {
    const delivery = { method: "standard", estimated_completion_at: estimatedCompletionAt }
    expect(estimate({ delivery }).message).toBe("Delivering to Initia.")
  })

  it("hides the time left once the deposit is terminal", () => {
    const delivery = { method: "advance", estimated_completion_at: at(60) }
    const completed = estimate({ bucket: "completed", completedAmount: "5 iUSD", delivery })
    expect(completed.message).not.toContain("left")
  })

  it("keeps the stall heading back while the estimate is ahead", () => {
    const stalledHeading = (seconds: number) => {
      const target = session({ depositId: "deposit-1" })
      const delivery = { method: "standard", estimated_completion_at: at(seconds) }
      const stage = inputs({
        now: NOW,
        deposit: { bucket: "processing", isError: false, isSelfRecipient: true, delivery },
      })
      return progressHeading(deriveDepositProgress(target, stage), target, stage, true)
    }
    expect(stalledHeading(120)).toBeUndefined()
    expect(stalledHeading(-1)).toBe("Taking longer than usual")
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
    expect(estimate({ delivery }, { predictedDelivery: predicted }).note).toBe(note)
  })

  it("drops the fallback line once the deposit is terminal", () => {
    const delivery = { method: "standard", estimated_completion_at: null }
    expect(
      estimate({ bucket: "failed", delivery }, { predictedDelivery: "advance" }).note,
    ).toBeUndefined()
  })
})
