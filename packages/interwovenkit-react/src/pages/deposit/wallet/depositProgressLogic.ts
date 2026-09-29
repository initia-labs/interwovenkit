import BigNumber from "bignumber.js"
import { fromBaseUnit } from "@initia/utils"
import type { AssetOption } from "../data/assetOptions"
import { BridgeStatusError, isBridgeStatusState } from "../data/bridges"
import { type ClassifiedBucket, deliveryTimeLeft, TAKING_LONGER_DELAY } from "../data/deposits"
import { eqAddress, ParseError } from "../data/parse"
import { ETHEREUM_CHAIN_ID } from "../data/source"
import type { BridgeStatusState, DepositDelivery } from "../data/types"
import {
  type DepositLastState,
  type DepositSession,
  type DepositSessionPhase,
  isPhaseAdvance,
  isStageRegression,
} from "./depositSession"
import { matchesAssetOption } from "./depositSources"
import type { SenderNonces, SourceTxOutcome } from "./evmRpc"

export type DepositProgressVariant =
  | "in-flight"
  | "completed"
  | "failed"
  | "below-minimum"
  | "problem"

export interface DepositProgressView {
  title: string
  variant: DepositProgressVariant
  heading?: string
  message: string
  note?: string
  isRetrying?: boolean
  /** A bridge normally takes minutes and reports no ETA, so this stage never reads as delayed. */
  isBridging?: boolean
  canMarkNotSent?: boolean
  /** Written back to the session so the persisted trail matches the rendered claim. */
  persist?: { phase?: DepositSessionPhase; lastState?: DepositLastState }
}

export interface DepositProgressInputs {
  source: {
    outcome?: SourceTxOutcome
    isError: boolean
  }
  bridge: {
    state?: BridgeStatusState
    error?: unknown
    conflict?: boolean
  }
  direct: {
    /** false for a 404, undefined before the first read. */
    found?: boolean
    isError: boolean
    conflict?: boolean
  }
  deposit: {
    bucket: ClassifiedBucket
    delivery?: DepositDelivery
    isError: boolean
    conflict?: boolean
    minLabel?: string
    completedAmount?: string
    /** The USDC at the deposit address, e.g. "10 USDC", for copy about funds held there. */
    heldAmount?: string
  }
  nonces: {
    data?: SenderNonces
    readAt: number
    isError: boolean
  }
  now: number
}

const IN_FLIGHT_TITLE = "Deposit in progress"
const NEUTRAL_TITLE = "Deposit status"

// No support channel exists in the widget or config, so the copy must not point at one.
const MISMATCH =
  "We couldn't match the bridge's status to this deposit, so we've stopped updating it. It may still arrive."

const HELD = (amount: string) =>
  `Your ${amount} is held at your deposit address and won't be refunded automatically.`

export const DELAYED_HEADING = "Taking longer than usual"
export const DELAYED_NOTE =
  "You can close this. Your deposit keeps going and stays under Continue deposit."

// Every in-flight stage reads the same: the user needs to know it's moving, not which leg it's on.
const PROCESSING = "Processing your deposit."
const IN_PROGRESS = "In progress"

const FAST_DELIVERY_FELL_BACK =
  "Fast delivery wasn't available, so this deposit is using standard delivery."

// The hub's resume row: open sessions only, so terminal states need no label.
const RESUME_LABEL: Partial<Record<DepositLastState, string>> = {
  source_pending: IN_PROGRESS,
  source_replaced: IN_PROGRESS,
  source_conflict: "Different transaction sent",
  bridge_not_found: IN_PROGRESS,
  bridge_pending: IN_PROGRESS,
  bridge_refunding: "Refund in progress",
  bridge_partial: "Partly delivered",
  bridge_refund_required: "Refund needed",
  deposit_pending: IN_PROGRESS,
  deposit_indexed: IN_PROGRESS,
  waiting: IN_PROGRESS,
  processing: IN_PROGRESS,
  unknown: "Status unavailable",
  tracking_conflict: "Can't confirm deposit",
}

