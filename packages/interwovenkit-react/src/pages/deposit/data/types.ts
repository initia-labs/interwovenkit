// Deposit API (crypto onramp path) response types, decoded via ky's
// `.json<T>()` (no runtime schema library). All amount fields are integer
// base-unit strings; decimals vary per destination network. Chain ids are
// Router-style strings: EVM sources are numeric ("1" = Ethereum), Initia L1 is
// "interwoven-1", rollups are "yominet-1", "civitia-1", etc.

// VM types this client can receive on. Like `bucket`, the wire field is an open
// set (`string`): the server can add values ("not_supported" already exists,
// new VMs can follow), so the receive filter allowlists this set and an unknown
// value fails closed (network hidden) instead of rendering as supported.
export const SUPPORTED_VM_TYPES = ["move", "evm", "wasm"] as const

export type VmType = (typeof SUPPORTED_VM_TYPES)[number]

export function isSupportedVmType(vmType: string): vmType is VmType {
  return (SUPPORTED_VM_TYPES as readonly string[]).includes(vmType)
}

/** One destination network a logical asset can be received on. */
export interface DestinationNetwork {
  chain_id: string
  chain_name: string
  denom: string
  /** Decimals for this network (e.g. iUSD is 6 on move, 18 on EVM). */
  decimals: number
  /** Open wire set; see SUPPORTED_VM_TYPES. */
  vm_type: string
  /**
   * Best-effort processing estimate (route min amount → this network) in
   * seconds. Omitted or null when the backend has no cached router estimate,
   * so treat absence as "unknown", not zero.
   */
  processing_time_seconds?: number | null
}

/**
 * A supported source route expanded to its registry destination asset. The
 * operator sponsors gas and charges no service fee: the deposit `amount` is
 * passed to the Router as-is and the net received is the Router `amount_out`
 * (swap routes reflect slippage). So the crypto path shows no gas/fee, only the
 * minimum and the received amount.
 */
export interface Asset {
  src_chain_id: string
  src_denom: string
  /** Decimals of the source denom (for formatting min/required amounts). */
  src_decimals: number
  /** Minimum deposit in the source denom base unit (not destination). A backend
   * route setting that can change; always read it from here, never hardcode. */
  min_deposit_amount: string
  /** Fast-advance cap in source base units, "" when unset. Display only: gating a send on it would block deposits the backend accepts the ordinary way. */
  advance_max_amount?: string
  /**
   * Backend route-policy slippage tolerance as a percent string (e.g. "0.5";
   * "0.0" on swapless routes). Read-only display: slippage is not a user
   * setting in this architecture.
   */
  max_slippage_percent: string
  dst_symbol: string
  dst_networks: DestinationNetwork[]
}

/** GET /v1/config/assets */
export interface ListAssetsResponse {
  assets: Asset[]
}

/** POST /v1/deposit-address */
export interface DepositAddressResponse {
  wallet_address: string
  chain_id: string
  asset_denom: string
  /** EIP-55 checksummed 0x hex. */
  deposit_address: string
  /**
   * Opaque server-issued watermark ("v1." + base64url) for GET /v1/deposits'
   * `after` filter, reissued on every POST. Detection uses one issued for the
   * current mount (useFreshDepositAddress) so a cached watermark cannot
   * resurface the deposit that just finished at this reused address.
   */
  cursor: string
}

/**
 * GET /v1/quote. The backend's pre-quote: validates the route against its own
 * config and queries the router the same way bridge planning does, so the
 * estimate cannot drift from the bridge's routing and slippage policy (market
 * movement between quote and execution still applies). Amounts are destination
 * base units; `min_received` already has the route-policy slippage floored in.
 */
export interface QuoteResponse {
  amount_out: string
  min_received: string
}

// Server-computed user-facing lifecycle groups, split by liveness. The server
// maps every wire status (including ones added after this client shipped) onto
// this stable set, so the client keys terminal judgment and screen selection on
// `bucket` and treats `status` as opaque. The type is derived from the arrays
// so the runtime checks (isTerminalBucket, displayBucket) can't drift from it.
// Terminal mirrors the API's `active=false` filter.
export const ACTIVE_DEPOSIT_BUCKETS = ["waiting", "processing"] as const
export const TERMINAL_DEPOSIT_BUCKETS = ["completed", "failed", "below_minimum"] as const
export const DEPOSIT_BUCKETS = [...ACTIVE_DEPOSIT_BUCKETS, ...TERMINAL_DEPOSIT_BUCKETS] as const

export type DepositBucket = (typeof DEPOSIT_BUCKETS)[number]

