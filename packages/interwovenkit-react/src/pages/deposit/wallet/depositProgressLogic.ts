import type { AssetOption } from "../data/assetOptions"
import { normalizeDenom } from "../data/assetOptions"
import { BridgeStatusConflictError } from "../data/bridges"
import type { WalletDepositBucket } from "../data/deposits"
import type { BridgeStatusState } from "../data/types"
import {
  DEPOSIT_SESSION_PHASES,
  type DepositSession,
  type DepositSessionPhase,
} from "./depositSession"
import type { SourceTxOutcome } from "./evmRpc"

export type DepositProgressVariant =
  | "in-flight"
  | "completed"
  | "failed"
  | "below-minimum"
  | "problem"

/** The read the controller should be running; "none" stops automatic reads without discarding the session. */
export type DepositProgressStage = "source" | "bridge" | "correlate" | "deposit" | "none"

export interface DepositProgressView {
  stage: DepositProgressStage
  title: string
  variant: DepositProgressVariant
  heading?: string
  message: string
  note?: string
  isRetrying: boolean
  showClose: boolean
  showRefresh: boolean
  showChips: boolean
  /** What the controller must write back to the session, so the persisted trail matches the rendered claim. */
  persist?: { phase?: DepositSessionPhase; lastState?: string }
}

export interface DepositProgressInputs {
  source: {
    outcome?: SourceTxOutcome
    isError: boolean
    hasProvider: boolean
  }
  bridge: {
    state?: BridgeStatusState
    error?: unknown
    /** assertLifiDeposit rejected an otherwise indexed envelope. */
    conflict?: string
  }
  direct: {
    /** true once the by-source-tx read returned a record, false for a 404, undefined before the first read. */
    found?: boolean
    isError: boolean
    /** assertDirectDeposit rejected the correlated record. */
    conflict?: string
  }
  deposit: {
    bucket: WalletDepositBucket
    /** Opaque wire value; only "pending"/"completed" change copy, never terminal judgment. */
    advanceStatus?: string
    isError: boolean
    minLabel?: string
    completedAmount?: string
    isSelfRecipient: boolean
  }
  /** The current stage has been running for the stall budget (60 s). */
  isDelayed: boolean
}

const IN_FLIGHT_TITLE = "Deposit in progress"
const NEUTRAL_TITLE = "Deposit status"

/** No automatic refund exists at any stage, so no screen may imply one. */
const NO_REFUND = "Your funds remain at the deposit address with no automatic refund."

/** Heading for the post-send recovery block: the transfer was sent, only the local record of it was lost. */
export const recoveryHeading = "Save your transfer details"

const phaseIndex = (phase: DepositSessionPhase) => DEPOSIT_SESSION_PHASES.indexOf(phase)

type ViewParts = Partial<DepositProgressView>

/** Still watching. Nothing to press: closing the widget does not stop the transfer. */
function inFlight(view: Pick<DepositProgressView, "stage" | "message"> & ViewParts) {
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
    stage: "none",
    title: NEUTRAL_TITLE,
    isRetrying: false,
    showClose: true,
    showRefresh: false,
    showChips: false,
    ...view,
  } satisfies DepositProgressView
}

/** Tracking stopped without a financial verdict. Never a claim about the funds, always a manual refresh unless there is nothing left to re-read. */
function problem(view: Pick<DepositProgressView, "message"> & ViewParts) {
  return {
    stage: "none",
    title: NEUTRAL_TITLE,
    variant: "problem",
    isRetrying: false,
    showClose: true,
    showRefresh: true,
    showChips: false,
    ...view,
  } satisfies DepositProgressView
}

// `currentSourceHash` wins because a repriced replacement supersedes the hash the wallet
// first returned; `submitted.hash` covers the window before the first session write.
export function trackedSourceHash(session: DepositSession): string {
  return session.currentSourceHash ?? session.submitted?.hash ?? ""
}

// Gate for "Continue deposit": a `prepared` or `approval_*` session is an abandoned draft
// with nothing broadcast; from `send_prompt` onward a send may have happened.
export function isResumableDepositSession(session: DepositSession): boolean {
  if (session.phase === "terminal") return false
  return phaseIndex(session.phase) >= phaseIndex("send_prompt")
}

/** What the hub is currently depositing; a saved session must match all of it to be offered. */
export interface ResumeMatch {
  recipient: string
  dstChainId: string
  dstDenom: string
  /** Host source allowlist; empty means unconstrained. */
  remoteOptions: AssetOption[]
}

