import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { normalizeError, normalizeErrorMessage, STALE_TIMES } from "@/data/http"
import { depositQueryKeys } from "./api"
import type { QuoteResponse } from "./types"

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

// Consumers must pair `keepPreviousData` with deriveSettlement so a held result never reads as a
// verdict for the current amount.
export function createQuoteQueryOptions(api: KyInstance, params: QuoteParams, enabled: boolean) {
  const { srcChainId, srcDenom, dstChainId, dstDenom, amountIn } = params
  return queryOptions({
    queryKey: depositQueryKeys.minReceived(srcChainId, srcDenom, dstChainId, dstDenom, amountIn)
      .queryKey,
    queryFn: async (): Promise<QuoteResult> => {
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
    },
    enabled,
    staleTime: QUOTE_STALE_TIME,
    refetchInterval: QUOTE_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
