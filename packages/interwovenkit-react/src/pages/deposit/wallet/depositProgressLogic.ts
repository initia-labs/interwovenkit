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

/**
 * Every decision the deposit-progress screen makes, as one pure function.
 *
 * The screen reports on money that has already left the user's wallet, so the
 * rules that matter are negative ones: an unread RPC is not a failed transfer,
 * an unrecognized status is not a failure, and nothing but `bucket=completed`
 * on an exactly correlated deposit completes the flow. Keeping the whole
 * mapping here (rather than spread across query callbacks) is what makes those
 * rules testable — DepositProgress.tsx only runs queries and renders the result.
 */

/** Which screen family renders, matching DepositTrackingView's variants. */
export type DepositProgressVariant =
  | "in-flight"
  | "completed"
  | "failed"
  | "below-minimum"
  | "problem"

/**
 * The read the controller should be running. `none` stops automatic reads
 * without discarding anything: the session, its hashes and the last verified
 * evidence stay exactly as they are, and the user gets a manual refresh.
 */
export type DepositProgressStage = "source" | "bridge" | "correlate" | "deposit" | "none"

export interface DepositProgressView {
  stage: DepositProgressStage
  title: string
  variant: DepositProgressVariant
  /** Bold line above the message. */
  heading?: string
  /** Main copy; empty only when there is deliberately nothing to say yet. */
  message: string
  /** Secondary line under the message (evidence gaps, replacement lineage). */
  note?: string
  /** Renders the shared "Connection lost. Retrying…" notice. */
  isRetrying: boolean
  /** Terminal and problem screens offer Close; in flight there is nothing to close out of. */
  showClose: boolean
  /** Manual refresh, offered exactly where automatic reads have stopped. */
  showRefresh: boolean
  showChips: boolean
  /**
   * What the controller must write back to the session. Derived here so the
   * persisted trail matches the rendered claim: a screen that says "delivered"
   * and a record that says "pending" would disagree after a reload.
   */
  persist?: { phase?: DepositSessionPhase; lastState?: string }
}

export interface DepositProgressInputs {
  source: {
    /** Last resolved watch outcome; undefined while the first read is in flight. */
    outcome?: SourceTxOutcome
    /** The pinned read threw (node down, CORS, rate limit). An evidence gap. */
    isError: boolean
    /** A pinned provider exists for the source chain. */
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
    /** Formatted required minimum, "" when the route is gone from `config/assets`. */
    minLabel?: string
    /** Amount phrase from formatCompletedAmount. */
    completedAmount?: string
    /** The recipient is the connected wallet, not a host-provided custom address. */
    isSelfRecipient: boolean
  }
  /** The current stage has been running for the stall budget (60 s). */
  isDelayed: boolean
}

const IN_FLIGHT_TITLE = "Deposit in progress"
const NEUTRAL_TITLE = "Deposit status"

/** No automatic refund exists at any stage, so no screen may imply one. */
const NO_REFUND = "Your funds remain at the deposit address with no automatic refund."

/**
 * Heading for the post-send recovery block. The
 * transfer was sent; only the local record of it was lost, and the copy must
 * never walk that back into "not sent".
 */
export const recoveryHeading = "Save your transfer details"

const phaseIndex = (phase: DepositSessionPhase) => DEPOSIT_SESSION_PHASES.indexOf(phase)

// The three screen families, so each branch below states only what makes it
// different. They are constructors rather than spread-able constants because the
// defaults are the safety rules: an in-flight screen offers no exit, a terminal
// one is done reading, and a problem screen always leaves a way to look again.
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

/** A settled outcome. There is nothing left to read, so the screen closes out. */
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

/**
 * Automatic tracking stopped without a financial verdict — evidence is missing
 * or disagrees with the session. Never a claim about the funds, always a manual
 * refresh unless there is nothing left to re-read.
 */
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

/**
 * The hash currently being tracked. `currentSourceHash` wins because a repriced
 * replacement supersedes the hash the wallet first returned; `submitted.hash`
 * covers the window between the wallet's response and the first session write.
 */
export function trackedSourceHash(session: DepositSession): string {
  return session.currentSourceHash ?? session.submitted?.hash ?? ""
}

/**
 * Whether the session describes a transfer that is (or may be) in flight — the
 * gate for offering "Continue deposit". A `prepared` or `approval_*` session is
 * an abandoned form draft: nothing was broadcast, so resuming it would open a
 * progress screen with no transaction to report on. From `send_prompt` onward a
 * send may have happened, and the plan is explicit that a started prompt without
 * a result is ambiguous, never safe to dismiss.
 */