// Recipient, destination and the host's source allowlist all have to agree: a session for
// another recipient or an excluded source would reopen inside a request it violates.
export function selectResumableSessions(
  sessions: DepositSession[],
  match: ResumeMatch,
): DepositSession[] {
  if (!match.recipient) return []
  const recipient = match.recipient.toLowerCase()
  return sessions.filter(
    (session) =>
      isResumableDepositSession(session) &&
      session.destination.recipient.toLowerCase() === recipient &&
      session.destination.chainId === match.dstChainId &&
      normalizeDenom(session.destination.denom) === normalizeDenom(match.dstDenom) &&
      (match.remoteOptions.length === 0 ||
        match.remoteOptions.some(
          (option) =>
            option.chainId === session.source.chainId &&
            normalizeDenom(option.denom) === normalizeDenom(session.source.denom),
        )),
  )
}

/** Falls back to the phase, which is written before every wallet prompt and therefore always present. */
export function resumeStageLabel(session: DepositSession): string {
  switch (session.lastState) {
    case "source_pending":
      return "Source transaction pending"
    case "source_replaced":
      return "Source transaction replaced"
    case "bridge_not_found":
      return "Waiting for the bridge"
    case "bridge_pending":
      return "Bridging to Ethereum"
    case "deposit_pending":
      return "Waiting for deposit detection"
    case "bridge_refunding":
      return "Refund in progress"
    case "waiting":
      return "Confirming your deposit"
    case "deposit_indexed":
    case "processing":
      return "Delivering"
    case "unknown":
      return "Status unavailable"
  }
  switch (session.phase) {
    case "send_prompt":
    case "submission_unknown":
      return "Checking your transaction"
    case "deposit_indexed":
      return "Delivering"
    default:
      return "Source transaction pending"
  }
}

/** `session` is null only when neither storage nor the in-memory fallback holds a record. */
export function deriveDepositProgress(
  session: DepositSession | null,
  inputs: DepositProgressInputs,
): DepositProgressView {
  if (!session) {
    return problem({
      heading: "Deposit not found",
      message:
        "This deposit is no longer saved in this browser. Any transfer already sent is unaffected.",
      showRefresh: false,
    })
  }

  const view = resolve(session, inputs)

  // Armed per stage so each leg gets its own budget. It replaces the heading, not the copy:
  // "your funds are safe at your deposit address" is false while a bridge still holds them.
  if (view.variant === "in-flight" && inputs.isDelayed) {
    return { ...view, heading: "Taking longer than usual" }
  }
  return view
}

function resolve(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const sourceHash = trackedSourceHash(session)

  if (!sourceHash) return withoutHash(session)

  // A correlated deposit id supersedes every earlier signal: it is the only
  // identity the backend can speak about authoritatively.
  if (session.depositId) return depositStage(session, inputs)

  // The backend's own observation of the source transaction is at least as strong as a
  // pinned receipt, so a lagging or failing RPC read never hides progress the API reports.
  const backendSawSource =
    (inputs.bridge.state !== undefined && inputs.bridge.state !== "bridge_not_found") ||
    inputs.direct.found === true
  if (inputs.source.outcome?.status !== "confirmed" && !backendSawSource) {
    return sourceStage(session, inputs)
  }

  return session.transport === "lifi" ? bridgeStage(inputs) : correlateStage(inputs)
}

// No hash to track: either the wallet call never returned one (the transfer may be on
// chain) or the session never reached a prompt. The two must not share copy.
function withoutHash(session: DepositSession): DepositProgressView {
  if (phaseIndex(session.phase) >= phaseIndex("send_prompt")) {
    // No backend read is possible without a hash, and a nonce hint is not evidence.
    return problem({
      title: "Checking your transaction",
      heading: "Checking your transaction",
      message: "Your wallet may have submitted this transfer. Checking before you can send again.",
      note: "Check your wallet activity for a transfer from this account. Don't send again until you know.",
      showRefresh: false,
    })
  }

  return problem({
    heading: "Nothing to track yet",
    message: "This deposit was never submitted. Start a new deposit to try again.",
    showRefresh: false,
  })
}

// Provably never reached the mempool, or replaced by a cancellation. Gas was still spent
// and an earlier approval may still stand.
const notSent = (lastState: string) =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message: "The source transaction was cancelled or reverted.",
    note: "Network fees were still spent, and any token approval you granted remains.",
    persist: { phase: "terminal", lastState },
  })

function sourceStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { outcome, isError, hasProvider } = inputs.source
  const { chainName } = session.source

  if (outcome?.status === "reverted") return notSent("source_reverted")
  if (outcome?.status === "replaced" && outcome.reason === "cancelled") {
    return notSent("source_cancelled")
  }

  if (outcome?.status === "replaced" && outcome.reason === "replaced") {
    // Same nonce, different payload: not this transfer, and not a proven cancellation either.
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
    stage: "source",
    message: `Confirming on ${chainName}.`,
    persist: { lastState: hasReplacement ? "source_replaced" : "source_pending" },
  })

  if (!hasProvider) {
    // Missing RPC metadata is a capability gap on our side; the transfer is unaffected.
    return {
      ...base,
      note: `Cannot verify on ${chainName} right now. Retrying.`,
    }
  }

  if (hasReplacement) {
    return {
      ...base,
      note: "Your wallet replaced the transaction. Tracking the new one.",
    }
  }

  if (isError) return { ...base, note: "Still checking…" }

  return base
}

