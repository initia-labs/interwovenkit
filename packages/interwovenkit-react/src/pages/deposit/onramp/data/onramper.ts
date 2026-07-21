import type { KyInstance } from "ky"
import { useEffect, useMemo } from "react"
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { depositQueryKeys, useDepositApi, useOnramper, useOnramperEnabled } from "../../data/api"
import { useDepositRoutes } from "../../data/assets"
import type { Asset } from "../../data/types"
import {
  assertCheckoutUrl,
  assertOnramperSupported,
  filterSupportedPaymentTypes,
  isApplePayOnlyHidden,
  logSuppressedQuoteErrors,
  matchOnramperCrypto,
  supportsApplePay,
} from "./onramperLogic"
import type {
  OnramperCheckoutResult,
  OnramperCrypto,
  OnramperGeoDefaults,
  OnramperOnrampMetadata,
  OnramperOnrampsResponse,
  OnramperPaymentType,
  OnramperPaymentTypesResponse,
  OnramperQuote,
  OnramperSupported,
} from "./onramperTypes"

// Onramper API reference index (LLM-friendly): https://docs.onramper.com/llms.txt

/**
 * GET /supported. Fiat and crypto lists for the cash path, fetched together
 * (one call feeds both the fiat picker and the source-asset mapping). Near
 * static, so cache long. Suspends into the modal's AsyncBoundary.
 *
 * @see https://docs.onramper.com/reference/get_supported.md (Get Currencies)
 */
