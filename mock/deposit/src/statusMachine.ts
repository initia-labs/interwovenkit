// Mirror of the backend's domain/status.go: the allowed-transition table, the
// user-facing bucket mapping, and the auto-advance path (the regular two-leg
// route, matching production where ADVANCE_ENABLED is off). Every mock transition
// must pass canTransition, so the UI never sees an impossible sequence. The
// detailed status enum lives here (not the library's types.ts) because the
// frontend consumes `bucket` only and keeps `status` opaque.

import type { DepositBucket } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"

export const DEPOSIT_STATUSES = [
  "detected",
  "accepted",
  "advance_pending",
  "advance_submitting",
  "advance_submitted",
  "advance_waiting",
  "funding_planned",
  "funding_submitting",
  "funding_submitted",
  "funded",
  "bridge_planned",
  "bridge_submitting",
  "bridge_submitted",
  "completed",
  "failed",
  "cancelled",
  "below_minimum",
] as const

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number]

export function parseDepositStatus(value: string): DepositStatus | null {
  return (DEPOSIT_STATUSES as readonly string[]).includes(value) ? (value as DepositStatus) : null
}

const TERMINAL_STATUSES: readonly DepositStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "below_minimum",
]

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Fail-closed mirror of the backend's UserFacingBucket (unknown -> failed). */
export function bucketFor(status: string): DepositBucket {
  switch (status as DepositStatus) {
    case "detected":
      return "waiting"
    case "accepted":
    case "advance_pending":
    case "advance_submitting":
    case "advance_submitted":
    case "advance_waiting":
    case "funding_planned":
    case "funding_submitting":
    case "funding_submitted":
    case "funded":
    case "bridge_planned":
    case "bridge_submitting":
    case "bridge_submitted":
      return "processing"
    case "completed":
      return "completed"
    case "failed":
    case "cancelled":
      return "failed"
    case "below_minimum":
      return "below_minimum"
    default:
      return "failed"
  }
}

// domain.allowedTransitions, verbatim.
const allowedTransitions: Partial<Record<DepositStatus, readonly DepositStatus[]>> = {
  detected: ["accepted", "failed", "cancelled"],
  accepted: ["advance_pending", "funding_planned", "failed", "cancelled"],
  advance_pending: ["advance_submitting", "advance_waiting", "failed", "cancelled"],
  advance_waiting: ["advance_pending", "failed", "cancelled"],
  advance_submitting: ["advance_submitted", "advance_pending", "failed", "cancelled"],
  advance_submitted: ["completed", "advance_pending", "failed", "cancelled"],
  funding_planned: ["funding_submitting", "failed", "cancelled"],
  funding_submitting: ["funding_submitted", "funding_planned", "failed", "cancelled"],
  funding_submitted: ["funded", "failed", "cancelled"],
  funded: ["bridge_planned", "failed", "cancelled"],
  bridge_planned: ["bridge_submitting", "failed", "cancelled"],
  bridge_submitting: ["bridge_submitted", "bridge_planned", "failed", "cancelled"],
  bridge_submitted: ["completed", "failed", "cancelled"],
}

/**
 * Whether a deposit can move directly from one status to another. An empty
 * `from` is a new deposit and may only enter an indexer-created status.
 */
export function canTransition(from: DepositStatus | "", to: DepositStatus): boolean {
  if (from === "") return to === "detected" || to === "below_minimum"
  return allowedTransitions[from]?.includes(to) ?? false
}

/** The regular two-leg route the auto-advance timer walks. */
export const AUTO_ADVANCE_PATH: readonly DepositStatus[] = [
  "detected",
  "accepted",
  "funding_planned",
  "funding_submitting",
  "funding_submitted",
  "funded",
  "bridge_planned",
  "bridge_submitting",
  "bridge_submitted",
  "completed",
]

/** The next status on the auto-advance path, or null when off-path or done. */
export function nextAutoStatus(status: string): DepositStatus | null {
  const index = AUTO_ADVANCE_PATH.indexOf(status as DepositStatus)
  if (index < 0 || index + 1 >= AUTO_ADVANCE_PATH.length) return null
  return AUTO_ADVANCE_PATH[index + 1]
}

export interface TransitionMeta {
  actor: string
  reason: string
}

// Reasons per transition target on the worker/indexer path, mirroring
// domain.TransitionReason* so records look like live measurements.
const AUTO_TRANSITION_META: Partial<Record<DepositStatus, TransitionMeta>> = {
  accepted: { actor: "indexer", reason: "deposit_finalized" },
  funding_planned: { actor: "worker", reason: "funding_planned" },
  funding_submitting: { actor: "worker", reason: "funding_submit_started" },
  funding_submitted: { actor: "worker", reason: "funding_submitted" },
  funded: { actor: "worker", reason: "funding_confirmed" },
  bridge_planned: { actor: "worker", reason: "bridge_planned" },
  bridge_submitting: { actor: "worker", reason: "bridge_submit_started" },
  bridge_submitted: { actor: "worker", reason: "bridge_submitted" },
  completed: { actor: "worker", reason: "bridge_confirmed" },
  advance_pending: { actor: "worker", reason: "advance_pending" },
  advance_waiting: { actor: "worker", reason: "advance_waiting" },
  advance_submitting: { actor: "worker", reason: "advance_submit_started" },
  advance_submitted: { actor: "worker", reason: "advance_submitted" },
}

/** Actor/reason for an automatic (timer or manual advance) transition. */
export function autoTransitionMeta(to: DepositStatus): TransitionMeta {
  return AUTO_TRANSITION_META[to] ?? { actor: "worker", reason: "deposit_finalized" }
}

/** Actor/reason for a forced transition via the control API. */
export function forcedTransitionMeta(from: DepositStatus | "", to: DepositStatus): TransitionMeta {
  if (to === "failed") return { actor: "operator", reason: "operator_failed" }
  if (to === "cancelled") return { actor: "operator", reason: "operator_cancelled" }
  if (to === "completed" && from === "advance_submitted") {
    return { actor: "operator", reason: "advance_confirmed" }
  }
  const meta = AUTO_TRANSITION_META[to]
  return { actor: "operator", reason: meta?.reason ?? "operator_recovered" }
}
