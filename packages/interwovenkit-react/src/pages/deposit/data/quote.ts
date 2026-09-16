import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { normalizeError, normalizeErrorMessage, STALE_TIMES } from "@/data/http"
import { depositQueryKeys } from "./api"
import type { QuoteResponse } from "./types"

// Matches the Onramper quotes cadence so the route estimate refreshes in step
// with the payout it is derived from.
export const QUOTE_STALE_TIME = STALE_TIMES.SECOND * 30

// A 400 is the endpoint's deliberate refusal to quote this request (route
// unconfigured or paused, or the amount below the backend's live
// `min_deposit_amount`) — a signal the form gates on, not the error channel.
export type QuoteResult =
  | { status: "quoted"; quote: QuoteResponse }
  | { status: "declined"; reason: string }

export interface QuoteParams {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  /** Positive integer source base units. */
  amountIn: string
}

export async function classifyQuoteFailure(error: unknown): Promise<QuoteResult> {
  if (error instanceof HTTPError && error.response.status === 400) {
    return { status: "declined", reason: await normalizeErrorMessage(error) }
  }
  throw await normalizeError(error)
}

// The backend runs the same route request bridge planning uses and applies its
// own route-policy slippage, so the estimate cannot drift from the bridge's
// routing. Shared by the cash row and the wallet path's Ethereum preflight.
export async function fetchQuote(api: KyInstance, params: QuoteParams): Promise<QuoteResult> {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amountIn } = params
  try {
    const quote = await api
      .get("v1/quote", {
        searchParams: {
          src_chain_id: srcChainId,
          src_denom: srcDenom,
          dst_chain_id: dstChainId,
          dst_denom: dstDenom,
          amount_in: amountIn,
        },
      })
      .json<QuoteResponse>()
    return { status: "quoted", quote }
  } catch (error) {
    return await classifyQuoteFailure(error)
  }
}

// `keepPreviousData` prevents the estimate flashing its placeholder on every
// keystroke; consumers must pair it with a settlement gate (deriveSettlement) so
// a held previous result never reads as a verdict for the current amount.
export function createQuoteQueryOptions(api: KyInstance, params: QuoteParams, enabled: boolean) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amountIn } = params
  return queryOptions({
    // `params` is already in the key field by field, and `api` is the host's
    // single Deposit API client (one prefixUrl per app), so it cannot vary
    // behind a stable key.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: depositQueryKeys.minReceived(srcChainId, srcDenom, dstChainId, dstDenom, amountIn)
      .queryKey,
    queryFn: () => fetchQuote(api, params),
    enabled,
    staleTime: QUOTE_STALE_TIME,
    refetchInterval: QUOTE_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
