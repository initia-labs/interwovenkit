import BigNumber from "bignumber.js"
import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { normalizeError } from "@/data/http"
import { depositQueryKeys } from "./api"
import { normalizeDenom } from "./assetOptions"
import { pollInterval } from "./deposits"
import {
  assertField,
  isBoolean,
  isDecimalString,
  isEvmAddress,
  isEvmTxHash,
  isHexData,
  isHexQuantity,
  isIntegerString,
  isNonEmptyString,
  isPositiveIntegerString,
  isRecord,
  isString,
} from "./parse"
import type {
  BridgeOption,
  BridgeOptionsResponse,
  BridgeQuoteApproval,
  BridgeQuoteResponse,
  BridgeQuoteTransaction,
  BridgeStatusResponse,
  BridgeStatusState,
  Deposit,
} from "./types"
import { BRIDGE_STATUS_STATES } from "./types"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const eqAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const eqAmount = (a: string, b: string) =>
  isIntegerString(a) && isIntegerString(b) && BigInt(a) === BigInt(b)

// A missing estimate must stay distinguishable from a real zero: unknown
// duration is not instantaneous and unknown gas is not free, so both sort last.
function parseOptionalDuration(value: unknown, context: string): number | undefined {
  if (value === undefined || value === null) return undefined
  assertField(
    typeof value === "number" && Number.isInteger(value) && value >= 0,
    `${context} has an invalid execution_duration_seconds: ${String(value)}`,
  )
  return value
}

function parseOptionalGasCost(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  assertField(isDecimalString(value), `${context} has an invalid gas_cost_usd: ${String(value)}`)
  return value
}

/** The locally retained request a bridge response must be bound to before it can be signed. */
export interface BridgeRequestIdentity {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  /** Source base units, integer string. */
  amount: string
  fromAddress: string
  /** Final credited recipient (init bech32, lowercase) — not the sender. */
  walletAddress: string
}

function toBridgeRequestBody(request: BridgeRequestIdentity & { bridge?: string }) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amount, fromAddress, walletAddress } = request
  return {
    src_chain_id: srcChainId,
    src_denom: srcDenom,
    dst_chain_id: dstChainId,
    dst_denom: dstDenom,
    amount,
    from_address: fromAddress,
    wallet_address: walletAddress,
    ...(request.bridge ? { bridge: request.bridge } : {}),
  }
}

const describeRequest = (request: BridgeRequestIdentity) =>
  `${request.srcChainId}:${request.srcDenom} -> ${request.dstChainId}:${request.dstDenom}`

// A malformed min_received silently losing a comparison would let the user pick
// a route that strands the deposit below the Ethereum minimum, with no refund.
export function parseBridgeOptions(
  response: unknown,
  request: BridgeRequestIdentity,
): BridgeOptionsResponse {
  const context = `Bridge options response (${describeRequest(request)})`
  assertField(isRecord(response), `${context} is not an object`)

  const { deposit_address, required_min_received, options } = response
  assertField(
    isEvmAddress(deposit_address),
    `${context} has an invalid deposit address: ${String(deposit_address)}`,
  )
  assertField(
    isPositiveIntegerString(required_min_received),
    `${context} has an invalid required_min_received: ${String(required_min_received)}`,
  )
  assertField(Array.isArray(options), `${context} is missing its options array`)

  const seen = new Set<string>()
  const parsed = options.map((option, index): BridgeOption => {
    const where = `${context} option ${index}`
    assertField(isRecord(option), `${where} is not an object`)
    const { bridge, amount_out, min_received, eligible } = option
    assertField(isNonEmptyString(bridge), `${where} has an invalid bridge key: ${String(bridge)}`)
    assertField(!seen.has(bridge.toLowerCase()), `${context} repeats the bridge key ${bridge}`)
    seen.add(bridge.toLowerCase())
    assertField(
      isPositiveIntegerString(amount_out),
      `${where} (${bridge}) has an invalid amount_out: ${String(amount_out)}`,
    )
    assertField(
      isPositiveIntegerString(min_received),
      `${where} (${bridge}) has an invalid min_received: ${String(min_received)}`,
    )
    assertField(
      isBoolean(eligible),
      `${where} (${bridge}) has a non-boolean eligible: ${String(eligible)}`,
    )
    return {
      bridge,
      amount_out,
      min_received,
      eligible,
      execution_duration_seconds: parseOptionalDuration(
        option.execution_duration_seconds,
        `${where} (${bridge})`,
      ),
      gas_cost_usd: parseOptionalGasCost(option.gas_cost_usd, `${where} (${bridge})`),
    }
  })

  return { deposit_address, required_min_received, options: parsed }
}

