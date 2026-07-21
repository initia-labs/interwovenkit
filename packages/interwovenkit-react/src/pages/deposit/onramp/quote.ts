import { useWatch } from "react-hook-form"
import { useDebounceValue } from "usehooks-ts"
import { formatNumber } from "@initia/utils"
import { formatSourceMin } from "../data/source"
import type { Asset } from "../data/types"
import { useDepositForm } from "../context"
import {
  useFiatDisplayCode,
  useOnramperFiat,
  useOnramperPaymentTypes,
  useOnramperQuotes,
  useOnramperSourceRoute,
} from "./data/onramper"
import {
  fiatLimitError,
  findAggregatedLimit,
  isBelowRouteMinimum,
  quotesErrorMessage,
  type RankedQuote,
  rankQuotes,
  selectRankedQuote,
  totalQuoteFee,
} from "./data/onramperLogic"
import type { OnramperCrypto, OnramperQuote } from "./data/onramperTypes"

/**
 * Live cash-path quote as a discriminated union: exactly one variant, so the
 * mutually exclusive states can't coexist and consumers switch on `status`
 * exhaustively instead of prioritizing overlapping flags. `sourceCryptoId` (the
 * Onramper crypto id resolved from the destination; "" when unmapped) is common
 * to every variant because the payment-types lookup needs it regardless.
 */
export type OnrampQuote = { sourceCryptoId: string } &
  // The destination has no Onramper-purchasable source asset (cannot quote).
  (| { status: "unsupported" }
    // No positive fiat amount entered yet.
    | { status: "idle" }
    // The amount is outside the selected payment type's aggregated fiat bounds;
    // while in this state no quotes request is made. `message` is actionable.
    | { status: "limit-error"; message: string }
    // Quotes are being fetched (or the request is gated) and none are cached yet.
    | { status: "loading" }
    // The quotes request failed with nothing cached — an outage/rate limit, not
    // "no provider made an offer" — so it reads as its own state, not a
    // misleading "no quote available".
    | { status: "error"; message: string }
    // Amount entered and source mapped, but no provider returned an offer.
    // `reason` is a provider's amount-range guidance, else widget copy for the
    // failure class (see quotesErrorMessage). Always non-empty.
    | { status: "no-offers"; reason: string }
    | {
        status: "quoted"
        /** All provider offers, best payout first. */
        ranked: RankedQuote[]
        /** The chosen provider's offer (selected ramp, else best). */
        selected: RankedQuote
        /** The selected offer's payout is below the deposit route's bridge minimum;
         * such a purchase would clear payment but die at the bridge (no refund). */
        belowRouteMinimum: boolean
        /** Bridge minimum in source token units (e.g. "5 ETH"). */
        routeMinimumLabel: string
        /** Formatted crypto received (payout) for the selected offer. */
        receiveAmount: string
        /** "1 {receiveSymbol} ≈ {rate} {FIAT}". */
        estimatedPriceLabel: string
        /** Total provider + network fee in fiat. */
        feeLabel: string
      }
  )

const RECEIVE_DP = 6
const FIAT_DP = 2

export interface DeriveOnrampQuoteParams {
  sourceCryptoId: string
  /** The deposit route and its Onramper source crypto; null when unmapped. */
  sourceRoute: { route: Asset; crypto: OnramperCrypto } | null
  fiatAmount: string
  /** Pre-quote fiat-limit validation message ("" when within bounds). */
  limitError: string
  /** The quotes query state, decomposed so this stays a pure function. */
  quotes: { isError: boolean; data: OnramperQuote[] | undefined; errorMessage: string }
  providerId: string
  receiveSymbol: string
  /** Fiat display code for labels, e.g. "USD". */
  fiat: string
}

/**
 * Derives exactly one OnrampQuote variant, ordered from the broadest gate
 * inward: unsupported → idle → limit-error → error → loading → no-offers →
 * quoted. Each check returns, so the variants stay mutually exclusive by
 * construction. Pure so the gate ordering is testable without the hooks.
 */
