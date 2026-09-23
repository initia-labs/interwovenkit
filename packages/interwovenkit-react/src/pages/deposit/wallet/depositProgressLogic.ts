import { formatDuration } from "@/pages/bridge/data/format"
import type { AssetOption } from "../data/assetOptions"
import { BridgeStatusError } from "../data/bridges"
import type { WalletDepositBucket } from "../data/deposits"
import { eqAddress } from "../data/parse"
import type { BridgeStatusState, DepositDelivery } from "../data/types"
import type { DepositTrackingVariant } from "../DepositTracking"
import {
  type DepositLastState,
  type DepositSession,
  type DepositSessionPhase,
  isPhaseAdvance,
} from "./depositSession"
import { matchesAssetOption } from "./depositSources"
import type { SenderNonces, SourceTxOutcome } from "./evmRpc"

export interface DepositProgressView {
  title: string
  variant: DepositTrackingVariant
  heading?: string
  message: string
  note?: string
  isRetrying: boolean
  showClose: boolean
  showRefresh: boolean
  showChips: boolean
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
    conflict?: string
  }
  direct: {
    /** false for a 404, undefined before the first read. */
    found?: boolean
    isError: boolean
    conflict?: string
  }
  deposit: {
    bucket: WalletDepositBucket
    advanceStatus?: string
    delivery?: DepositDelivery
    isError: boolean
    minLabel?: string
    completedAmount?: string
    isSelfRecipient: boolean
  }
  /** The sender's nonces, polled while a send has no hash. */
  nonces: {
    data?: SenderNonces
    readAt: number
    isError: boolean
  }
  isDelayed: boolean
  now: number
}

const IN_FLIGHT_TITLE = "Deposit in progress"
const NEUTRAL_TITLE = "Deposit status"

const NO_REFUND = "Your funds remain at the deposit address with no automatic refund."

const ARRIVED_ON_ETHEREUM = "USDC arrived on Ethereum. Waiting for the deposit to be detected."

const FAST_DELIVERY_FELL_BACK =
  "Fast delivery wasn't available, so this deposit is using standard delivery."

interface LastStateCopy {
  label?: string
  heading?: string
  message?: string
}

// Bridge states render a whole screen, so their message is mandatory.
const LAST_STATE: Record<DepositLastState, LastStateCopy> &
  Record<BridgeStatusState, LastStateCopy & { message: string }> = {
  source_pending: { label: "Source transaction pending" },
  source_replaced: { label: "Source transaction replaced" },
  source_reverted: {},
  source_cancelled: {},
  source_conflict: { label: "Couldn't verify transfer" },
  bridge_not_found: {
    label: "Waiting for the bridge",
    message: "Transaction broadcast. Waiting for the bridge to pick it up.",
  },
  bridge_pending: { label: "Bridging to Ethereum", message: "Bridging USDC to Ethereum." },
  bridge_refunding: {
    label: "Refund in progress",
    heading: "Refund in progress",
    message: "The bridge is returning your funds. Checking until the refund confirms.",
  },
  bridge_refunded: {
    heading: "Refund confirmed",
    message: "The bridge refunded this transfer. See the transaction for details.",
  },
  bridge_partial: {
    label: "Partially delivered",
    heading: "Deposit needs attention",
    message:
      "The bridge delivered only part of this transfer. Check the details or contact support.",
  },
  bridge_refund_required: {
    label: "Refund needs your action",
    heading: "Refund needs attention",
    message: "This refund needs your action. Check the details to complete it.",
  },
  bridge_failed: {
    heading: "Bridge failed",
    message:
      "The bridge could not complete this transfer. Check the details for the status of your funds.",
  },
  deposit_pending: { label: "Waiting for deposit detection", message: ARRIVED_ON_ETHEREUM },
  deposit_indexed: { label: "Delivering", message: "Deposit detected. Delivering now." },
  waiting: { label: "Confirming your deposit" },
  processing: { label: "Delivering" },
  completed: {},
  below_minimum: {},
  failed: {},
  unknown: { label: "Status unavailable" },
  tracking_conflict: { label: "Couldn't verify transfer" },
  not_sent: {},
}