const knownDuration = (option: BridgeOption): number | undefined => {
  const value = option.execution_duration_seconds
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

const knownGasCost = (option: BridgeOption): BigNumber | undefined =>
  // Guarded before BigNumber(): strict mode throws on unparseable input, and a
  // ranking helper must never take down the route list.
  isDecimalString(option.gas_cost_usd) ? BigNumber(option.gas_cost_usd) : undefined

// Every supported source is canonical USDC, and gas is quoted in USD, so the
// two can be netted in USDC base units with USDC taken as one dollar.
const USDC_DECIMALS = 6

/** Output minus quoted gas; unknown without a gas estimate, so a route with an unstated fee never ranks best. */
function netValue(option: BridgeOption): BigNumber | undefined {
  if (!isIntegerString(option.amount_out)) return undefined
  const gas = knownGasCost(option)
  if (!gas) return undefined
  return BigNumber(option.amount_out).minus(gas.shiftedBy(USDC_DECIMALS))
}

/** Unknown sorts after every known value, so a missing estimate can never win a tie-break. */
function compareUnknownLast<T>(
  a: T | undefined,
  b: T | undefined,
  compare: (a: T, b: T) => number,
): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return compare(a, b)
}

// Routes within this share of the best net value are "competitive" and ordered
// by speed instead of output; 0.5% is the backend's own slippage tolerance.
export const COMPETITIVE_VALUE_TOLERANCE = 0.005

// Gaps under this many dollars count as competitive regardless of the share, so
// tenths of a cent of gas never outrank minutes.
export const COMPETITIVE_VALUE_FLOOR_USD = 0.01

function bestNetValue(options: BridgeOption[]): BigNumber | undefined {
  return options
    .filter((option) => option.eligible)
    .map(netValue)
    .filter((value): value is BigNumber => value !== undefined)
    .reduce<BigNumber | undefined>(
      (best, value) => (best && best.gte(value) ? best : value),
      undefined,
    )
}

// Eligible routes first; among them, routes competitive on net value (output
// minus gas) order by duration, then gas, then value. Total and never throws:
// malformed values sort last so the picker still renders.
export function rankBridgeOptions(options: BridgeOption[]): BridgeOption[] {
  const nets = new Map(options.map((option) => [option.bridge, netValue(option)]))
  const best = bestNetValue(options)
  const floor =
    best &&
    BigNumber.min(
      best.times(1 - COMPETITIVE_VALUE_TOLERANCE),
      best.minus(BigNumber(COMPETITIVE_VALUE_FLOOR_USD).shiftedBy(USDC_DECIMALS)),
    )
  const isCompetitive = (option: BridgeOption) => {
    const net = nets.get(option.bridge)
    return option.eligible && !!floor && !!net && net.gte(floor)
  }

  const byKey = (a: BridgeOption, b: BridgeOption) =>
    a.bridge < b.bridge ? -1 : a.bridge > b.bridge ? 1 : 0
  // comparedTo answers null only for NaN operands, which the decimal guards
  // above exclude; `?? 0` keeps the sort total.
  const byNet = (a: BridgeOption, b: BridgeOption) =>
    compareUnknownLast(nets.get(a.bridge), nets.get(b.bridge), (x, y) => y.comparedTo(x) ?? 0)
  const byDuration = (a: BridgeOption, b: BridgeOption) =>
    compareUnknownLast(knownDuration(a), knownDuration(b), (x, y) => x - y)
  const byGas = (a: BridgeOption, b: BridgeOption) =>
    compareUnknownLast(knownGasCost(a), knownGasCost(b), (x, y) => x.comparedTo(y) ?? 0)

  const tier = (option: BridgeOption) => (!option.eligible ? 2 : isCompetitive(option) ? 0 : 1)
  return [...options].sort((a, b) => {
    const byTier = tier(a) - tier(b)
    if (byTier !== 0) return byTier
    if (tier(a) === 0) return byDuration(a, b) || byGas(a, b) || byNet(a, b) || byKey(a, b)
    return byNet(a, b) || byDuration(a, b) || byKey(a, b)
  })
}