export function deriveOnrampQuote({
  sourceCryptoId,
  sourceRoute,
  fiatAmount,
  limitError,
  quotes,
  providerId,
  receiveSymbol,
  fiat,
}: DeriveOnrampQuoteParams): OnrampQuote {
  if (!sourceRoute) return { sourceCryptoId, status: "unsupported" }
  if (!(Number(fiatAmount) > 0)) return { sourceCryptoId, status: "idle" }
  if (limitError) return { sourceCryptoId, status: "limit-error", message: limitError }

  // A failed fetch with stale data still renders the cached quotes below: they
  // refresh every 30s, and blanking a workable form on a transient refetch
  // failure would be worse. Only a failure with nothing cached is an error.
  if (quotes.isError && !quotes.data)
    return { sourceCryptoId, status: "error", message: quotes.errorMessage }
  if (!quotes.data) return { sourceCryptoId, status: "loading" }

  const ranked = rankQuotes(quotes.data)
  const selected = selectRankedQuote(ranked, providerId)
  if (!selected)
    return { sourceCryptoId, status: "no-offers", reason: quotesErrorMessage(quotes.data) }

  // Bridge-minimum gate on the payout Onramper would deliver: Onramper's fiat
  // floor alone can pass a purchase the bridge rejects as below_minimum (funds
  // stranded, no refund), so this must block submission (see isBelowRouteMinimum).
  const belowRouteMinimum = isBelowRouteMinimum(selected.payout, sourceRoute.route)
  const routeMinimumLabel = formatSourceMin(
    sourceRoute.route.min_deposit_amount,
    sourceRoute.route.src_decimals,
    sourceRoute.crypto.code,
  )
  const fee = totalQuoteFee(selected.quote)

  return {
    sourceCryptoId,
    status: "quoted",
    ranked,
    selected,
    belowRouteMinimum,
    routeMinimumLabel,
    receiveAmount: formatNumber(String(selected.payout), { dp: RECEIVE_DP }),
    estimatedPriceLabel: `1 ${receiveSymbol} ≈ ${formatNumber(String(selected.quote.rate), { dp: FIAT_DP })} ${fiat}`,
    feeLabel: `${formatNumber(String(fee), { dp: FIAT_DP })} ${fiat}`,
  }
}

/**
 * Live cash-path quote derived from the form state. Resolves the destination's
 * Onramper source asset, fetches provider quotes for the entered fiat amount,
 * and ranks them, returning exactly one OnrampQuote variant. The displayed
 * receive amount is the provider payout (the source asset Onramper delivers to
 * the deposit address); the destination is near 1:1, so it is shown against
 * the destination symbol.
 */
export function useOnrampQuote(): OnrampQuote {
  const { control } = useDepositForm()
  const [
    fiatId,
    fiatAmount,
    receiveSymbol,
    receiveDenom,
    receiveChainId,
    paymentMethodId,
    providerId,
  ] = useWatch({
    control,
    name: [
      "fiatId",
      "fiatAmount",
      "receiveSymbol",
      "receiveDenom",
      "receiveChainId",
      "paymentMethodId",
      "providerId",
    ],
  })

  const sourceRoute = useOnramperSourceRoute(receiveChainId, receiveDenom)
  const sourceCrypto = sourceRoute?.crypto ?? null

  // Pre-quote validation: an amount outside the selected payment type's
  // aggregated fiat bounds is known to fail, so it never reaches `/quotes`
  // (instant feedback, no wasted call).
  const fiatEntry = useOnramperFiat(fiatId)
  const paymentTypes = useOnramperPaymentTypes(fiatId, sourceCrypto?.id ?? "")
  const aggregatedLimit = findAggregatedLimit(paymentTypes.data ?? [], paymentMethodId)
  const paymentMethodName = paymentTypes.data?.find(
    (method) => method.paymentTypeId === paymentMethodId,
  )?.name
  const limitError = fiatLimitError(
    fiatAmount,
    aggregatedLimit,
    fiatEntry?.symbol ?? "",
    paymentMethodName,
  )

  // Only the quotes query sees the debounced amount (it joins the query key —
  // see useOnramperQuotes); display and validation stay on the typed value.
  // Trade-off: for one debounce interval after an edit, the previous amount's
  // quote stays shown and submittable (as in the bridge form); the processing
  // screen re-quotes the final amount, so such a submit self-heals.
  const [debouncedFiatAmount] = useDebounceValue(fiatAmount, 300)
  // Re-derived from the debounced amount: the typed-value `limitError` clears
  // before the debounced amount catches up, leaking an out-of-range request.
  const debouncedLimitError = fiatLimitError(
    debouncedFiatAmount,
    aggregatedLimit,
    fiatEntry?.symbol ?? "",
    paymentMethodName,
  )

  const quotesQuery = useOnramperQuotes({
    fiat: fiatId,
    crypto: sourceCrypto?.id ?? "",
    amount: debouncedLimitError ? "" : debouncedFiatAmount,
    paymentMethod: paymentMethodId,
  })

  const fiat = useFiatDisplayCode(fiatId)
  const sourceCryptoId = sourceCrypto?.id ?? ""

  return deriveOnrampQuote({
    sourceCryptoId,
    sourceRoute,
    fiatAmount,
    limitError,
    quotes: {
      isError: quotesQuery.isError,
      data: quotesQuery.data,
      errorMessage: quotesQuery.error?.message ?? "",
    },
    providerId,
    receiveSymbol,
    fiat,
  })
}