type ViewParts = Partial<DepositProgressView>

function inFlight(view: Pick<DepositProgressView, "message"> & ViewParts) {
  return {
    title: IN_FLIGHT_TITLE,
    variant: "in-flight",
    isRetrying: false,
    showClose: false,
    showRefresh: false,
    showChips: true,
    ...view,
  } satisfies DepositProgressView
}

function terminal(view: Pick<DepositProgressView, "variant" | "message"> & ViewParts) {
  return {
    title: NEUTRAL_TITLE,
    isRetrying: false,
    showClose: true,
    showRefresh: false,
    showChips: false,
    ...view,
  } satisfies DepositProgressView
}

/** Tracking stopped without a financial verdict: never a claim about the funds. */
function problem(view: Pick<DepositProgressView, "message"> & ViewParts) {
  return {
    title: NEUTRAL_TITLE,
    variant: "problem",
    isRetrying: false,
    showClose: true,
    showRefresh: true,
    showChips: false,
    ...view,
  } satisfies DepositProgressView
}

// From `send_prompt` onward a send may have happened; `prepared` is an abandoned draft.
export function isResumableDepositSession(session: DepositSession): boolean {
  return session.phase !== "terminal" && isPhaseAdvance("send_prompt", session.phase)
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
  if (!match.recipient) return []
  return sessions.filter(
    (session) =>
      isResumableDepositSession(session) &&
      eqAddress(session.destination.recipient, match.recipient) &&
      matchesAssetOption(session.destination, match.dstChainId, match.dstDenom) &&
      (match.remoteOptions.length === 0 ||
        match.remoteOptions.some((option) =>
          matchesAssetOption(option, session.source.chainId, session.source.denom),
        )),
  )
}

export function resumeStageLabel(session: DepositSession): string {
  const label = session.lastState && LAST_STATE[session.lastState].label
  if (label) return label
  return session.phase === "send_prompt" || session.phase === "submission_unknown"
    ? "Checking your transaction"
    : "Source transaction pending"
}

export function deriveDepositProgress(
  session: DepositSession,
  inputs: DepositProgressInputs,
): DepositProgressView {
  const view = resolve(session, inputs)

  // Replaces the heading, not the copy: "your funds are safe" is false while a bridge holds them.
  if (view.variant === "in-flight" && inputs.isDelayed && !timeLeft(session, inputs)) {
    return { ...view, heading: "Taking longer than usual" }
  }
  return view
}

function resolve(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  if (!session.currentSourceHash) return withoutHash(session, inputs)

  if (session.depositId) return depositStage(session, inputs)

  // The backend's observation is at least as strong as a pinned receipt.
  const backendSawSource =
    (inputs.bridge.state !== undefined && inputs.bridge.state !== "bridge_not_found") ||
    inputs.direct.found === true
  if (inputs.source.outcome?.status !== "confirmed" && !backendSawSource) {
    return sourceStage(session, inputs)
  }

  return session.transport === "lifi" ? bridgeStage(inputs) : correlateStage(inputs)
}

const RELEASE_AFTER_MS = 2 * 60_000
const MARK_NOT_SENT_AFTER_MS = 10 * 60_000

interface HashlessSendCheck {
  release: boolean
  nonceMoved: boolean
  canMarkNotSent: boolean
}

// Unsent only if neither the mined nor the pending nonce moved past the one read before the prompt.
export function checkHashlessSend(
  session: Pick<DepositSession, "promptNonce" | "promptedAt" | "promptSeenAt" | "updatedAt">,
  nonces: DepositProgressInputs["nonces"],
  now: number,
): HashlessSendCheck {
  const { promptNonce } = session
  const promptedAt = session.promptedAt ?? session.updatedAt
  const lastSeenAt = Math.max(promptedAt, session.promptSeenAt ?? 0)
  const read = nonces.isError ? undefined : nonces.data
  const unchanged =
    promptNonce !== undefined && read?.latest === promptNonce && read.pending === promptNonce
  return {
    release: unchanged && nonces.readAt - lastSeenAt >= RELEASE_AFTER_MS,
    nonceMoved:
      promptNonce !== undefined &&
      !!read &&
      (read.latest > promptNonce || read.pending > promptNonce),
    canMarkNotSent: now - promptedAt >= MARK_NOT_SENT_AFTER_MS,
  }
}