/** Signed percentage of `value` against `best` ("-1.00%"); "" when either is unknown. Display only. */
export function percentDifference(value: string | undefined, best: string | undefined): string {
  if (!value || !best || !isIntegerString(value) || !isIntegerString(best)) return ""
  if (BigNumber(best).lte(0)) return ""
  const percent = BigNumber(value).minus(best).div(best).times(100).toFixed(2)
  if (BigNumber(percent).isZero()) return "0.00%"
  return `${percent.startsWith("-") ? "" : "+"}${percent}%`
}

function parseApproval(
  value: unknown,
  request: { sourceToken: string },
  context: string,
): BridgeQuoteApproval | null {
  // Only ERC-20 sources need an allowance; a null approval there means the quote
  // would be signed with no allowance in place and revert after the user paid gas.
  const needsApproval = request.sourceToken.startsWith("0x")
  if (value === null || value === undefined) {
    assertField(!needsApproval, `${context} is missing the ERC-20 approval`)
    return null
  }
  assertField(isRecord(value), `${context} has a malformed approval`)
  const { token_address, spender_address, amount } = value
  // An approval for a different token would grant a spender allowance over an
  // asset the user never chose to bridge.
  assertField(
    isString(token_address) &&
      normalizeDenom(token_address) === normalizeDenom(request.sourceToken),
    `${context} approval token_address mismatch: ${String(token_address)}`,
  )
  assertField(
    isEvmAddress(spender_address) && !eqAddress(spender_address, ZERO_ADDRESS),
    `${context} approval spender_address is invalid: ${String(spender_address)}`,
  )
  assertField(
    isPositiveIntegerString(amount),
    `${context} approval amount is invalid: ${String(amount)}`,
  )
  return { token_address, spender_address, amount }
}

function parseTransaction(
  value: unknown,
  request: BridgeRequestIdentity,
  context: string,
): BridgeQuoteTransaction {
  assertField(isRecord(value), `${context} has a malformed transaction`)
  const { chain_id, from, to, data, value: nativeValue, gas_limit, gas_price } = value

  // Signing on the wrong chain sends real funds to an address that means
  // something else there.
  assertField(
    String(chain_id) === request.srcChainId,
    `${context} transaction chain_id mismatch: ${String(chain_id)}`,
  )
  assertField(
    isString(from) && eqAddress(from, request.fromAddress),
    `${context} transaction from mismatch: ${String(from)}`,
  )
  assertField(isEvmAddress(to), `${context} transaction has an invalid to address: ${String(to)}`)
  assertField(isHexData(data), `${context} transaction has non-hex calldata`)

  // A dropped protocol/messaging fee makes the bridge call revert; a fabricated
  // one overpays from the user's own balance.
  assertField(
    isHexQuantity(nativeValue) || isIntegerString(nativeValue),
    `${context} transaction has an invalid value: ${String(nativeValue)}`,
  )
  const normalizedValue = isHexQuantity(nativeValue) ? BigInt(nativeValue).toString() : nativeValue

  // Staging sends the gas fields as 0x-hex (like `value`), the OpenAPI types
  // them as strings without saying which; accept both and normalize to decimal.
  let gasLimit: string | undefined
  if (gas_limit !== undefined && gas_limit !== null && gas_limit !== "") {
    const normalized = isHexQuantity(gas_limit) ? BigInt(gas_limit).toString() : gas_limit
    assertField(
      isPositiveIntegerString(normalized),
      `${context} transaction has an invalid gas_limit: ${String(gas_limit)}`,
    )
    gasLimit = normalized
  }

  return {
    chain_id: String(chain_id),
    from,
    to,
    value: normalizedValue,
    data,
    ...(gasLimit ? { gas_limit: gasLimit } : {}),
    // Kept for diagnostics only; the wallet prices the transaction (forwarding a
    // quoted legacy gas_price would underprice it minutes later).
    ...(typeof gas_price === "string" && gas_price ? { gas_price } : {}),
  }
}