export interface Deposit {
  id: string
  src_chain_id: string
  src_tx_hash: string
  src_log_index: number
  src_denom: string
  amount: string
  /**
   * Destination base units the router quoted at bridge-planning time — an
   * estimate, not a measured receipt (delivery may differ within route-policy
   * slippage). Absent until bridge planning has queried the router (waiting
   * statuses, below_minimum, failures before planning).
   */
  amount_out?: string
  /** EIP-55 checksummed 0x hex. */
  deposit_address: string
  /** Normalized init bech32 (lowercase). */
  wallet_address: string
  dst_chain_id: string
  dst_denom: string
  /** v1: identical to wallet_address. */
  dst_address: string
  observed_height: number
  observed_at: string
  /**
   * Detailed wire status (e.g. "detected", "funding_submitting"). Opaque: the
   * server can add statuses anytime, so nothing branches on it — rendering and
   * terminal judgment use `bucket`. Only compared for identity (the stall timer
   * re-arms per status change).
   */
  status: string
  /**
   * Server-computed lifecycle group for `status`; the authority for screen
   * selection and terminal judgment. Typed `string`, not `DepositBucket`: the
   * wire can carry values outside the stable set, and a narrower claim would
   * invite exhaustive `switch`es that defeat the fail-closed handling.
   * `displayBucket` is the single parse point (unknown → "failed"), and
   * `isTerminalBucket` counts an unknown value as terminal.
   */
  bucket: string
  /** "below_minimum" or empty string only. */
  status_reason?: string
  /** Route minimum snapshot, set when status=below_minimum. */
  required_min_amount?: string
  status_updated_at: string
  last_transition_actor?: string
  /** Machine-readable reason code. */
  last_transition_reason?: string
  last_correlation_id?: string
  created_at: string
  updated_at: string
  /** Latest bridge tx hash; empty string before submission. */
  bot_tx_hash: string
  /** Explorer URL for the bridge tx; empty string before submission. */
  bot_tx_explorer_url: string
  /** Fast-delivery lifecycle, opaque like `status`. "failed" is not a financial outcome — the backend still falls back to ordinary delivery. */
  advance_status?: string
  /** Latest fast-delivery L1 submission hash, recorded before broadcast — it proves neither inclusion nor success. */
  advance_tx_hash?: string
  advance_tx_explorer_url?: string
  /** Operator's internal treasury reclaim; never rendered, it is not the user's deposit. */
  reclaim_status?: string
}

/** GET /v1/deposits. Echoes whichever filters were sent; only `deposits` is consumed. */
export interface ListDepositsResponse {
  wallet_address?: string
  deposit_address?: string
  deposits: Deposit[]
  /**
   * Pagination: whether rows beyond `deposits` matched, and the next-page
   * cursor (present only when has_more). Not consumed: discovery polls a
   * per-address list far below the limit.
   */
  has_more: boolean
  next_cursor?: string
}

// Pre-deposit bridge leg (Base/Arbitrum USDC -> Ethereum USDC via LI.FI). The
// Deposit API fronts LI.FI; the client never calls LI.FI directly. Every shape
// below is parsed at the boundary (data/bridges.ts) before a wallet prompt.

/** One executable LI.FI route from the source chain to the Ethereum deposit address. */
export interface BridgeOption {
  bridge: string
  /** Expected Ethereum USDC delivered, in Ethereum base units. */
  amount_out: string
  /** Guaranteed Ethereum USDC after LI.FI slippage; the value every minimum gate compares. */
  min_received: string
  eligible: boolean
  /** Absent when LI.FI supplied no estimate — unknown, never zero. */
  execution_duration_seconds?: number
  /** Decimal USD string; absent when LI.FI supplied no estimate — unknown, never zero. */
  gas_cost_usd?: string
}

/** POST /v1/bridges/options */
export interface BridgeOptionsResponse {
  /** Issued Ethereum address every option delivers to (EIP-55 checksummed 0x hex). */
  deposit_address: string
  /** Ethereum base units the delivered amount must reach for the deposit to be accepted. */
  required_min_received: string
  options: BridgeOption[]
}

export interface BridgeQuoteApproval {
  token_address: string
  spender_address: string
  amount: string
}

/** The exact source-chain call to sign. Never rewritten client-side. */
export interface BridgeQuoteTransaction {
  chain_id: string
  from: string
  to: string
  /** Native base units as a decimal string (normalized from the wire's hex). Nonzero on ERC-20 sources when the bridge charges a messaging fee, so it is forwarded as-is. */
  value: string
  data: string
  gas_limit?: string
  gas_price?: string
}

/** POST /v1/bridges/quote */
export interface BridgeQuoteResponse {
  provider: "lifi"
  src_chain_id: string
  src_denom: string
  dst_chain_id: string
  dst_denom: string
  amount: string
  /** Canonical destination wallet the deposit address is bound to (init bech32, lowercase). */
  wallet_address: string
  deposit_address: string
  /** Monitoring watermark issued before the source transaction is submitted. */
  cursor: string
  amount_out: string
  min_received: string
  /** The selected LI.FI tool; must echo the requested bridge key. */
  tool: string
  quote_id?: string
  estimate: {
    execution_duration_seconds?: number
    gas_cost_usd?: string
  }
  /** null for native sources; required and validated for ERC-20 sources. */
  approval: BridgeQuoteApproval | null
  transaction: BridgeQuoteTransaction
}

// Closed on the wire (an OpenAPI enum), unlike `Deposit.bucket`: an unrecognized
// value is a tracking-contract problem, never a financial outcome.
export const BRIDGE_STATUS_STATES = [
  "deposit_indexed",
  "deposit_pending",
  "bridge_not_found",
  "bridge_pending",
  "bridge_refunding",
  "bridge_partial",
  "bridge_refunded",
  "bridge_refund_required",
  "bridge_failed",
] as const

export type BridgeStatusState = (typeof BRIDGE_STATUS_STATES)[number]

/** GET /v1/bridges/status */
export interface BridgeStatusResponse {
  state: BridgeStatusState
  /** Normalized to a string; the wire sends a JSON integer (8453 | 42161). */
  src_chain_id: string
  src_tx_hash: string
  src_tx_link: string
  dst_tx_hash?: string
  dst_tx_link?: string
  bridge?: string
  /** Non-null only for `deposit_indexed`; validated by assertLifiDeposit before handoff. */
  deposit: Deposit | null
}

/** Coded failures unique to GET /v1/bridges/status (`{ error, message }`, not `{ message }`). */
export const BRIDGE_STATUS_ERROR_CODES = [
  "invalid_request",
  "upstream_conflict",
  "upstream_unavailable",
  "rate_limited",
  "internal_error",
] as const

export type BridgeStatusErrorCode = (typeof BRIDGE_STATUS_ERROR_CODES)[number]