const markedNotSent = () =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message: "This deposit wasn't sent from your wallet. You can start a new one.",
    persist: { phase: "terminal", lastState: "not_sent" },
  })

// The wallet may have sent without returning a hash, or the session never reached a prompt.
function withoutHash(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  if (session.lastState === "not_sent") return markedNotSent()

  if (!isPhaseAdvance("send_prompt", session.phase)) {
    return problem({
      heading: "Nothing to track yet",
      message: "This deposit was never submitted. Start a new deposit to try again.",
      showRefresh: false,
    })
  }

  const check = checkHashlessSend(session, inputs.nonces, inputs.now)
  if (check.release) return markedNotSent()

  const { chainName } = session.source
  const unconfirmed = {
    showRefresh: false,
    canMarkNotSent: check.canMarkNotSent,
  }

  if (check.nonceMoved) {
    return problem({
      ...unconfirmed,
      heading: "Check your wallet",
      message: `Your account has a newer transaction on ${chainName}. It may be this deposit, which can still arrive.`,
      note: "Check your wallet activity before you send again.",
    })
  }

  if (session.promptNonce === undefined) {
    return problem({
      ...unconfirmed,
      heading: "Transfer status unknown",
      message: "Your wallet didn't confirm whether this transfer was sent.",
      note: "Check your wallet activity for a transfer from this account. Don't send again until you know.",
    })
  }

  return problem({
    ...unconfirmed,
    heading: "Checking your transaction",
    message: `Your wallet didn't confirm whether this transfer was sent. Checking ${chainName} for it before you can send again.`,
    note: "This takes about two minutes. Don't send again in the meantime.",
  })
}

const notSent = (lastState: DepositLastState) =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message: "The source transaction was cancelled or reverted.",
    note: "Network fees were still spent, and any token approval you granted remains.",
    persist: { phase: "terminal", lastState },
  })

function sourceStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { outcome, isError } = inputs.source
  const { chainName } = session.source

  if (outcome?.status === "reverted") return notSent("source_reverted")
  if (outcome?.status === "replaced" && outcome.reason === "cancelled") {
    return notSent("source_cancelled")
  }

  if (outcome?.status === "replaced" && outcome.reason === "replaced") {
    // Same nonce, different payload: not this transfer, and not a proven cancellation.
    return problem({
      heading: "Couldn't verify this transfer",
      message:
        "The tracking details don't match this deposit. Your submitted transaction is still saved.",
      note: "A different transaction replaced yours. Check the transaction details before sending anything new.",
      persist: { lastState: "source_conflict" },
    })
  }

  const repriced = outcome?.status === "replaced" && outcome.reason === "repriced"
  const hasReplacement =
    repriced ||
    (!!session.originalSourceHash && session.originalSourceHash !== session.currentSourceHash)

  const base = inFlight({
    message: `Confirming on ${chainName}.`,
    persist: { lastState: hasReplacement ? "source_replaced" : "source_pending" },
  })

  if (hasReplacement) {
    return {
      ...base,
      note: "Your wallet replaced the transaction. Tracking the new one.",
    }
  }

  if (isError) return { ...base, note: "Still checking…" }

  return base
}