// The response *is* the transaction the user signs, so every field is bound to
// the request identity the form still holds: a quote echoing a different chain,
// denom, amount, recipient or sender would move real funds, with no refund path.
export function parseBridgeQuote(
  response: unknown,
  request: BridgeRequestIdentity & { bridge: string; sourceToken: string },
): BridgeQuoteResponse {
  const context = `Bridge quote response (${describeRequest(request)})`
  assertField(isRecord(response), `${context} is not an object`)

  const { provider, tool, cursor, deposit_address, amount_out, min_received } = response
  const { src_chain_id, src_denom, dst_chain_id, dst_denom, amount, wallet_address } = response
  assertField(provider === "lifi", `${context} has an unexpected provider: ${String(provider)}`)
  assertField(
    String(src_chain_id) === request.srcChainId,
    `${context} src_chain_id mismatch: ${String(src_chain_id)}`,
  )
  assertField(
    isString(src_denom) && normalizeDenom(src_denom) === normalizeDenom(request.srcDenom),
    `${context} src_denom mismatch: ${String(src_denom)}`,
  )
  assertField(
    isString(dst_chain_id) && dst_chain_id === request.dstChainId,
    `${context} dst_chain_id mismatch: ${String(dst_chain_id)}`,
  )
  assertField(
    isString(dst_denom) && normalizeDenom(dst_denom) === normalizeDenom(request.dstDenom),
    `${context} dst_denom mismatch: ${String(dst_denom)}`,
  )
  assertField(
    isString(amount) && eqAmount(amount, request.amount),
    `${context} amount mismatch: ${String(amount)}`,
  )
  // The recipient the issued address is bound to. A mismatch credits someone else.
  assertField(
    isString(wallet_address) && eqAddress(wallet_address, request.walletAddress),
    `${context} wallet_address mismatch: ${String(wallet_address)}`,
  )
  // Case-insensitive, matching the backend's own tool normalization: executing a
  // different bridge than the one reviewed is a silent route substitution.
  assertField(
    isString(tool) && tool.toLowerCase() === request.bridge.toLowerCase(),
    `${context} tool mismatch: ${String(tool)} (selected ${request.bridge})`,
  )
  assertField(
    isEvmAddress(deposit_address),
    `${context} has an invalid deposit address: ${String(deposit_address)}`,
  )
  // Without the monitoring watermark the deposit cannot be correlated after the
  // transfer lands — the same silent-failure standard as assertDepositAddress.
  assertField(isNonEmptyString(cursor), `${context} is missing the cursor`)
  assertField(
    isPositiveIntegerString(amount_out),
    `${context} has an invalid amount_out: ${String(amount_out)}`,
  )
  assertField(
    isPositiveIntegerString(min_received),
    `${context} has an invalid min_received: ${String(min_received)}`,
  )

  const estimate = isRecord(response.estimate) ? response.estimate : {}
  const quoteId = isNonEmptyString(response.quote_id) ? response.quote_id : ""

  return {
    provider: "lifi",
    src_chain_id: String(src_chain_id),
    src_denom,
    dst_chain_id,
    dst_denom,
    amount,
    wallet_address,
    deposit_address,
    cursor,
    amount_out,
    min_received,
    tool,
    ...(quoteId ? { quote_id: quoteId } : {}),
    estimate: {
      execution_duration_seconds: parseOptionalDuration(
        estimate.execution_duration_seconds,
        `${context} estimate`,
      ),
      gas_cost_usd: parseOptionalGasCost(estimate.gas_cost_usd, `${context} estimate`),
    },
    approval: parseApproval(response.approval, request, context),
    transaction: parseTransaction(response.transaction, request, context),
  }
}