export function useOnramperSupported(): OnramperSupported["message"] {
  const api = useOnramper()
  const { data } = useSuspenseQuery({
    queryKey: depositQueryKeys.onramperSupported.queryKey,
    queryFn: async () => {
      try {
        const { message } = await api
          .get("supported", { searchParams: { type: "buy" } })
          .json<OnramperSupported>()
        return assertOnramperSupported(message)
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    staleTime: STALE_TIMES.INFINITY,
  })
  return data
}

/**
 * GET /supported/onramps/all. Per-provider metadata (display name, logo URL)
 * for the provider rows and pills. Near static, so cache long. Suspends into
 * the nearest AsyncBoundary.
 *
 * @see https://docs.onramper.com/reference/get_supported-onramps-all.md (Get Onramp Metadata)
 */
export function useOnrampsMetadata(): OnramperOnrampMetadata[] {
  const api = useOnramper()
  const { data } = useSuspenseQuery({
    queryKey: depositQueryKeys.onramperOnramps.queryKey,
    queryFn: async () => {
      try {
        const { message } = await api
          .get("supported/onramps/all", { searchParams: { type: "buy" } })
          .json<OnramperOnrampsResponse>()
        return message
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    staleTime: STALE_TIMES.INFINITY,
  })
  return data
}

/**
 * GET /supported/defaults/all, shared by the suspense read and the hub
 * prefetch so both hit the same cache entry. Fail-open: the recommendation
 * is a nice-to-have, so a fetch/parse failure logs and resolves to null (the
 * anchor falls back to the default currency) instead of blocking the buy form
 * over a localization hint; an unexpected body shape flows through the
 * optional chain to null without logging (the catch stays scoped to
 * fetch/parse failures). Never rejecting also means no retry cycle delays the
 * form's first render. Near static, so cache long — including a null from a
 * failed attempt, an accepted trade-off for a hint.
 */
function geoDefaultsQueryOptions(api: KyInstance) {
  return {
    queryKey: depositQueryKeys.onramperGeoDefaults.queryKey,
    queryFn: async (): Promise<string | null> => {
      try {
        const body = await api
          .get("supported/defaults/all", { searchParams: { type: "buy" } })
          .json<OnramperGeoDefaults | null>()
        return body?.message?.recommended?.source ?? null
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[onramp] geo defaults lookup failed:", error)
        return null
      }
    },
    staleTime: STALE_TIMES.INFINITY,
  }
}

/**
 * Onramper's IP-geolocated fiat code recommendation (e.g. "THB"), a
 * candidate for the Buy form's initial Pay currency (see resolveFiatAnchor).
 * Suspends, but the method hub prefetches the cache so entering the form
 * normally resolves instantly.
 *
 * @see https://docs.onramper.com/reference/get_supported-defaults-all.md (Get Defaults)
 */
export function useOnramperRecommendedFiatCode(): string | null {
  const api = useOnramper()
  const { data } = useSuspenseQuery(geoDefaultsQueryOptions(api))
  return data
}

/**
 * Warms the geo-defaults cache from the method hub — the one Onramper query
 * no hub component primes; without this, first entry into the Buy form would
 * gate its paint on a cold round-trip for a localization hint. No-ops when
 * the cash path is not configured.
 */
export function usePrefetchOnramperGeoDefaults() {
  const onramperEnabled = useOnramperEnabled()
  const api = useOnramper()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!onramperEnabled) return
    void queryClient.prefetchQuery(geoDefaultsQueryOptions(api))
  }, [onramperEnabled, api, queryClient])
}

/** Looks up a provider's metadata by its id (the quotes' `ramp`). */
export function useOnrampMetadata(ramp: string) {
  const onramps = useOnrampsMetadata()
  return useMemo(() => onramps.find((entry) => entry.id === ramp), [onramps, ramp])
}

/** Looks up a fiat by its Onramper id, for rendering its icon/code from a
 * stored form selection. */
export function useOnramperFiat(fiatId: string) {
  const { fiat } = useOnramperSupported()
  return useMemo(() => fiat.find((entry) => entry.id === fiatId), [fiat, fiatId])
}

/**
 * Uppercase display code for a fiat id (e.g. "usd" -> "USD"), resolved from
 * the supported list; ids and ISO codes are distinct namespaces, so
 * uppercasing the id is only a last-resort fallback for an id missing from
 * the list.
 */
export function useFiatDisplayCode(fiatId: string): string {
  const fiat = useOnramperFiat(fiatId)
  return fiat?.code ?? fiatId.toUpperCase()
}

/**
 * The deposit route and its Onramper source crypto for a chosen destination
 * (chain, denom). Onramper cannot deliver Initia assets directly, so the cash
 * path buys the destination's source asset (e.g. USDC on Ethereum) and routes it
 * through the deposit address. The matched route carries the `min_deposit_amount`
 * that floors the purchase. Returns null when no source route maps to a listed
 * Onramper asset.
 */
export function useOnramperSourceRoute(
  chainId: string,
  assetDenom: string,
): { route: Asset; crypto: OnramperCrypto } | null {
  const routes = useDepositRoutes(chainId, assetDenom)
  const { crypto } = useOnramperSupported()
  // Manual memo (no React Compiler in the build). Must return an existing
  // reference, not a fresh object (react-hooks preserve-manual-memoization).
  const route = useMemo(
    () =>
      routes.find((candidate) =>
        matchOnramperCrypto(crypto, candidate.src_chain_id, candidate.src_denom),
      ),
    [routes, crypto],
  )
  if (!route) return null
  const sourceCrypto = matchOnramperCrypto(crypto, route.src_chain_id, route.src_denom)
  return sourceCrypto ? { route, crypto: sourceCrypto } : null
}

/** The Onramper crypto to buy for a chosen destination, without its route. */
export function useOnramperSourceCrypto(
  chainId: string,
  assetDenom: string,
): OnramperCrypto | null {
  return useOnramperSourceRoute(chainId, assetDenom)?.crypto ?? null
}

/**
 * GET /supported/payment-types/{source}, cached once per pair; each view
 * below derives from it via `select`, keeping the browser-capability filter
 * in one place while the picker's empty state can still ask why the list is
 * empty.
 *
 * @see https://docs.onramper.com/reference/get_supported-payment-types-source.md (Get Payments by Source and Destination Currency)
 */
function useOnramperPaymentTypesQuery<TData>(
  source: string,
  destination: string,
  select: (paymentTypes: OnramperPaymentType[]) => TData,
) {
  const onramperEnabled = useOnramperEnabled()
  const api = useOnramper()
  return useQuery({
    queryKey: depositQueryKeys.onramperPaymentTypes(source, destination).queryKey,
    queryFn: async (): Promise<OnramperPaymentType[]> => {
      try {
        const { message } = await api
          .get(`supported/payment-types/${source}`, { searchParams: { destination, type: "buy" } })
          .json<OnramperPaymentTypesResponse>()
        return message
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: onramperEnabled && !!source && !!destination,
    staleTime: STALE_TIMES.MINUTE,
    select,
  })
}

// Module scope so React Query's select memoization holds (an inline lambda
// would re-derive on every render).
const selectSupportedPaymentTypes = (paymentTypes: OnramperPaymentType[]) =>
  filterSupportedPaymentTypes(paymentTypes, supportsApplePay())

const selectApplePayOnlyHidden = (paymentTypes: OnramperPaymentType[]) =>
  isApplePayOnlyHidden(paymentTypes, supportsApplePay())

/**
 * Payment methods for the fiat -> source-crypto pair, filtered to what this
 * browser can complete. Every consumer reads this view, so they all agree on
 * the same list; Onramper recommends fetching it before quotes.
 */
export function useOnramperPaymentTypes(source: string, destination: string) {
  return useOnramperPaymentTypesQuery(source, destination, selectSupportedPaymentTypes)
}

/** True when the capability filter hid every payment method of the pair
 * (see isApplePayOnlyHidden). */
export function useApplePayOnlyHidden(source: string, destination: string): boolean {
  return useOnramperPaymentTypesQuery(source, destination, selectApplePayOnlyHidden).data ?? false
}

interface QuotesParams {
  /** Fiat id (lowercase), e.g. "usd". */
  fiat: string
  /** Onramper crypto id, e.g. "usdc_ethereum". */
  crypto: string
  /** Fiat amount to spend, as a user-typed string. */
  amount: string
  paymentMethod: string
}

// Quotes are live prices; refresh on a short interval so the picker does not go
// stale while open.
const QUOTE_STALE_TIME = STALE_TIMES.SECOND * 30

/**
 * GET /quotes/{fiat}/{crypto}, always price-only (no walletAddress): delivery
 * goes through the Deposit API checkout, which derives the address itself. A
 * walletAddress param here would need to join the query key to avoid colliding
 * with price-only cache entries. `amount` joins the query key and `/quotes`
 * fans out to every provider on Onramper's side, so callers must debounce a
 * typed amount (useOnrampQuote does) or risk Onramper's rate limit.
 *
 * @see https://docs.onramper.com/reference/get_quotes-fiat-crypto.md (Get Buy Quotes)
 */
export function useOnramperQuotes({ fiat, crypto, amount, paymentMethod }: QuotesParams) {
  const onramperEnabled = useOnramperEnabled()
  const api = useOnramper()
  return useQuery({
    queryKey: depositQueryKeys.onramperQuotes(fiat, crypto, amount, paymentMethod).queryKey,
    queryFn: async ({ signal }): Promise<OnramperQuote[]> => {
      try {
        const searchParams = { type: "buy", amount, paymentMethod }
        const quotes = await api
          .get(`quotes/${fiat}/${crypto}`, { searchParams, signal })
          .json<OnramperQuote[]>()
        logSuppressedQuoteErrors(quotes)
        return quotes
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: onramperEnabled && !!fiat && !!crypto && Number(amount) > 0 && !!paymentMethod,
    staleTime: QUOTE_STALE_TIME,
    refetchInterval: QUOTE_STALE_TIME,
  })
}

/** Inputs for `useOnrampCheckout`, gathered from the connected wallet, the
 * destination, the selected quote, and the Buy form. */
export interface OnrampCheckoutParams {
  /** Connected wallet (destination, bech32 init1…). The Deposit API signs the
   * deposit address it re-derives from this triple, never this address itself. */
  walletAddress: string
  /** Destination chain id. */
  chainId: string
  /** Destination denom. */
  assetDenom: string
  /** Selected provider id, e.g. "moonpay" (quote `ramp`). */
  onramp: string
  /** Fiat id (lowercase), e.g. "usd". Onramper's checkout calls this `source`;
   * the proxy contract uses the `/quotes/{fiat}/{crypto}` vocabulary instead so
   * it cannot be confused with the deposit destination fields above. */
  fiat: string
  /** Onramper source crypto id to buy, e.g. "usdc_ethereum". Onramper's
   * checkout calls this `destination` (same rename rationale as `fiat`). */
  crypto: string
  /** Onramper source crypto network, e.g. "ethereum". */
  network: string
  /** Fiat amount to spend. */
  amount: number
  /** Onramper paymentTypeId, e.g. "creditcard". */
  paymentMethod: string
  /** Idempotency key, generated once per checkout and reused across retries. */
  uuid: string
}

/**
 * Cash checkout via the Deposit API (`POST /v1/onramper/checkout`), which
 * proxies Onramper's server-side-only `POST /checkout/intent`. Only the
 * destination triple is sent — the backend re-derives and signs the deposit
 * address itself, so a tampered address cannot be signed. Passthrough fields
 * use the `/quotes` vocabulary (`fiat`/`crypto`) to avoid colliding with the
 * destination fields.
 *
 * @see https://docs.onramper.com/reference/post_checkout-intent.md (Initiate a Transaction)
 * @see https://docs.onramper.com/docs/sign-api-request.md (Sign API request)
 */
async function createCheckoutIntent(
  api: KyInstance,
  params: OnrampCheckoutParams,
): Promise<OnramperCheckoutResult> {
  try {
    return await api
      .post("v1/onramper/checkout", {
        json: {
          wallet_address: params.walletAddress,
          chain_id: params.chainId,
          asset_denom: params.assetDenom,
          onramp: params.onramp,
          fiat: params.fiat,
          crypto: params.crypto,
          network: params.network,
          amount: params.amount,
          payment_method: params.paymentMethod,
          uuid: params.uuid,
        },
      })
      .json<OnramperCheckoutResult>()
  } catch (error) {
    throw await normalizeError(error)
  }
}

export function useOnrampCheckout() {
  const depositApi = useDepositApi()
  return useMutation({
    mutationFn: async (params: OnrampCheckoutParams): Promise<OnramperCheckoutResult> => {
      const result = await createCheckoutIntent(depositApi, params)
      assertCheckoutUrl(result.url)
      return result
    },
  })
}