type ViewParts = Partial<DepositProgressView>

function inFlight(view: Pick<DepositProgressView, "message"> & ViewParts) {
  return { title: IN_FLIGHT_TITLE, variant: "in-flight", ...view } satisfies DepositProgressView
}

function terminal(view: Pick<DepositProgressView, "variant" | "message"> & ViewParts) {
  return { title: NEUTRAL_TITLE, ...view } satisfies DepositProgressView
}

/** Tracking stopped without a financial verdict: never a claim about the funds. */
function problem(view: Pick<DepositProgressView, "message"> & ViewParts) {
  return { title: NEUTRAL_TITLE, variant: "problem", ...view } satisfies DepositProgressView
}

/** What the hub is currently depositing; a saved session must match all of it to be offered. */
export interface ResumeMatch {
  recipient: string
  dstChainId: string
  dstDenom: string
  /** Host source allowlist; empty means unconstrained. */
  remoteOptions: AssetOption[]
}

// A session for another recipient or an excluded source would reopen inside a request it violates.
export function selectResumableSessions(
  sessions: DepositSession[],
  match: ResumeMatch,
): DepositSession[] {
  return sessions.filter(
    (session) =>
      // From `send_prompt` onward a send may have happened; `prepared` is an abandoned draft.
      session.phase !== "terminal" &&
      isPhaseAdvance("send_prompt", session.phase) &&
      eqAddress(session.destination.recipient, match.recipient) &&
      matchesAssetOption(session.destination, match.dstChainId, match.dstDenom) &&
      (match.remoteOptions.length === 0 ||
        match.remoteOptions.some((option) =>
          matchesAssetOption(option, session.source.chainId, session.source.denom),
        )),
  )
}

export function resumeRowTitle(session: DepositSession): string {
  const { amount, decimals, symbol, chainName } = session.source
  // The amount the user typed, without the padding decimals a balance column needs. A record that
  // can't be read still gets a row rather than breaking the hub.
  const value = fromBaseUnit(amount, { decimals })
  const shown = value ? `${BigNumber(value).toFormat()} ${symbol}` : symbol
  return `${shown} from ${chainName}`
}

export function resumeStageLabel(session: DepositSession): string {
  const label = session.lastState && RESUME_LABEL[session.lastState]
  if (label) return label
  return session.phase === "send_prompt" || session.phase === "submission_unknown"
    ? "Confirming your transaction"
    : IN_PROGRESS
}

// An Ethereum block can take a minute to include a low-tip transfer; every other stage gets the default.
export function takingLongerDelay(session: DepositSession, lastState?: DepositLastState): number {
  const onSource = lastState === "source_pending" || lastState === "source_replaced"
  return onSource && session.source.chainId === ETHEREUM_CHAIN_ID
    ? 2 * TAKING_LONGER_DELAY
    : TAKING_LONGER_DELAY
}

// Replaces the heading, not the copy: "your funds are safe" is false while a bridge holds them.
export function progressHeading(
  view: DepositProgressView,
  session: DepositSession,
  inputs: DepositProgressInputs,
  isDelayed: boolean,
): string | undefined {
  const canDelay = view.variant === "in-flight" && !view.isBridging && !timeLeft(session, inputs)
  return isDelayed && canDelay ? DELAYED_HEADING : view.heading
}

export type ProgressStepStatus = "done" | "active" | "stopped" | "failed" | "pending"