// Fingerprint of what the user reviewed and what can change under a refresh, so
// an already-granted review can be reconfirmed. Calldata and gas are excluded:
// LI.FI re-encodes both on every quote, which would force a click per refresh.
export function bridgeQuoteSignature(quote: BridgeQuoteResponse): string {
  const { transaction, approval } = quote
  return JSON.stringify([
    quote.tool.toLowerCase(),
    transaction.chain_id,
    transaction.to.toLowerCase(),
    transaction.value,
    approval?.token_address.toLowerCase() ?? "",
    approval?.spender_address.toLowerCase() ?? "",
    approval?.amount ?? "",
    quote.amount_out,
    quote.min_received,
    quote.deposit_address.toLowerCase(),
  ])
}

// Both minimums must clear. The backend enforces the same comparison, so
// skipping it only sends a transfer it then refuses — leaving USDC at the
// deposit address below the minimum, with no automatic refund. Fails closed.
export function meetsRequiredMinimum(
  quote: Pick<BridgeQuoteResponse, "min_received">,
  requiredMinReceived: string,
  routeMinDeposit: string,
): boolean {
  if (!isPositiveIntegerString(quote.min_received)) return false
  if (!isIntegerString(requiredMinReceived) || !isIntegerString(routeMinDeposit)) return false
  const required = BigInt(requiredMinReceived)
  const routeMin = BigInt(routeMinDeposit)
  return BigInt(quote.min_received) >= (required > routeMin ? required : routeMin)
}

const isBridgeStatusState = (value: unknown): value is BridgeStatusState =>
  typeof value === "string" && (BRIDGE_STATUS_STATES as readonly string[]).includes(value)

// Display-only links degrade to "" rather than throwing: a cosmetic explorer URL
// must never stop tracking a transfer that is already in flight.
const asDisplayString = (value: unknown): string => (isString(value) ? value : "")

// Checked only far enough that assertLifiDeposit can compare its fields without
// reading `undefined` as a match; the financial identity check stays there.
function asDepositRecord(value: unknown, context: string): Deposit {
  assertField(isRecord(value), `${context} deposit is not an object`)
  for (const field of [
    "id",
    "src_chain_id",
    "src_tx_hash",
    "src_denom",
    "amount",
    "deposit_address",
    "wallet_address",
    "dst_chain_id",
    "dst_denom",
    "bucket",
  ]) {
    assertField(
      isString(value[field]),
      `${context} deposit has an invalid ${field}: ${String(value[field])}`,
    )
  }
  return value as unknown as Deposit
}