const ARRIVED_ON_ETHEREUM = "USDC arrived on Ethereum. Waiting for the deposit to be detected."

const BRIDGE_COPY: Record<BridgeStatusState, { heading?: string; message: string }> = {
  bridge_not_found: {
    message: "Transaction broadcast. Waiting for the bridge provider to pick it up.",
  },
  bridge_pending: { message: "Bridging USDC to Ethereum." },
  deposit_pending: { message: ARRIVED_ON_ETHEREUM },
  deposit_indexed: { message: "Deposit detected. Delivering now." },
  bridge_refunding: {
    heading: "Refund in progress",
    message: "The bridge is returning your funds. Checking until the refund confirms.",
  },
  bridge_refunded: {
    heading: "Refund confirmed",
    message: "The bridge refunded this transfer. See the transaction for details.",
  },
  bridge_partial: {
    heading: "Deposit needs attention",
    message:
      "The bridge delivered only part of this transfer. Check the details or contact support.",
  },
  bridge_refund_required: {
    heading: "Refund needs attention",
    message: "This refund needs your action. Check the details to complete it.",
  },
  bridge_failed: {
    heading: "Bridge failed",
    message:
      "The bridge could not complete this transfer. Check the details for the status of your funds.",
  },
}

function bridgeStage(inputs: DepositProgressInputs): DepositProgressView {
  const { state, error, conflict } = inputs.bridge

  // Evidence that disagrees with what we asked about supports no inference about delivery,
  // in either direction.
  if (error instanceof BridgeStatusConflictError && error.code === "upstream_conflict") {
    return conflictView(
      "The tracking details don't match this deposit. Your submitted transaction is still saved.",
    )
  }
  // A deterministic rejection of the request itself will not change on the next poll.
  if (error instanceof BridgeStatusConflictError && error.code === "invalid_request") {
    return conflictView("The tracking request was rejected. Your transaction details are saved.")
  }

  // A deposit that is not provably this user's must never complete this flow.
  if (conflict) return conflictView(conflict)

  const copy = state ? BRIDGE_COPY[state] : BRIDGE_COPY.bridge_not_found

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
    stage: "bridge",
    heading: copy.heading,
    message: copy.message,
    // Every remaining error is transient: the conflict cases returned above. Before any
    // state is known a failed read is indistinguishable from "not picked up yet".
    isRetrying: !!error && !!state,
    persist: state ? { lastState: state } : undefined,
  })
}

function correlateStage(inputs: DepositProgressInputs): DepositProgressView {
  const { isError, conflict } = inputs.direct

  if (conflict) return conflictView(conflict)

  return inFlight({
    stage: "correlate",
    // A 404 here is an indexing delay, never a missing transfer: the receipt is already
    // confirmed on Ethereum at this point.
    message: ARRIVED_ON_ETHEREUM,
    isRetrying: isError,
    persist: { lastState: "deposit_pending" },
  })
}

function depositStage(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const { bucket, advanceStatus, isError, minLabel, completedAmount, isSelfRecipient } =
    inputs.deposit
  const destination = session.destination.chainName || "the destination"

  switch (bucket) {
    case "waiting":
      return inFlight({
        stage: "deposit",
        title: "Confirming your deposit…",
        // Both transports reach the issued address on Ethereum.
        message: "Confirming on Ethereum.",
        isRetrying: isError,
        persist: { lastState: "waiting" },
      })
    case "processing":
      return inFlight({
        stage: "deposit",
        title: "Transferring…",
        // "pending" only means the backend picked fast delivery; it carries no different
        // timeout, retry or terminal meaning.
        message:
          advanceStatus === "pending"
            ? `Fast delivery to ${destination} in progress.`
            : `Delivering to ${destination}.`,
        isRetrying: isError,
        persist: { lastState: "processing" },
      })
    case "completed":
      return terminal({
        title: "Transfer complete",
        variant: "completed",
        message: isSelfRecipient
          ? `${completedAmount} delivered to your wallet on ${destination}.`
          : // A host-provided recipient means the sender did not receive the funds.
            `${completedAmount} delivered to the recipient on ${destination}.`,
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
      // A bucket this client cannot recognize is a contract problem, not a financial
      // outcome, so the session deliberately stays open rather than going terminal.
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
