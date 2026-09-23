import BigNumber from "bignumber.js"
import { isHexString, ZeroAddress } from "ethers"
import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { USDC_DECIMALS } from "@/data/constants"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { depositQueryKeys } from "./api"
import { normalizeDenom } from "./assetOptions"
import { pollInterval } from "./deposits"
import {
  assertField,
  eqAddress,
  isBoolean,
  isDecimalString,
  isEvmTxHash,
  isHexQuantity,
  isIntegerString,
  isNonEmptyString,
  isPositiveIntegerString,
  isRecord,
  isString,
  ParseError,
} from "./parse"
import type {
  BridgeOption,
  BridgeOptionsResponse,
  BridgeQuoteApproval,
  BridgeQuoteResponse,
  BridgeQuoteTransaction,
  BridgeRequestIdentity,
  BridgeStatusResponse,
  BridgeStatusState,
  Deposit,
} from "./types"
import { BRIDGE_STATUS_STATES } from "./types"

const isNonZeroAddress = (value: unknown): value is string =>
  isHexString(value, 20) && !eqAddress(value, ZeroAddress)

// Unknown duration is not instantaneous and unknown gas is not free, so both stay undefined and
// sort last.
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

export function parseBridgeOptions(
  response: unknown,
  request: BridgeRequestIdentity,
): BridgeOptionsResponse {
  const context = `Bridge options response (${describeRequest(request)})`
  assertField(isRecord(response), `${context} is not an object`)

  const { deposit_address, required_min_received, options } = response
  assertField(
    isNonZeroAddress(deposit_address),
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

const knownGasCost = (option: BridgeOption): BigNumber | undefined =>
  option.gas_cost_usd ? BigNumber(option.gas_cost_usd) : undefined

function netValue(option: BridgeOption): BigNumber | undefined {
  const gas = knownGasCost(option)
  // Every source is USDC, so USD gas nets out in USDC base units.
  return gas && BigNumber(option.amount_out).minus(gas.shiftedBy(USDC_DECIMALS))
}

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

const COMPETITIVE_VALUE_TOLERANCE = 0.005
const COMPETITIVE_VALUE_FLOOR_USD = 0.05

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

// Eligible first; routes within 0.5% or five cents of the best net value order by speed, the rest by
// value.
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
  const byNet = (a: BridgeOption, b: BridgeOption) =>
    compareUnknownLast(nets.get(a.bridge), nets.get(b.bridge), (x, y) => y.comparedTo(x) ?? 0)
  const byDuration = (a: BridgeOption, b: BridgeOption) =>
    compareUnknownLast(a.execution_duration_seconds, b.execution_duration_seconds, (x, y) => x - y)
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

export function percentDifference(value: string | undefined, best: string | undefined): string {
  if (!value || !best || !isIntegerString(value) || !isIntegerString(best)) return ""
  if (BigNumber(best).lte(0)) return ""
  const percent = BigNumber(value).minus(best).div(best).times(100)
  if (percent.abs().lt(0.01)) return ""
  return `${percent.gt(0) ? "+" : ""}${percent.toFixed(2)}%`
}

// Every source is an ERC-20: without an allowance for exactly that token the call reverts after the
// user paid gas.
function parseApproval(
  value: unknown,
  request: BridgeRequestIdentity,
  context: string,
): BridgeQuoteApproval {
  assertField(isRecord(value), `${context} is missing the ERC-20 approval`)
  const { token_address, spender_address, amount } = value
  assertField(
    isString(token_address) && normalizeDenom(token_address) === normalizeDenom(request.srcDenom),
    `${context} approval token_address mismatch: ${String(token_address)}`,
  )
  assertField(
    isNonZeroAddress(spender_address),
    `${context} approval spender_address is invalid: ${String(spender_address)}`,
  )
  assertField(
    isPositiveIntegerString(amount) && amount === request.amount,
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
  const { chain_id, from, to, data, value: nativeValue, gas_limit } = value

  assertField(
    String(chain_id) === request.srcChainId,
    `${context} transaction chain_id mismatch: ${String(chain_id)}`,
  )
  assertField(
    isString(from) && eqAddress(from, request.fromAddress),
    `${context} transaction from mismatch: ${String(from)}`,
  )
  assertField(
    isNonZeroAddress(to),
    `${context} transaction has an invalid to address: ${String(to)}`,
  )
  assertField(isHexString(data, true), `${context} transaction has non-hex calldata`)
  assertField(
    isHexQuantity(nativeValue) || isIntegerString(nativeValue),
    `${context} transaction has an invalid value: ${String(nativeValue)}`,
  )
  const normalizedValue = isHexQuantity(nativeValue) ? BigInt(nativeValue).toString() : nativeValue

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
  }
}

// The response is the transaction the user signs, so every field is bound to the retained request.
export function parseBridgeQuote(
  response: unknown,
  request: BridgeRequestIdentity & { bridge: string },
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
  assertField(amount === request.amount, `${context} amount mismatch: ${String(amount)}`)
  assertField(
    isString(wallet_address) && eqAddress(wallet_address, request.walletAddress),
    `${context} wallet_address mismatch: ${String(wallet_address)}`,
  )
  assertField(
    isString(tool) && tool.toLowerCase() === request.bridge.toLowerCase(),
    `${context} tool mismatch: ${String(tool)} (selected ${request.bridge})`,
  )
  assertField(
    isNonZeroAddress(deposit_address),
    `${context} has an invalid deposit address: ${String(deposit_address)}`,
  )
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

// What the user reviewed; calldata and gas are excluded because LI.FI re-encodes both on every
// quote.
export function bridgeQuoteSignature(quote: BridgeQuoteResponse): string {
  const { transaction, approval } = quote
  return JSON.stringify([
    quote.tool.toLowerCase(),
    transaction.chain_id,
    transaction.to.toLowerCase(),
    transaction.value,
    approval.token_address.toLowerCase(),
    approval.spender_address.toLowerCase(),
    approval.amount,
    quote.amount_out,
    quote.min_received,
    quote.deposit_address.toLowerCase(),
  ])
}

// Below either minimum the USDC is stranded at the deposit address with no refund, so this fails
// closed.
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

export function parseBridgeStatus(
  response: unknown,
  expected: { srcChainId: string; srcTxHash: string },
): BridgeStatusResponse {
  const context = "Bridge status response"
  assertField(isRecord(response), `${context} is not an object`)

  const { state, src_chain_id, src_tx_hash, src_tx_link, dst_tx_hash, deposit } = response
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
    src_tx_link: isString(src_tx_link) ? src_tx_link : "",
    ...(dstTxHash ? { dst_tx_hash: dstTxHash } : {}),
    ...(isNonEmptyString(response.dst_tx_link) ? { dst_tx_link: response.dst_tx_link } : {}),
    deposit: state === "deposit_indexed" ? asDepositRecord(deposit, context) : null,
  }
}

export class BridgeStatusError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "BridgeStatusError"
  }
}