// The envelope must echo the exact source transaction this session sent: a
// status for someone else's transfer would hand off a foreign Deposit. The wire
// sends `src_chain_id` as a JSON integer, so it is normalized before comparing.
// `deposit` is present only for `deposit_indexed` — that pairing is the handoff.
export function parseBridgeStatus(
  response: unknown,
  expected: { srcChainId: string; srcTxHash: string },
): BridgeStatusResponse {
  const context = "Bridge status response"
  assertField(isRecord(response), `${context} is not an object`)

  const { state, src_chain_id, src_tx_hash, dst_tx_hash, bridge, deposit } = response
  assertField(isBridgeStatusState(state), `${context} has an unknown state: ${String(state)}`)
  assertField(
    String(src_chain_id) === expected.srcChainId,
    `${context} src_chain_id mismatch: ${String(src_chain_id)}`,
  )
  assertField(
    isString(src_tx_hash) && src_tx_hash.toLowerCase() === expected.srcTxHash.toLowerCase(),
    `${context} src_tx_hash mismatch: ${String(src_tx_hash)}`,
  )

  let dstTxHash: string | undefined
  if (dst_tx_hash !== undefined && dst_tx_hash !== null && dst_tx_hash !== "") {
    assertField(
      isEvmTxHash(dst_tx_hash),
      `${context} has an invalid dst_tx_hash: ${String(dst_tx_hash)}`,
    )
    dstTxHash = dst_tx_hash
  }

  const hasDeposit = deposit !== null && deposit !== undefined
  if (state === "deposit_indexed") {
    assertField(hasDeposit, `${context} reports deposit_indexed without a deposit`)
  } else {
    assertField(!hasDeposit, `${context} carries a deposit in state ${state}`)
  }

  return {
    state,
    src_chain_id: String(src_chain_id),
    src_tx_hash,
    src_tx_link: asDisplayString(response.src_tx_link),
    ...(dstTxHash ? { dst_tx_hash: dstTxHash } : {}),
    ...(isNonEmptyString(response.dst_tx_link) ? { dst_tx_link: response.dst_tx_link } : {}),
    ...(isNonEmptyString(bridge) ? { bridge } : {}),
    deposit: state === "deposit_indexed" ? asDepositRecord(deposit, context) : null,
  }
}

// `upstream_conflict` is the hard-recovery code: the provider's evidence
// disagrees with what was requested, so nothing about delivery may be inferred
// and automatic polling must stop.
export class BridgeStatusConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "BridgeStatusConflictError"
  }
}

/** Server-directed backoff. `retryAfterMs` is absent when the server sent no usable header. */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = "RateLimitedError"
  }
}

function parseRetryAfterMs(header: string | null): number | undefined {
  // The endpoint documents delta-seconds; the HTTP-date form is ignored rather
  // than guessed at, and the caller falls back to its own backoff.
  if (!header || !isIntegerString(header.trim())) return undefined
  return Number.parseInt(header.trim(), 10) * 1000
}

// Always throws. This endpoint answers `{ error, message }` instead of the
// API-wide `{ message }`: an `upstream_conflict` must stop polling, and a 429
// must be honored with the server's own delay.
export async function classifyBridgeStatusError(error: unknown): Promise<never> {
  if (error instanceof HTTPError) {
    const { response } = error
    // Cloned so the fallback normalizeError below can still read the body.
    const coded = await readCodedBody(response)
    if (response.status === 429) {
      throw new RateLimitedError(
        coded?.message || "Bridge status is rate limited",
        parseRetryAfterMs(response.headers.get("Retry-After")),
      )
    }
    if (coded) throw new BridgeStatusConflictError(coded.code, coded.message)
  }
  throw await normalizeError(error)
}

async function readCodedBody(
  response: Response,
): Promise<{ code: string; message: string } | undefined> {
  try {
    const body: unknown = await response.clone().json()
    if (!isRecord(body) || !isNonEmptyString(body.error)) return undefined
    return {
      code: body.error,
      message: isNonEmptyString(body.message) ? body.message : body.error,
    }
  } catch {
    return undefined
  }
}

const BRIDGE_STATUS_STOP_STATES: readonly BridgeStatusState[] = [
  // Handoff complete: the deposit id takes over (see walletPollUntilTerminal).
  "deposit_indexed",
  // Terminal provider outcomes; none may later turn into a delivery.
  "bridge_partial",
  "bridge_refunded",
  "bridge_refund_required",
  "bridge_failed",
]

// Stops on a hard conflict and on terminal or handed-off states, and honors a
// 429 with the server's delay. `false` never means the transfer failed — the
// session and its hashes are preserved for manual refresh.
export function bridgeStatusPollInterval(
  state: BridgeStatusState | undefined,
  error: Error | null,
  elapsedMs: number,
): number | false {
  // upstream_conflict is the hard recovery state; invalid_request is a
  // deterministic rejection of this exact request. Neither changes on retry.
  if (
    error instanceof BridgeStatusConflictError &&
    (error.code === "upstream_conflict" || error.code === "invalid_request")
  ) {
    return false
  }
  if (state && BRIDGE_STATUS_STOP_STATES.includes(state)) return false
  if (error instanceof RateLimitedError) return error.retryAfterMs ?? pollInterval(elapsedMs)
  return pollInterval(elapsedMs)
}