function bridgeStage(inputs: DepositProgressInputs): DepositProgressView {
  const { state, error, conflict } = inputs.bridge

  if (error instanceof BridgeStatusError && error.code === "upstream_conflict") {
    return conflictView(
      "The tracking details don't match this deposit. Your submitted transaction is still saved.",
    )
  }
  if (error instanceof BridgeStatusError && error.code === "invalid_request") {
    return conflictView("The tracking request was rejected. Your transaction details are saved.")
  }

  if (conflict) return conflictView(conflict)

  const copy = LAST_STATE[state ?? "bridge_not_found"]

  switch (state) {
    case "bridge_refunded":
    case "bridge_failed":
      return terminal({
        variant: "failed",
        heading: copy.heading,
        message: copy.message,
        persist: { phase: "terminal", lastState: state },
      })
    case "bridge_partial":
    case "bridge_refund_required":
      return problem({
        heading: copy.heading,
        message: copy.message,
        note: "Keep the transaction details for support. Don't send a replacement deposit.",
        persist: { lastState: state },
      })
  }

  return inFlight({
    heading: copy.heading,
    message: copy.message,
    // Before any state is known, a failed read is indistinguishable from "not picked up yet".
    isRetrying: !!error && !!state,
    persist: state ? { lastState: state } : undefined,
  })
}

function correlateStage(inputs: DepositProgressInputs): DepositProgressView {
  const { isError, conflict } = inputs.direct

  if (conflict) return conflictView(conflict)

  return inFlight({
    // A 404 here is an indexing delay: the receipt is already confirmed on Ethereum.
    message: ARRIVED_ON_ETHEREUM,
    isRetrying: isError,
    persist: { lastState: "deposit_pending" },
  })
}

// Hidden once the estimate passes: it is a prediction, not a deadline.
function timeLeft(session: DepositSession, inputs: DepositProgressInputs): string | undefined {
  const { bucket, delivery } = inputs.deposit
  if (!session.depositId || (bucket !== "waiting" && bucket !== "processing")) return undefined
  const remaining = Date.parse(delivery?.estimated_completion_at ?? "") - inputs.now
  if (!(remaining > 0)) return undefined
  return `About ${formatDuration(Math.ceil(remaining / 60_000) * 60)} left.`
}

function depositStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { bucket, advanceStatus, delivery, isError, minLabel, completedAmount, isSelfRecipient } =
    inputs.deposit
  const destination = session.destination.chainName || "the destination"
  const eta = timeLeft(session, inputs)
  const fellBack = session.predictedDelivery === "advance" && delivery?.method === "standard"
  const delivering = (message: string) => ({
    message: eta ? `${message} ${eta}` : message,
    note: fellBack ? FAST_DELIVERY_FELL_BACK : undefined,
  })

  switch (bucket) {
    case "waiting":
      return inFlight({
        title: "Confirming your deposit…",
        ...delivering("Confirming on Ethereum."),
        isRetrying: isError,
        persist: { lastState: "waiting" },
      })
    case "processing":
      return inFlight({
        title: "Transferring…",
        ...delivering(
          advanceStatus === "pending"
            ? `Fast delivery to ${destination} in progress.`
            : `Delivering to ${destination}.`,
        ),
        isRetrying: isError,
        persist: { lastState: "processing" },
      })
    case "completed":
      return terminal({
        title: "Transfer complete",
        variant: "completed",
        message: isSelfRecipient
          ? `${completedAmount} delivered to your wallet on ${destination}.`
          : `${completedAmount} delivered to the recipient on ${destination}.`,
        showChips: true,
        persist: { phase: "terminal", lastState: "completed" },
      })
    case "below_minimum":
      return terminal({
        variant: "below-minimum",
        heading: "Amount below minimum",
        message: `${minLabel ? `Deposits below ${minLabel} can't be processed. ` : ""}${NO_REFUND}`,
        persist: { phase: "terminal", lastState: "below_minimum" },
      })
    case "failed":
      return terminal({
        variant: "failed",
        heading: "Deposit failed",
        message: `This deposit could not be completed. ${NO_REFUND}`,
        persist: { phase: "terminal", lastState: "failed" },
      })
    case "unknown":
      // A contract problem, not a financial outcome: the session stays open.
      return problem({
        heading: "Status unavailable",
        message: "Couldn't read the latest deposit status. Your transfer details are saved.",
        persist: { lastState: "unknown" },
      })
  }
}

function conflictView(message: string): DepositProgressView {
  return problem({
    heading: "Couldn't verify this transfer",
    message,
    note: "We've stopped automatic tracking so nothing is inferred from mismatched evidence. Your transaction details are saved.",
    persist: { lastState: "tracking_conflict" },
  })
}
