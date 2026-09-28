import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { normalizeError, normalizeErrorMessage, STALE_TIMES } from "@/data/http"
import { depositQueryKeys } from "./api"
import { assertField, expectField, isPositiveIntegerString, isRecord } from "./parse"
import type { QuoteDelivery, QuoteResponse } from "./types"

export const QUOTE_STALE_TIME = STALE_TIMES.SECOND * 30

// A 400 is the endpoint's deliberate refusal to quote this request (route paused, or below the
// live minimum): a signal the form gates on, not the error channel.
export type QuoteResult =
  | { status: "quoted"; quote: QuoteResponse }
  | { status: "declined"; reason: string }

interface QuoteParams {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  amountIn: string
}

export async function classifyQuoteFailure(error: unknown): Promise<QuoteResult> {
  if (error instanceof HTTPError && error.response.status === 400) {
    return { status: "declined", reason: await normalizeErrorMessage(error) }
  }
  throw await normalizeError(error)
}

// Display-only: a malformed prediction is dropped rather than allowed to block a send.
export function parseQuoteDelivery(delivery: unknown): QuoteDelivery | undefined {
  if (!isRecord(delivery) || typeof delivery.method !== "string" || !delivery.method)
    return undefined
  const seconds = delivery.estimated_seconds
  return {
    method: delivery.method,
    estimated_seconds: typeof seconds === "number" && seconds >= 0 ? seconds : null,
  }
}

// The preflight gates a send with no refund below the minimum, so an unreadable 200 isn't a quote.
export function parseQuoteResponse(response: unknown): QuoteResponse {
  assertField(isRecord(response), "Quote response is not an object")
  return {
    amount_out: expectField(response, "amount_out", isPositiveIntegerString, "Quote response"),
    min_received: expectField(response, "min_received", isPositiveIntegerString, "Quote response"),
    delivery: parseQuoteDelivery(response.delivery),
  }
}

// Placeholder data is the previous amount's result, never a verdict for the current one. ky's GET
// retries are the only retry layer.
export function createQuoteQueryOptions(api: KyInstance, params: QuoteParams, enabled: boolean) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amountIn } = params
  return queryOptions({
    queryKey: depositQueryKeys.minReceived(srcChainId, srcDenom, dstChainId, dstDenom, amountIn)
      .queryKey,
    queryFn: async (): Promise<QuoteResult> => {
      let response: unknown
      try {
        response = await api
          .get("v1/quote", {
            searchParams: {
              src_chain_id: srcChainId,
              src_denom: srcDenom,
              dst_chain_id: dstChainId,
              dst_denom: dstDenom,
              amount_in: amountIn,
            },
          })
          .json()
      } catch (error) {
        return await classifyQuoteFailure(error)
      }
      return { status: "quoted", quote: parseQuoteResponse(response) }
    },
    enabled,
    staleTime: QUOTE_STALE_TIME,
    refetchInterval: QUOTE_STALE_TIME,
    retry: false,
    placeholderData: keepPreviousData,
  })
}
