import BigNumber from "bignumber.js"
import { HTTPError } from "ky"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { formatNumber, fromBaseUnit, toBaseUnit } from "@initia/utils"
import { useConfig } from "@/data/config"
import { normalizeError, normalizeErrorMessage, STALE_TIMES } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "../../data/api"
import { findDestinationNetwork } from "../../data/source"
import type { QuoteResponse } from "../../data/types"
import { useOnramperSourceRoute } from "./onramper"

// Matches the Onramper quotes cadence (QUOTE_STALE_TIME) so the route estimate
// refreshes in step with the payout it is derived from.
const ROUTE_QUOTE_STALE_TIME = STALE_TIMES.SECOND * 30

// The pre-quote outcome kept as query data, not query error: a 400 is the
// endpoint's deliberate refusal to quote this request (route unconfigured or
// paused, or payout below the backend's live `min_deposit_amount`) — a signal
// the form must gate on, not the error channel transient failures flow through.
type QuoteResult =
  | { status: "quoted"; quote: QuoteResponse }
  | { status: "declined"; reason: string }

export interface MinReceived {
  /** Formatted token-unit string; "" when unavailable (the row shows its "—" placeholder). */
  value: string
  /**
   * The backend refused to quote this payout (HTTP 400). The client-side
   * bridge-minimum gate reads a `config/assets` snapshot that can lag the
   * backend's live minimum; when they drift, this is the last gate before a
   * no-refund purchase the bridge would strand. Only reported once the current
   * payout's verdict is settled (see composeMinReceived), so `isDeclined` and
   * `isFailed` are mutually exclusive.
   */
  isDeclined: boolean
  /** The backend's own decline message ("" when it sent none); preferred over generic footer copy. */
  declineReason: string
  /**
   * The backend's verdict for the current payout is known. False in two windows:
   * the first fetch, and while keepPreviousData serves the previous amount's
   * result mid-fetch. In both, `value` may still show the previous estimate
   * (flash prevention) but the verdict is unknown, so submission stays blocked
   * (fail closed for a no-refund purchase). True when the pre-quote is disabled
   * (no payout or route): nothing to settle, and other gates own those states.
   */
  isSettled: boolean
  /**
   * The current payout's pre-quote is failing through the transient channel
   * (5xx, network) with no settled verdict to fall back on. Submission stays
   * blocked either way, but the form presents this as a failure, not an
   * indefinite "Getting quote…". The query keeps refetching, so it heals once
   * the endpoint recovers.
   */
  isFailed: boolean
}

/**
 * Derives the settlement flags from the query state, pure so the gate is
 * testable without the hook. Settled only once this amount's result is in: a
 * first fetch has no result, and keepPreviousData serves the previous amount's
 * result (isPlaceholderData) mid-fetch. A disabled query settles vacuously
 * (nothing resolves; other gates own those states). An unsettled query in error
 * is a failure (retries exhausted); a settled one is not — a failed background
 * refresh still leaves a usable verdict.
 */
export function deriveSettlement(params: {
  enabled: boolean
  hasData: boolean
  isPlaceholderData: boolean
  isError: boolean
}): Pick<MinReceived, "isSettled" | "isFailed"> {
  const isSettled = !params.enabled || (params.hasData && !params.isPlaceholderData)
  return { isSettled, isFailed: !isSettled && params.isError }
}

/**
 * Classifies a pre-quote failure. A 400 is the endpoint's contract for refusing
 * to quote this request (see QuoteResult): a deliberate outcome, promoted to
 * data with the backend's message kept for the footer, not flowed through the
 * error channel transient failures use. Any other status is treated as transient.
 */
export async function classifyQuoteFailure(error: unknown): Promise<QuoteResult> {
  if (error instanceof HTTPError && error.response.status === 400) {
    return { status: "declined", reason: await normalizeErrorMessage(error) }
  }
  throw await normalizeError(error)
}

/**
 * Maps the pre-quote result to the row value and declined flag. Invariants:
 * without a live payout everything resets (despite keepPreviousData) so the row
 * falls back to its placeholder with the other quote-driven rows; a decline
 * carries the backend's reason; a zero or unparseable `min_received` shows the
 * "—" placeholder ("unknown"), never a guaranteed minimum of 0.
 */