export function isResumableDepositSession(session: DepositSession): boolean {
  if (session.phase === "terminal") return false
  return phaseIndex(session.phase) >= phaseIndex("send_prompt")
}

/**
 * The sessions the hub may offer as "Continue deposit": in flight, and credited
 * to the connected account. The recipient filter is not cosmetic — a saved
 * session records where the funds land, and offering someone else's transfer
 * would show one account's amounts under another account's session.
 *
 * The caller has already scoped the list to the current API environment
 * (listDepositSessions takes the base URL), because a staging deposit address
 * and a production one are indistinguishable by shape.
 */
/** What the hub is currently depositing; a saved session must match all of it to be offered. */
export interface ResumeMatch {
  /** Final recipient of the current request (host-provided or connected), bech32. */
  recipient: string
  dstChainId: string
  dstDenom: string
  /** Host source allowlist; empty means unconstrained. */
  remoteOptions: AssetOption[]
}

/**
 * Sessions the hub may offer for the current request. Recipient, destination
 * and the host's source allowlist all have to agree: a session created for a
 * different recipient or a source the host excluded would reopen inside a
 * request whose contract it violates.
 */
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

/**
 * Short stage label for the resume row, from the last persisted evidence. Falls
 * back to the phase, which is written before every wallet prompt and therefore
 * always present.
 */
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

/**
 * The single decision point for the progress screen. `session` is null only when
 * neither storage nor the in-memory fallback holds a record — the one case where
 * there is genuinely nothing to report.
 */
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

  // The stall reassurance is armed per stage, so each leg of the pipeline gets
  // its own budget. It replaces the heading rather than the copy: the user still
  // needs to know which leg is slow, and "your funds are safe at your deposit
  // address" (the address tracker's wording) is false while a bridge still holds
  // them.
  if (view.variant === "in-flight" && inputs.isDelayed) {
    return {
      ...view,
      heading: "This is taking a little longer",
      note: view.note ?? "We're still checking. Your transfer stays saved.",
    }
  }
  return view
}

function resolve(session: DepositSession, inputs: DepositProgressInputs): DepositProgressView {
  const sourceHash = trackedSourceHash(session)

  if (!sourceHash) return withoutHash(session)

  // A correlated deposit id supersedes every earlier signal: it is the only
  // identity the backend can speak about authoritatively.
  if (session.depositId) return depositStage(session, inputs)

  // The backend's own observation of the source transaction is at least as
  // strong as a pinned receipt, so a lagging or failing RPC read never hides
  // progress the API already reports.
  const backendSawSource =
    (inputs.bridge.state !== undefined && inputs.bridge.state !== "bridge_not_found") ||
    inputs.direct.found === true
  if (inputs.source.outcome?.status !== "confirmed" && !backendSawSource) {
    return sourceStage(session, inputs)
  }

  return session.transport === "lifi" ? bridgeStage(inputs) : correlateStage(inputs)
}

/**
 * No hash to track. Either the wallet call never returned one (ambiguous — the
 * transfer may be on chain), or the session never reached a prompt at all.
 * The two must not share copy: one may not be resent, the other never happened.
 */
function withoutHash(session: DepositSession): DepositProgressView {
  if (phaseIndex(session.phase) >= phaseIndex("send_prompt")) {
    // No backend read is possible without a hash, and a nonce hint is not
    // evidence: staging v1 deliberately does not scan for the transaction.
    return problem({
      title: "Checking your transaction",
      heading: "Checking your transaction",
      message:
        "Your wallet request may have been submitted. We're checking before you can send again.",
      note: "Check your wallet's activity for a transfer from this account. Don't send again until you know.",
      showRefresh: false,
    })
  }

  return problem({
    heading: "Nothing to track yet",
    message: "This deposit was never submitted. Start a new deposit to try again.",
    showRefresh: false,
  })
}

/**
 * The transfer provably never reached the mempool, or was replaced by a
 * cancellation. Gas was still spent and an earlier approval may still stand, so
 * it never reads as "nothing happened".
 */
const notSent = (lastState: string) =>
  terminal({
    variant: "failed",
    heading: "Deposit not sent",
    message:
      "The source transaction was cancelled or reverted. Review the transaction details before starting again.",
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
    // Same nonce, different payload. That is not this transfer, and it is not a
    // proven cancellation either — stop mapping and keep both hashes.
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
    message: `Waiting for your ${chainName} transaction to confirm.`,
    persist: { lastState: hasReplacement ? "source_replaced" : "source_pending" },
  })

  if (!hasProvider) {
    // Missing RPC metadata is a capability gap on our side. The transfer is
    // unaffected, so the screen keeps waiting rather than claiming anything.
    return {
      ...base,
      note: `Cannot verify on ${chainName} right now. We'll keep trying.`,
    }
  }

  if (hasReplacement) {
    return {
      ...base,
      note: "Your wallet replaced the transaction. We're tracking the updated transaction.",
    }
  }

  if (isError) return { ...base, note: "Still checking…" }

  return base
}