// This endpoint answers `{ error, message }` instead of the API-wide `{ message }`.
export async function classifyBridgeStatusError(error: unknown): Promise<never> {
  if (error instanceof HTTPError) {
    // Cloned so normalizeError below can still read the body.
    const body: unknown = await error.response
      .clone()
      .json()
      .catch(() => undefined)
    if (isRecord(body) && isNonEmptyString(body.error)) {
      const message = isNonEmptyString(body.message) ? body.message : body.error
      throw new BridgeStatusError(body.error, message)
    }
  }
  throw await normalizeError(error)
}

const BRIDGE_STATUS_STOP_ERROR_CODES = ["upstream_conflict", "invalid_request"]

const BRIDGE_STATUS_STOP_STATES: readonly BridgeStatusState[] = [
  "deposit_indexed",
  "bridge_partial",
  "bridge_refunded",
  "bridge_refund_required",
  "bridge_failed",
]

// `false` never means the transfer failed: the session keeps its hashes for manual refresh.
export function bridgeStatusPollInterval(
  state: BridgeStatusState | undefined,
  error: Error | null,
  elapsedMs: number,
): number | false {
  if (error instanceof BridgeStatusError && BRIDGE_STATUS_STOP_ERROR_CODES.includes(error.code)) {
    return false
  }
  if (state && BRIDGE_STATUS_STOP_STATES.includes(state)) return false
  return pollInterval(elapsedMs)
}

export const BRIDGE_QUOTE_MAX_AGE = STALE_TIMES.SECOND * 10

// Never refetched in the background: focus returns from the wallet popup, and a change there would
// demand a re-review.
function createBridgeQueryOptions<T>(config: {
  api: KyInstance
  path: string
  queryKey: readonly unknown[]
  request: BridgeRequestIdentity & { bridge?: string }
  parse: (response: unknown) => T
  enabled: boolean
  keepPrevious?: boolean
}) {
  const { api, path, queryKey, request, parse, enabled, keepPrevious } = config
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<T> => {
      let response: unknown
      try {
        response = await api.post(path, { json: toBridgeRequestBody(request) }).json<unknown>()
      } catch (error) {
        throw await normalizeError(error)
      }
      return parse(response)
    },
    enabled,
    staleTime: BRIDGE_QUOTE_MAX_AGE,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => !(error instanceof ParseError) && failureCount < 3,
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  })
}

export function createBridgeOptionsQueryOptions(
  api: KyInstance,
  identity: BridgeRequestIdentity,
  enabled: boolean,
) {
  return createBridgeQueryOptions({
    api,
    path: "v1/bridges/options",
    queryKey: depositQueryKeys.bridgeOptions(identity).queryKey,
    request: identity,
    parse: (response): BridgeOptionsResponse => parseBridgeOptions(response, identity),
    enabled,
    keepPrevious: true,
  })
}

// No `keepPreviousData`: holding the previous identity's quote mid-fetch would present it as
// executable.
export function createBridgeQuoteQueryOptions(
  api: KyInstance,
  // `depositAddress` is keyed, not sent, so a reissued address fetches a quote bound to it.
  request: BridgeRequestIdentity & { bridge: string; depositAddress?: string },
  enabled: boolean,
) {
  const { bridge, depositAddress = "", ...identity } = request
  return createBridgeQueryOptions({
    api,
    path: "v1/bridges/quote",
    queryKey: depositQueryKeys.bridgeQuote(identity, bridge, depositAddress).queryKey,
    request,
    parse: (response): BridgeQuoteResponse => parseBridgeQuote(response, request),
    enabled,
  })
}

interface BridgeStatusParams {
  srcChainId: string
  srcTxHash: string
  depositAddress: string
}

// Without the `bridge` hint: a missing or mismatched hint answers 502 upstream_conflict even for
// not-found results. The refetch interval is the only cadence, so neither ky nor TanStack retries.
export function createBridgeStatusQueryOptions(
  api: KyInstance,
  params: BridgeStatusParams,
  enabled: boolean,
  startedAt: number,
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
            retry: 0,
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