export function selectMinReceived(
  data: QuoteResult | undefined,
  decimals: number | undefined,
  amountIn: string,
): Pick<MinReceived, "value" | "isDeclined" | "declineReason"> {
  if (!amountIn || !data || decimals === undefined) {
    return { value: "", isDeclined: false, declineReason: "" }
  }
  if (data.status === "declined") {
    return { value: "", isDeclined: true, declineReason: data.reason }
  }
  const value = fromBaseUnit(data.quote.min_received, { decimals })
  return {
    value: value && BigNumber(value).gt(0) ? formatNumber(value, { dp: 6 }) : "",
    isDeclined: false,
    declineReason: "",
  }
}

/**
 * Composes the row selection with the settlement gate. Under keepPreviousData the
 * query can hold the previous amount's result mid-fetch, so an unsettled verdict
 * suppresses the stale decline — the footer must diagnose the current amount, not
 * the last. The stale `value` survives a normal refetch (flash prevention) but is
 * dropped on a failure, where it would caption the failure notice with a
 * live-looking minimum for an amount the backend never quoted.
 */
export function composeMinReceived(
  selected: Pick<MinReceived, "value" | "isDeclined" | "declineReason">,
  settlement: Pick<MinReceived, "isSettled" | "isFailed">,
): MinReceived {
  return {
    value: settlement.isFailed ? "" : selected.value,
    isDeclined: settlement.isSettled && selected.isDeclined,
    declineReason: settlement.isSettled ? selected.declineReason : "",
    ...settlement,
  }
}

/**
 * The "Minimum received" value for the Buy form. Queries the backend's pre-quote
 * (GET /v1/quote) with `amount_in` = the Onramper payout; the backend runs the
 * same route request bridge planning uses and applies its own route-policy
 * slippage, so the estimate can't drift from the bridge's routing (market
 * movement between quote and execution still applies).
 *
 * The row is informational and the bridge re-quotes at detection time, so a
 * transient failure (5xx, network) leaves the value empty (the "—" placeholder)
 * rather than throwing to the AsyncBoundary. A 400 is the endpoint refusing this
 * exact request and surfaces as `isDeclined` for the form to gate submission on.
 */
export function useMinReceived(
  payout: number | undefined,
  chainId: string,
  denom: string,
): MinReceived {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const sourceRoute = useOnramperSourceRoute(chainId, denom)
  const route = sourceRoute?.route
  const network = route ? findDestinationNetwork(route, chainId, denom) : undefined

  // The payout arrives in source token units; the quote endpoint wants integer
  // base units, so floor away any sub-base-unit dust from the provider's number.
  const amountIn =
    route && payout && payout > 0
      ? BigNumber(toBaseUnit(String(payout), { decimals: route.src_decimals }) || 0)
          .integerValue(BigNumber.ROUND_DOWN)
          .toString()
      : ""

  const enabled = !!depositApiUrl && !!route && !!network && !!amountIn && BigNumber(amountIn).gt(0)

  const { data, isPlaceholderData, isError } = useQuery({
    queryKey: depositQueryKeys.minReceived(
      route?.src_chain_id ?? "",
      route?.src_denom ?? "",
      chainId,
      denom,
      amountIn,
    ).queryKey,
    queryFn: async (): Promise<QuoteResult> => {
      try {
        const quote = await api
          .get("v1/quote", {
            searchParams: {
              src_chain_id: route?.src_chain_id ?? "",
              src_denom: route?.src_denom ?? "",
              dst_chain_id: chainId,
              dst_denom: denom,
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
    staleTime: ROUTE_QUOTE_STALE_TIME,
    refetchInterval: ROUTE_QUOTE_STALE_TIME,
    // Keep the previous estimate on screen while the amount changes, so the
    // row doesn't flash its placeholder on every quote refresh.
    placeholderData: keepPreviousData,
  })

  // A persistent quote outage keeps isSettled false and the form blocked (fail
  // closed for a no-refund purchase); isFailed additionally surfaces it as a
  // failure rather than endless loading (see deriveSettlement).
  const settlement = deriveSettlement({ enabled, hasData: !!data, isPlaceholderData, isError })

  return composeMinReceived(selectMinReceived(data, network?.decimals, amountIn), settlement)
}
