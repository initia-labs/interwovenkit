// Deposit lifecycle orchestration: transition application (with the table
// enforced), amount_out / bot-tx side effects, and the auto-advance timers.
// Kept out of state.ts so the stores stay runtime-neutral while this module
// may reach the upstream (quotes) and own setTimeout handles.

import type { Deposit } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { shiftDecimals } from "./amounts.ts"
import type { CreateDepositInput } from "./fixtures.ts"
import { randomSourceTxHash, toRfc3339 } from "./fixtures.ts"
import { createSimDeposit } from "./fixtures.ts"
import { fetchAssets, fetchQuote } from "./proxy.ts"
import type { SimDeposit } from "./state.ts"
import { addDeposit, getConfig, getDeposit, listDeposits } from "./state.ts"
import type { DepositStatus, TransitionMeta } from "./statusMachine.ts"
import { autoTransitionMeta, bucketFor, canTransition, nextAutoStatus } from "./statusMachine.ts"

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`invalid deposit status transition: ${from} -> ${to}`)
  }
}

/** Registers a fresh fake deposit and arms its auto-advance timer. */
export function registerDeposit(input: CreateDepositInput): SimDeposit {
  const sim = createSimDeposit(input)
  addDeposit(sim)
  syncAutoAdvance(sim)
  return sim
}

/**
 * Applies one transition, enforcing the allowed-transition table and the
 * status-dependent side effects (amount_out at bridge planning, bot tx at
 * bridge submission), then re-arms or clears the auto-advance timer.
 */
export async function applyTransition(
  sim: SimDeposit,
  to: DepositStatus,
  meta: TransitionMeta,
): Promise<void> {
  const from = sim.record.status
  if (!canTransition(from as DepositStatus, to)) throw new InvalidTransitionError(from, to)

  // Quote-snapshot semantics: the router is asked once, when bridge planning
  // starts, and the estimate sticks to the record from then on.
  if (to === "bridge_planned" && !sim.record.amount_out) {
    const amountOut = await resolveAmountOut(sim.record)
    // A forced transition may have landed during the await; applying the stale
    // step now would resurrect the deposit past it (e.g. failed -> bridge_planned).
    if (sim.record.status !== from) {
      throw new InvalidTransitionError(sim.record.status, to)
    }
    sim.record.amount_out = amountOut
  }

  sim.record.status = to
  sim.record.bucket = bucketFor(to)
  const timestamp = toRfc3339(Date.now())
  sim.record.status_updated_at = timestamp
  sim.record.updated_at = timestamp
  sim.record.last_transition_actor = meta.actor
  sim.record.last_transition_reason = meta.reason

  if (to === "bridge_submitted" && !sim.record.bot_tx_hash) {
    const botTxHash = randomSourceTxHash()
    sim.record.bot_tx_hash = botTxHash
    const search = new URLSearchParams({ chain_id: sim.record.src_chain_id, tx_hash: botTxHash })
    sim.record.bot_tx_explorer_url = `https://explorer.skip.build/?${search}`
  }

  syncAutoAdvance(sim)
}

/** Advances one step along the auto path; throws when off-path or terminal. */
export async function advanceOneStep(sim: SimDeposit): Promise<void> {
  const next = nextAutoStatus(sim.record.status)
  if (!next) throw new Error(`cannot advance from status: ${sim.record.status}`)
  await applyTransition(sim, next, autoTransitionMeta(next))
}

// Upstream quote first; when it fails, a plain decimals shift between the
// source and destination route decimals (1:1 approximation — UI-test grade).
async function resolveAmountOut(record: Deposit): Promise<string> {
  const quoted = await fetchQuote({
    srcChainId: record.src_chain_id,
    srcDenom: record.src_denom,
    dstChainId: record.dst_chain_id,
    dstDenom: record.dst_denom,
    amountIn: record.amount,
  })
  if (quoted) return quoted
  try {
    const assets = await fetchAssets()
    const route = assets.find(
      (asset) =>
        asset.src_chain_id === record.src_chain_id &&
        asset.src_denom.toLowerCase() === record.src_denom.toLowerCase(),
    )
    const network = route?.dst_networks.find(
      (network) =>
        network.chain_id === record.dst_chain_id &&
        network.denom.toLowerCase() === record.dst_denom.toLowerCase(),
    )
    // Pre-rollout upstream contracts omit src_decimals at runtime; a NaN shift
    // would silently produce an empty amount_out.
    if (route && network && typeof route.src_decimals === "number") {
      return shiftDecimals(record.amount, network.decimals - route.src_decimals)
    }
  } catch (error) {
    // Assets unavailable: fall through to the identity approximation.
    console.warn("assets lookup for amount_out failed; using the identity approximation", error)
  }
  return record.amount
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Arms/clears the deposit's timer to match its status and the current config. */
export function syncAutoAdvance(sim: SimDeposit): void {
  clearTimer(sim.record.id)
  const { autoAdvance, advanceIntervalMs } = getConfig()
  if (!autoAdvance) return
  if (!nextAutoStatus(sim.record.status)) return
  const timer = setTimeout(() => {
    timers.delete(sim.record.id)
    void autoAdvanceStep(sim.record.id)
  }, advanceIntervalMs)
  timers.set(sim.record.id, timer)
}

async function autoAdvanceStep(id: string): Promise<void> {
  const sim = getDeposit(id)
  if (!sim) return
  try {
    await advanceOneStep(sim)
  } catch (error) {
    // A concurrent forced transition can invalidate the scheduled step; the
    // deposit simply stops advancing, visible in this log and GET /__mock/deposits.
    console.error(`auto advance failed for deposit ${id}`, error)
  }
}

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

/** Re-arms every deposit timer; call after autoAdvance/advanceIntervalMs change. */
export function resyncAllTimers(): void {
  for (const sim of listDeposits()) syncAutoAdvance(sim)
}

export function clearAllTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}