// Quotes are refreshed when the user acts on one older than this, never in the
// background: a background refetch re-keys the downstream preflight and would
// demand a re-review for a change the user never saw.
export const BRIDGE_QUOTE_MAX_AGE = 10_000

// `keepPreviousData` is safe here — the route list is comparative information,
// not something the user signs.
export function createBridgeOptionsQueryOptions(
  api: KyInstance,
  request: BridgeRequestIdentity,
  enabled: boolean,
) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amount, fromAddress, walletAddress } = request
  return queryOptions({
    queryKey: depositQueryKeys.bridgeOptions(
      srcChainId,
      srcDenom,
      dstChainId,
      dstDenom,
      amount,
      fromAddress,
      walletAddress,
    ).queryKey,
    queryFn: async (): Promise<BridgeOptionsResponse> => {
      try {
        const response = await api
          .post("v1/bridges/options", { json: toBridgeRequestBody(request) })
          .json<unknown>()
        return parseBridgeOptions(response, request)
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled,
    staleTime: BRIDGE_QUOTE_MAX_AGE,
    // Focus returns from the wallet popup; a refetch then would surprise the
    // user with "Quote updated" for a change they did not ask for.
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
}

// No `keepPreviousData`: this response *is* the transaction to sign, and holding
// the previous identity's quote mid-fetch would present it as executable.
export function createBridgeQuoteQueryOptions(
  api: KyInstance,
  // `depositAddress` is the one the options were issued for: keyed (not sent) so a
  // reissued address fetches a quote bound to it instead of serving the cached one.
  request: BridgeRequestIdentity & { bridge: string; sourceToken: string; depositAddress?: string },
  enabled: boolean,
) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amount, fromAddress, walletAddress } = request
  return queryOptions({
    queryKey: depositQueryKeys.bridgeQuote(
      srcChainId,
      srcDenom,
      dstChainId,
      dstDenom,
      amount,
      fromAddress,
      walletAddress,
      request.bridge,
      request.depositAddress ?? "",
    ).queryKey,
    queryFn: async (): Promise<BridgeQuoteResponse> => {
      try {
        const response = await api
          .post("v1/bridges/quote", { json: toBridgeRequestBody(request) })
          .json<unknown>()
        return parseBridgeQuote(response, request)
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled,
    staleTime: BRIDGE_QUOTE_MAX_AGE,
    refetchOnWindowFocus: false,
  })
}

interface BridgeStatusParams {
  srcChainId: string
  srcTxHash: string
  depositAddress: string
}

// Deliberately without the `bridge` hint: the endpoint answers 502
// `upstream_conflict` for a missing or mismatched hinted tool — including for
// not-found results — turning the normal "not indexed yet" window into a hard
// conflict. Responses are `Cache-Control: no-store`, so the interval is the only
// cadence and `retry` is off.
export function createBridgeStatusQueryOptions(
  api: KyInstance,
  params: BridgeStatusParams,
  enabled: boolean,
  startedAt: number = Date.now(),
) {
  const { srcChainId, srcTxHash, depositAddress } = params
  return queryOptions({
    queryKey: depositQueryKeys.bridgeStatus(srcChainId, srcTxHash, depositAddress).queryKey,
    queryFn: async (): Promise<BridgeStatusResponse> => {
      try {
        const response = await api
          .get("v1/bridges/status", {
            searchParams: {
              src_chain_id: srcChainId,
              src_tx_hash: srcTxHash,
              deposit_address: depositAddress,
            },
          })
          .json<unknown>()
        return parseBridgeStatus(response, { srcChainId, srcTxHash })
      } catch (error) {
        return await classifyBridgeStatusError(error)
      }
    },
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      bridgeStatusPollInterval(query.state.data?.state, query.state.error, Date.now() - startedAt),
  })
}
