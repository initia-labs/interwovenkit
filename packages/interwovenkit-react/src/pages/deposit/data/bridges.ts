import BigNumber from "bignumber.js"
import { isHexString, ZeroAddress } from "ethers"
import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { depositQueryKeys } from "./api"
import { asDepositRecord, pollInterval } from "./deposits"
import {
  assertEchoes,
  assertField,
  caseInsensitive,
  eqAddress,
  expectField,
  isBoolean,
  isDecimalString,
  isEvmTxHash,
  isHexQuantity,
  isIntegerString,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveIntegerString,
  isRecord,
  isString,
  optionalField,
  ParseError,
  sameChainId,
  sameDenom,
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
} from "./types"
import { BRIDGE_STATUS_STATES } from "./types"

const USDC_DECIMALS = 6

type BridgeQuoteRequest = BridgeRequestIdentity & { bridge: string; depositAddress: string }

const isNonZeroAddress = (value: unknown): value is string =>
  isHexString(value, 20) && !eqAddress(value, ZeroAddress)

const isCalldata = (value: unknown): value is string => isHexString(value, true)

const isQuantity = (value: unknown): value is string =>
  isHexQuantity(value) || isIntegerString(value)

const isPositiveQuantity = (value: unknown): value is string =>
  isQuantity(value) && BigInt(value) > 0n