// One step per hop the API reports: a LI.FI route bridges to Ethereum before the delivery. Nothing
// before a source hash is on chain yet, so a hashless send has no steps.
export function deriveProgressSteps(
  session: DepositSession,
  inputs: DepositProgressInputs,
  view: DepositProgressView,
): ProgressStepStatus[] | undefined {
  if (!session.currentSourceHash) return undefined
  const isLifi = session.transport === "lifi"
  // The recorded stage keeps a finished bridge done while a reload reads the chain again.
  const bridged =
    isLifi &&
    (!!session.depositId ||
      [inputs.bridge.state, session.lastState].some(
        (stage) => stage === "deposit_pending" || stage === "deposit_indexed",
      ))
  const total = isLifi ? 2 : 1
  // A recorded completion counts before the record reloads, so reopening it never replays the finish.
  const completed = view.variant === "completed" || session.lastState === "completed"
  const done = completed ? total : bridged ? 1 : 0
  const current: ProgressStepStatus =
    view.variant === "in-flight" ? "active" : view.variant === "problem" ? "stopped" : "failed"
  return Array.from({ length: total }, (_, index) =>
    index < done ? "done" : index === done ? current : "pending",
  )
}

export function deriveDepositProgress(
  session: DepositSession,
  inputs: DepositProgressInputs,
): DepositProgressView {
  if (!session.currentSourceHash) return withoutHash(session, inputs)

  if (session.depositId) return depositStage(session, inputs)

  // A reload loses the query cache. Keep the saved observation through the first pending or failed
  // read, or a lagging one, so neither the screen nor its persistence rewinds a refund or delivery.
  const restoredBridgeState =
    session.transport === "lifi" &&
    isBridgeStatusState(session.lastState) &&
    (inputs.bridge.state === undefined || isStageRegression(session.lastState, inputs.bridge.state))
      ? session.lastState
      : undefined
  if (restoredBridgeState) {
    inputs = { ...inputs, bridge: { ...inputs.bridge, state: restoredBridgeState } }
  }

  // The backend's observation is at least as strong as a pinned receipt.
  const backendSawSource =
    (inputs.bridge.state !== undefined && inputs.bridge.state !== "bridge_not_found") ||
    inputs.direct.found === true
  if (inputs.source.outcome?.status !== "confirmed" && !backendSawSource) {
    const view = sourceStage(session, inputs)
    // NOT_FOUND does not prove source inclusion. Preserve it through an evidence
    // gap, but still let a proven revert, cancellation, or replacement take precedence.
    if (restoredBridgeState && view.persist?.lastState === "source_pending") {
      return { ...view, persist: { ...view.persist, lastState: restoredBridgeState } }
    }
    return view
  }

  return session.transport === "lifi" ? bridgeStage(session, inputs) : correlateStage(inputs)
}

// Past WalletConnect's five-minute request expiry: a prompt still open on a phone can still be approved.
const RELEASE_AFTER_MS = 6 * 60_000
const MARK_NOT_SENT_AFTER_MS = 10 * 60_000
// A tab holding the prompt heartbeats every 15 seconds; a minute without one means none is left.
const PROMPT_HELD_MS = 60_000

interface HashlessSendCheck {
  release: boolean
  nonceMoved: boolean
  canMarkNotSent: boolean
}

// Unsent only if both nonces still match the ones read before the prompt, so a transaction already
// pending then isn't mistaken for this send.
export function checkHashlessSend(
  session: Pick<
    DepositSession,
    "promptNonce" | "promptPendingNonce" | "promptedAt" | "promptSeenAt" | "updatedAt"
  >,
  nonces: DepositProgressInputs["nonces"],
  now: number,
): HashlessSendCheck {
  const { promptNonce } = session
  const promptPendingNonce = session.promptPendingNonce ?? promptNonce
  const promptedAt = session.promptedAt ?? session.updatedAt
  const lastSeenAt = Math.max(promptedAt, session.promptSeenAt ?? 0)
  // A failed read keeps the last one for display but never releases.
  const read = nonces.data
  const unchanged =
    promptNonce !== undefined && read?.latest === promptNonce && read.pending === promptPendingNonce
  return {
    release: !nonces.isError && unchanged && nonces.readAt - lastSeenAt >= RELEASE_AFTER_MS,
    nonceMoved:
      promptNonce !== undefined &&
      promptPendingNonce !== undefined &&
      !!read &&
      (read.latest > promptNonce || read.pending > promptPendingNonce),
    canMarkNotSent:
      now - promptedAt >= MARK_NOT_SENT_AFTER_MS && now - lastSeenAt >= PROMPT_HELD_MS,
  }
}

