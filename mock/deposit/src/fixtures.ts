// Fake Deposit record creation. Field rules follow the backend response shape
// so the records pass the frontend's boundary guards (assertDepositsAtAddress)
// and fail-closed rendering (displayBucket).

import type { Deposit } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import type { SimDeposit } from "./state.ts"
import { nextObservedHeight } from "./state.ts"
import type { DepositStatus } from "./statusMachine.ts"
import { bucketFor } from "./statusMachine.ts"

/** RFC 3339 with second precision, matching the backend's formatTime. */
export const toRfc3339 = (ms: number): string =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")

/** A fake source tx hash: lowercase 0x + 64 hex, the by-source-tx match key. */
export function randomSourceTxHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export interface CreateDepositInput {
  /** EIP-55 checksummed, from the recorded upstream derivation. */
  depositAddress: string
  /** Normalized lowercase init bech32. */
  walletAddress: string
  dstChainId: string
  dstDenom: string
  srcChainId: string
  srcDenom: string
  /** Source base-unit integer string. */
  amount: string
  /** Creation-time statuses only (the backend's CanTransition("" -> to)). */
  status: Extract<DepositStatus, "detected" | "below_minimum">
  /** Route minimum snapshot; required when status is below_minimum. */
  requiredMinAmount?: string
}

// Guarded here (not only at the control API) so no caller can mint a
// self-contradictory "below minimum 0" record.
function requireMinAmount(input: CreateDepositInput): string {
  if (input.requiredMinAmount === undefined) {
    throw new Error("below_minimum deposits require requiredMinAmount")
  }
  return input.requiredMinAmount
}

export function createSimDeposit(input: CreateDepositInput): SimDeposit {
  const nowMs = Date.now()
  const timestamp = toRfc3339(nowMs)
  const belowMinimum = input.status === "below_minimum"
  const record: Deposit = {
    id: crypto.randomUUID(),
    src_chain_id: input.srcChainId,
    src_tx_hash: randomSourceTxHash(),
    src_log_index: 0,
    src_denom: input.srcDenom,
    amount: input.amount,
    // amount_out stays absent until bridge planning (quote snapshot semantics).
    deposit_address: input.depositAddress,
    wallet_address: input.walletAddress,
    dst_chain_id: input.dstChainId,
    dst_denom: input.dstDenom,
    // v1 semantics: dst_address is the normalized wallet address itself.
    dst_address: input.walletAddress,
    observed_height: nextObservedHeight(),
    observed_at: timestamp,
    status: input.status,
    bucket: bucketFor(input.status),
    ...(belowMinimum
      ? { status_reason: "below_minimum", required_min_amount: requireMinAmount(input) }
      : {}),
    status_updated_at: timestamp,
    last_transition_actor: "indexer",
    last_transition_reason: belowMinimum ? "below_minimum" : "deposit_detected",
    created_at: timestamp,
    updated_at: timestamp,
    bot_tx_hash: "",
    bot_tx_explorer_url: "",
  }
  return { record, createdAtMs: nowMs, observedAtMs: nowMs }
}