// Unknown duration is not instantaneous and unknown gas is not free, so neither reads as zero.
function parseEstimate(record: Record<string, unknown>, context: string) {
  return {
    execution_duration_seconds: optionalField(
      record,
      "execution_duration_seconds",
      isNonNegativeInteger,
      context,
    ),
    gas_cost_usd: optionalField(record, "gas_cost_usd", isDecimalString, context),
  }
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

export function parseBridgeOptions(response: unknown): BridgeOptionsResponse {
  const context = "Bridge options response"
  assertField(isRecord(response), `${context} is not an object`)

  const seen = new Set<string>()
  return {
    deposit_address: expectField(response, "deposit_address", isNonZeroAddress, context),
    required_min_received: expectField(
      response,
      "required_min_received",
      isPositiveIntegerString,
      context,
    ),
    options: expectField(response, "options", Array.isArray, context).map(
      (option: unknown, index): BridgeOption => {
        const where = `${context} option ${index}`
        assertField(isRecord(option), `${where} is not an object`)
        const bridge = expectField(option, "bridge", isNonEmptyString, where)
        assertField(!seen.has(bridge.toLowerCase()), `${context} repeats the bridge key ${bridge}`)
        seen.add(bridge.toLowerCase())
        return {
          bridge,
          amount_out: expectField(option, "amount_out", isPositiveIntegerString, where),
          min_received: expectField(option, "min_received", isPositiveIntegerString, where),
          eligible: expectField(option, "eligible", isBoolean, where),
          ...parseEstimate(option, where),
          fee_cost_usd: optionalField(option, "fee_cost_usd", isDecimalString, where),
        }
      },
    ),
  }
}

// What a route costs on top of its output: gas plus fees paid as the call's native value.
// Unknown either way is not free, so it never reaches the best.
export function routeCostUsd(option: BridgeOption): BigNumber | undefined {
  if (!option.gas_cost_usd || !option.fee_cost_usd) return undefined
  return BigNumber(option.gas_cost_usd).plus(option.fee_cost_usd)
}

// Every source is USDC, so USD costs net out in USDC base units.
const netValue = (option: BridgeOption) => {
  const cost = routeCostUsd(option)
  return cost
    ? BigNumber(option.amount_out).minus(cost.shiftedBy(USDC_DECIMALS))
    : BigNumber(-Infinity)
}

const COMPETITIVE_VALUE_TOLERANCE = 0.005
const COMPETITIVE_VALUE_FLOOR = BigNumber(0.05).shiftedBy(USDC_DECIMALS)

export function rankBridgeOptions(options: BridgeOption[]): BridgeOption[] {
  const best = BigNumber.max(-Infinity, ...options.filter((o) => o.eligible).map(netValue))
  const floor = BigNumber.min(
    best.times(1 - COMPETITIVE_VALUE_TOLERANCE),
    best.minus(COMPETITIVE_VALUE_FLOOR),
  )
  const tier = (option: BridgeOption) =>
    !option.eligible ? 2 : netValue(option).gte(floor) ? 0 : 1

  const byKey = (a: BridgeOption, b: BridgeOption) =>
    a.bridge < b.bridge ? -1 : a.bridge > b.bridge ? 1 : 0
  const byNet = (a: BridgeOption, b: BridgeOption) => netValue(b).comparedTo(netValue(a)) ?? 0
  const byDuration = (a: BridgeOption, b: BridgeOption) =>
    (a.execution_duration_seconds ?? Infinity) - (b.execution_duration_seconds ?? Infinity)
  const byCost = (a: BridgeOption, b: BridgeOption) =>
    (routeCostUsd(a) ?? BigNumber(Infinity)).comparedTo(routeCostUsd(b) ?? Infinity) ?? 0

  return [...options].sort((a, b) => {
    const byTier = tier(a) - tier(b)
    if (byTier !== 0) return byTier
    if (tier(a) === 0) return byDuration(a, b) || byCost(a, b) || byNet(a, b) || byKey(a, b)
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

function parseApproval(
  value: unknown,
  request: BridgeQuoteRequest,
  context: string,
): BridgeQuoteApproval {
  const where = `${context} approval`
  assertField(isRecord(value), `${where} is missing`)
  assertEchoes(value, where, {
    token_address: [request.srcDenom, sameDenom],
    amount: request.amount,
  })
  return {
    token_address: request.srcDenom,
    spender_address: expectField(value, "spender_address", isNonZeroAddress, where),
    amount: request.amount,
  }
}

function parseTransaction(
  value: unknown,
  request: BridgeQuoteRequest,
  context: string,
): BridgeQuoteTransaction {
  const where = `${context} transaction`
  assertField(isRecord(value), `${where} is not an object`)
  assertEchoes(value, where, {
    chain_id: [request.srcChainId, sameChainId],
    from: [request.fromAddress, caseInsensitive],
  })
  const gasLimit = optionalField(value, "gas_limit", isPositiveQuantity, where)
  return {
    chain_id: request.srcChainId,
    to: expectField(value, "to", isNonZeroAddress, where),
    value: BigInt(expectField(value, "value", isQuantity, where)).toString(),
    data: expectField(value, "data", isCalldata, where),
    ...(gasLimit ? { gas_limit: BigInt(gasLimit).toString() } : {}),
  }
}

// The response is the transaction the user signs, so every field is bound to the retained request.
export function parseBridgeQuote(
  response: unknown,
  request: BridgeQuoteRequest,
): BridgeQuoteResponse {
  const context = "Bridge quote response"
  assertField(isRecord(response), `${context} is not an object`)
  expectField(response, "deposit_address", isNonZeroAddress, context)
  assertEchoes(response, context, {
    provider: "lifi",
    tool: [request.bridge, caseInsensitive],
    src_chain_id: [request.srcChainId, sameChainId],
    src_denom: [request.srcDenom, sameDenom],
    dst_chain_id: request.dstChainId,
    dst_denom: [request.dstDenom, sameDenom],
    amount: request.amount,
    wallet_address: [request.walletAddress, caseInsensitive],
    deposit_address: [request.depositAddress, caseInsensitive],
  })

  return {
    deposit_address: request.depositAddress,
    amount_out: expectField(response, "amount_out", isPositiveIntegerString, context),
    min_received: expectField(response, "min_received", isPositiveIntegerString, context),
    tool: request.bridge,
    estimate: parseEstimate(
      isRecord(response.estimate) ? response.estimate : {},
      `${context} estimate`,
    ),
    approval: parseApproval(response.approval, request, context),
    transaction: parseTransaction(response.transaction, request, context),
  }
}

// What the user reviewed; LI.FI re-encodes calldata and gas on every quote, so both are excluded.
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

const isBridgeStatusState = (value: unknown): value is BridgeStatusState =>
  typeof value === "string" && (BRIDGE_STATUS_STATES as readonly string[]).includes(value)

export function parseBridgeStatus(
  response: unknown,
  expected: { srcChainId: string; srcTxHash: string },
): BridgeStatusResponse {
  const context = "Bridge status response"
  assertField(isRecord(response), `${context} is not an object`)
  assertEchoes(response, context, {
    src_chain_id: [expected.srcChainId, sameChainId],
    src_tx_hash: [expected.srcTxHash, caseInsensitive],
  })
  const state = expectField(response, "state", isBridgeStatusState, context)
  const dstTxHash = optionalField(response, "dst_tx_hash", isEvmTxHash, context)

  return {
    state,
    src_tx_link: isString(response.src_tx_link) ? response.src_tx_link : "",
    ...(dstTxHash ? { dst_tx_hash: dstTxHash } : {}),
    ...(isNonEmptyString(response.dst_tx_link) ? { dst_tx_link: response.dst_tx_link } : {}),
    deposit:
      state === "deposit_indexed" ? asDepositRecord(response.deposit, `${context} deposit`) : null,
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

// No focus refetch: returning from the wallet popup must not force a re-review.
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
    parse: parseBridgeOptions,
    enabled,
    keepPrevious: true,
  })
}

// Only a failed quote is refetched on a timer: a changed successful quote would demand a re-review.
const bridgeQuoteRefetchInterval = (query: { state: { status: string } }) =>
  query.state.status === "error" ? BRIDGE_QUOTE_MAX_AGE : false

// No `keepPreviousData`: a held quote from the previous identity would read as executable.
export function createBridgeQuoteQueryOptions(
  api: KyInstance,
  request: BridgeRequestIdentity & { bridge: string; depositAddress?: string },
  enabled: boolean,
) {
  const { bridge, depositAddress = "", ...identity } = request
  return {
    ...createBridgeQueryOptions({
      api,
      path: "v1/bridges/quote",
      queryKey: depositQueryKeys.bridgeQuote(identity, bridge, depositAddress).queryKey,
      request,
      parse: (response): BridgeQuoteResponse =>
        parseBridgeQuote(response, { ...request, depositAddress }),
      enabled,
    }),
    refetchInterval: bridgeQuoteRefetchInterval,
  }
}

interface BridgeStatusParams {
  srcChainId: string
  srcTxHash: string
  depositAddress: string
}

// The refetch interval is the only cadence, so neither ky nor TanStack retries.
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
      let response: unknown
      try {
        response = await api
          .get("v1/bridges/status", {
            searchParams: {
              src_chain_id: srcChainId,
              src_tx_hash: srcTxHash,
              deposit_address: depositAddress,
            },
            retry: 0,
          })
          .json<unknown>()
      } catch (error) {
        return await classifyBridgeStatusError(error)
      }
      return parseBridgeStatus(response, { srcChainId, srcTxHash })
    },
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      bridgeStatusPollInterval(query.state.data?.state, query.state.error, Date.now() - startedAt),
  })
}