const markedNotSent = () =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message: "Your wallet didn't send this deposit, so it wasn't started.",
    persist: { phase: "terminal", lastState: "not_sent" },
  })

// The wallet may have sent without returning a hash, or the session never reached a prompt.
function withoutHash(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  if (session.lastState === "not_sent") return markedNotSent()

  if (!isPhaseAdvance("send_prompt", session.phase)) {
    return problem({
      heading: "Nothing to track yet",
      message: "This deposit was never submitted. Start a new deposit to try again.",
    })
  }

  const check = checkHashlessSend(session, inputs.nonces, inputs.now)
  if (check.release) return markedNotSent()

  const { chainName } = session.source
  const unconfirmed = { canMarkNotSent: check.canMarkNotSent }

  if (check.nonceMoved) {
    return problem({
      ...unconfirmed,
      heading: "Check your wallet",
      message: `Your account sent a transaction on ${chainName} that may be this deposit. If it is, it will still arrive. Check your wallet activity before trying again.`,
    })
  }

  if (session.promptNonce === undefined) {
    return problem({
      ...unconfirmed,
      heading: "Check your wallet",
      message:
        "Your wallet didn't confirm whether it sent this deposit. Check your wallet activity before trying again.",
    })
  }

  return problem({
    ...unconfirmed,
    heading: "Confirming your transaction",
    message: `Your wallet didn't confirm whether it sent this deposit. We're checking ${chainName}, which takes about 6 minutes.`,
    note: "Don't send it again to avoid paying excess fees.",
  })
}

const notSent = (lastState: DepositLastState, chainName: string) =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message: `Your transaction was cancelled or failed on ${chainName}, so the deposit wasn't started.`,
    persist: { phase: "terminal", lastState },
  })

function sourceStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { outcome, isError } = inputs.source

  const { chainName } = session.source
  if (outcome?.status === "reverted") return notSent("source_reverted", chainName)
  if (outcome?.status === "replaced" && outcome.reason === "cancelled") {
    return notSent("source_cancelled", chainName)
  }

  // A reload rescans from the send, so a recorded conflict holds until the scan finds the block again.
  const isConflict =
    outcome?.status === "replaced"
      ? outcome.reason === "replaced"
      : session.lastState === "source_conflict"
  if (isConflict) {
    // Same nonce, different payload: not this transfer, and not a proven cancellation.
    return problem({
      heading: "Different transaction sent",
      message:
        "Your wallet replaced this deposit with a different transaction, so it may not have been sent. Check your wallet activity before trying again.",
      persist: { lastState: "source_conflict" },
    })
  }

  const repriced = outcome?.status === "replaced" && outcome.reason === "repriced"
  const hasReplacement =
    repriced ||
    (!!session.originalSourceHash && session.originalSourceHash !== session.currentSourceHash)

  return inFlight({
    message: PROCESSING,
    isRetrying: isError,
    persist: { lastState: hasReplacement ? "source_replaced" : "source_pending" },
  })
}

function bridgeStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { state, error, conflict } = inputs.bridge
  const { chainName } = session.source

  // A rejected request, a conflict, or a response that fails its checks can't be fixed by polling.
  if (
    (error instanceof BridgeStatusError &&
      (error.code === "upstream_conflict" || error.code === "invalid_request")) ||
    conflict ||
    error instanceof ParseError
  ) {
    return conflictView()
  }

  switch (state) {
    case "bridge_refunded":
      return terminal({
        variant: "failed",
        heading: "Deposit refunded",
        message: `The bridge couldn't deliver this deposit and returned your USDC to your wallet on ${chainName}.`,
        persist: { phase: "terminal", lastState: state },
      })
    case "bridge_failed":
      return terminal({
        variant: "failed",
        heading: "Bridge failed",
        message:
          "The bridge couldn't complete this transfer. Check the transaction to see where your USDC is.",
        persist: { phase: "terminal", lastState: state },
      })
    case "bridge_partial":
      return problem({
        heading: "Deposit partly delivered",
        message: "The bridge delivered only part of this deposit. Don't send it again.",
        persist: { lastState: state },
      })
    case "bridge_refund_required":
      return problem({
        heading: "Refund needed",
        message: "The bridge couldn't deliver this deposit, and its refund has to be claimed.",
        persist: { lastState: state },
      })
    case "bridge_refunding":
      return inFlight({
        heading: "Refund in progress",
        message: `The bridge is returning your USDC to your wallet on ${chainName}. This usually takes a few minutes.`,
        isRetrying: !!error,
        isBridging: true,
        persist: { lastState: state },
      })
  }

  return inFlight({
    message: PROCESSING,
    isRetrying: !!error,
    isBridging: state !== "deposit_pending" && state !== "deposit_indexed",
    persist: state ? { lastState: state } : undefined,
  })
}

function correlateStage(inputs: DepositProgressInputs): DepositProgressView {
  const { isError, conflict } = inputs.direct

  if (conflict) return conflictView()

  return inFlight({
    // A 404 here is an indexing delay: the receipt is already confirmed on Ethereum.
    message: PROCESSING,
    isRetrying: isError,
    persist: { lastState: "deposit_pending" },
  })
}

// Hidden once the estimate passes: it is a prediction, not a deadline.
function timeLeft(session: DepositSession, inputs: DepositProgressInputs): string | undefined {
  const { bucket, delivery } = inputs.deposit
  if (!session.depositId || (bucket !== "waiting" && bucket !== "processing")) return undefined
  return deliveryTimeLeft(delivery, inputs.now)
}

function depositStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { bucket, delivery, isError, conflict, minLabel, completedAmount, heldAmount } =
    inputs.deposit
  if (conflict) return conflictView()
  const eta = timeLeft(session, inputs)
  const fellBack = session.predictedDelivery === "advance" && delivery?.method === "standard"
  const delivering = {
    message: eta ? `${PROCESSING} ${eta}` : PROCESSING,
    note: fellBack ? FAST_DELIVERY_FELL_BACK : undefined,
  }

  switch (bucket) {
    case "waiting":
      return inFlight({
        ...delivering,
        isRetrying: isError,
        persist: { lastState: "waiting" },
      })
    case "processing":
      return inFlight({
        ...delivering,
        isRetrying: isError,
        persist: { lastState: "processing" },
      })
    case "completed":
      return terminal({
        title: "Deposit complete",
        variant: "completed",
        message: `${completedAmount ?? `Your ${session.destination.symbol}`} deposited.`,
        persist: { phase: "terminal", lastState: "completed" },
      })
    case "below_minimum":
      return terminal({
        variant: "below-minimum",
        heading: "Amount below minimum",
        message: `${minLabel ? `Deposits under ${minLabel}` : "Deposits this small"} can't be processed. ${HELD(heldAmount ?? "USDC")}`,
        persist: { phase: "terminal", lastState: "below_minimum" },
      })
    case "failed":
      return terminal({
        variant: "failed",
        heading: "Deposit failed",
        message: `This deposit couldn't be completed. ${HELD(heldAmount ?? "USDC")}`,
        persist: { phase: "terminal", lastState: "failed" },
      })
    case "unknown":
      // A contract problem, not a financial outcome: the session stays open.
      return problem({
        heading: "Status unavailable",
        message: "We can't load this deposit's status right now.",
        persist: { lastState: "unknown" },
      })
  }
}

function conflictView(): DepositProgressView {
  return problem({
    heading: "Can't confirm this deposit",
    message: MISMATCH,
    persist: { lastState: "tracking_conflict" },
  })
}