const BRIDGE_COPY: Record<BridgeStatusState, { heading?: string; message: string }> = {
  bridge_not_found: {
    message: "Your transaction was sent. We're waiting for the bridge to pick it up.",
  },
  bridge_pending: { message: "Your USDC is being bridged to Ethereum." },
  deposit_pending: {
    message: "Your USDC reached Ethereum. We're waiting for the deposit to be detected.",
  },
  deposit_indexed: { message: "Your deposit was detected. Delivering it now." },
  bridge_refunding: {
    heading: "Refund in progress",
    message:
      "The bridge is returning your funds. We'll keep checking until the refund is confirmed.",
  },
  bridge_refunded: {
    heading: "Refund confirmed",
    message:
      "The bridge reports that your funds were refunded. Review the transaction details for the refund.",
  },
  bridge_partial: {
    heading: "Deposit needs attention",
    message:
      "The bridge reports a partial delivery. Review the transfer details or contact support.",
  },
  bridge_refund_required: {
    heading: "Refund needs attention",
    message:
      "The bridge reports that a refund requires action. Check the details for help completing it.",
  },
  bridge_failed: {
    heading: "Bridge failed",
    message:
      "The bridge couldn't complete this transfer. Review the details to check the status of your funds.",
  },
}

function bridgeStage(inputs: DepositProgressInputs): DepositProgressView {
  const { state, error, conflict } = inputs.bridge

  // The provider's evidence disagrees with what we asked about. Nothing about
  // delivery may be inferred from a disagreement, in either direction.
  if (error instanceof BridgeStatusConflictError && error.code === "upstream_conflict") {
    return conflictView(
      "The tracking details don't match this deposit. Your submitted transaction is still saved.",
    )
  }
  // A deterministic rejection of the request itself will not change on the
  // next poll; stop and keep the evidence rather than "retrying" forever.
  if (error instanceof BridgeStatusConflictError && error.code === "invalid_request") {
    return conflictView("The tracking request was rejected. Your transaction details are saved.")
  }

  // An indexed envelope that fails identity validation is the same class of
  // problem: a deposit that is not provably this user's must never complete
  // this flow.
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
    // Every remaining error is transient by construction: the conflict case
    // returned above, so a 429 or a 5xx only means the next poll has not landed.
    isRetrying: !!error,
    persist: state ? { lastState: state } : undefined,
  })
}

function correlateStage(inputs: DepositProgressInputs): DepositProgressView {
  const { isError, conflict } = inputs.direct

  if (conflict) return conflictView(conflict)

  return inFlight({
    stage: "correlate",
    // A 404 here is an indexing delay, never a missing transfer: the receipt is
    // already confirmed on Ethereum at this point.
    message: "Your USDC reached Ethereum. We're waiting for the deposit to be detected.",
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
        // Both transports reach the issued address on Ethereum, so this leg is
        // always an Ethereum confirmation.
        message: "Your deposit is confirming on Ethereum.",
        isRetrying: isError,
        persist: { lastState: "waiting" },
      })
    case "processing":
      return inFlight({
        stage: "deposit",
        title: "Transferring…",
        // "pending" says the backend picked fast delivery; it carries no
        // different timeout, retry or terminal meaning, so it is a heading only.
        heading: advanceStatus === "pending" ? "Fast delivery is processing" : undefined,
        message: `Your deposit is being delivered to ${destination}.`,
        isRetrying: isError,
        persist: { lastState: "processing" },
      })
    case "completed":
      return terminal({
        title: "Transfer complete",
        variant: "completed",
        message: isSelfRecipient
          ? `${completedAmount} was delivered to your wallet on ${destination}. It may take a moment to appear in your activity.`
          : // A host-provided recipient means the sender did not receive the
            // funds; claiming otherwise would be false.
            `${completedAmount} was delivered to the recipient on ${destination}.`,
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
      // A bucket this client cannot recognize is a contract problem, not a
      // financial outcome. It is deliberately not terminal: the session stays
      // open so a fixed client (or a corrected response) can resolve it.
      return problem({
        heading: "Status unavailable",
        message: "We couldn't read the latest deposit status. Your transfer details are saved.",
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
