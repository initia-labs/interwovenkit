// Onramper aggregator API (cash/card onramp path) response types. Decoded via
// ky's `.json<T>()` per project convention (no runtime schema library).
//
// The cash path buys a source asset (e.g. USDC or native ETH on Ethereum) that
// Onramper delivers to the Deposit API's deposit address; the Deposit API then
// bridges it to the chosen Initia destination. So the Onramper "destination
// crypto" is the deposit route's source asset, not the user-facing destination.
// This uses Onramper's REST API, not the hosted widget: the cash UI is custom
// and only payment + KYC are delegated to an external redirect (see
// OnrampProcessing).

/** A fiat currency from `GET /supported` (`message.fiat[]`). */
export interface OnramperFiat {
  /** Lowercase id used as the path segment in `/quotes/{fiat}/{crypto}`. */
  id: string
  /** Uppercase ISO code shown to the user, e.g. "USD". */
  code: string
  name: string
  /** Currency symbol glyph, e.g. "$". */
  symbol: string
  icon: string
}

/** A crypto asset from `GET /supported` (`message.crypto[]`). One entry per
 * (asset, network); the same code appears on multiple networks. */
export interface OnramperCrypto {
  /** Lowercase network-qualified id, e.g. "usdc_ethereum"; used in `/quotes`. */
  id: string
  code: string
  name: string
  symbol: string
  network: string
  decimals: number
  /** Token contract address; the zero address for a chain's native coin. */
  address: string
  chainId: number
  icon: string
  networkDisplayName: string
}

/**
 * `GET /supported` response shape.
 *
 * @see https://docs.onramper.com/reference/get_supported.md (Get Currencies)
 */
export interface OnramperSupported {
  message: {
    fiat: OnramperFiat[]
    crypto: OnramperCrypto[]
  }
}

/**
 * One provider from `GET /supported/onramps/all` (`message[]`). `id` shares the
 * provider-id namespace with the quotes' `ramp` field. The schema doesn't
 * guarantee `displayName`/`icon`, hence optional; consumers fall back
 * (capitalized id, gray placeholder). The `icons` object (svg + png variants)
 * is unused, so omitted.
 *
 * @see https://docs.onramper.com/reference/get_supported-onramps-all.md (Get Onramp Metadata)
 */
export interface OnramperOnrampMetadata {
  /** Provider id, e.g. "moonpay". */
  id: string
  /** Official display name, e.g. "MoonPay". */
  displayName?: string
  /** Logo URL, e.g. "https://cdn.onramper.com/icons/onramps/moonpay-colored.svg". */
  icon?: string
}

/**
 * `GET /supported/onramps/all` response shape.
 *
 * @see https://docs.onramper.com/reference/get_supported-onramps-all.md (Get Onramp Metadata)
 */
export interface OnramperOnrampsResponse {
  message: OnramperOnrampMetadata[]
}

/**
 * `GET /supported/defaults/all` response, trimmed to what the widget consumes.
 * `recommended` is Onramper's suggestion for the caller's country (IP-geolocated
 * when no `country` param is sent); `source` is an uppercase fiat code (e.g.
 * "THB"), not a lowercase fiat id, so match it against `OnramperFiat.code`. The
 * rest of the response is unused, so untyped.
 *
 * @see https://docs.onramper.com/reference/get_supported-defaults-all.md (Get Defaults)
 */
export interface OnramperGeoDefaults {
  message: {
    recommended?: {
      source?: string
    }
  }
}

/** Fiat min/max purchase bounds from `details.limits`, in the source fiat. */
export interface OnramperPaymentTypeLimit {
  min?: number
  max?: number
}

/** A payment method from `GET /supported/payment-types/{source}`
 * (`message[]`). `details.limits` maps provider ids to their fiat bounds, plus
 * `aggregatedLimit` (the union across providers). Quotes remain the
 * authoritative per-provider limits at purchase time; the aggregated bound only
 * powers ahead-of-input hints (e.g. the method hub's "Up to $20,000"). */
export interface OnramperPaymentType {
  paymentTypeId: string
  name: string
  icon: string
  details?: {
    limits?: { aggregatedLimit?: OnramperPaymentTypeLimit } & Record<
      string,
      OnramperPaymentTypeLimit | undefined
    >
  }
}

/**
 * `GET /supported/payment-types/{source}` response shape.
 *
 * @see https://docs.onramper.com/reference/get_supported-payment-types-source.md (Get Payments by Source and Destination Currency)
 */
export interface OnramperPaymentTypesResponse {
  message: OnramperPaymentType[]
}

/** One provider's offer from `GET /quotes/{fiat}/{crypto}` (the response is a
 * bare array). Error-only entries omit `payout`/`ramp` and carry `errors`.
 *
 * @see https://docs.onramper.com/reference/get_quotes-fiat-crypto.md (Get Buy Quotes) */
export interface OnramperQuote {
  /** Provider id, e.g. "moonpay"; absent on error-only entries. */
  ramp?: string
  paymentMethod: string
  /** Fiat units per 1 crypto unit (includes the provider spread). */
  rate: number
  /** Network fee in fiat; absent when the provider reports none (e.g. Guardarian). */
  networkFee?: number
  /** Provider processing fee in fiat; absent when the provider charges none. */
  transactionFee?: number
  /** Crypto amount the user receives, in the destination asset's display units. */
  payout?: number
  quoteId?: string
  /** Tags such as "BestPrice" / "LowKyc" (the only documented values); absent
   * on error-only entries, empty for non-recommended ramps. */
  recommendations?: string[]
  /** Present on entries that could not be filled, in place of a payout. */
  errors?: { type?: string; errorId?: number; message: string }[]
}

/**
 * `POST /v1/onramper/checkout` (the Deposit API's proxy to Onramper) response,
 * snake_case per the Deposit API contract. Onramper's `POST /checkout/intent` is
 * server-side only (its CORS allowlist admits only Onramper's own widget origin,
 * confirmed by Onramper), so the Deposit API re-derives the deposit address from
 * the destination triple, signs it, and calls Onramper server-to-server. Only
 * the consumed fields are returned: `url` is the provider's hosted payment/KYC
 * page, `transaction_id` the Onramper transaction id. Fiat-stage tracking via
 * `GET /transactions/{id}` is server-side only (needs the `x-onramper-secret`
 * webhook secret; a pk-only call gets 401), so the frontend keeps the id for
 * support/debugging, not polling. Onramper's `type` ("redirect"/"iframe") is
 * dropped: we never embed (iframe out of scope), so the hand-off always
 * navigates to `url`.
 *
 * @see https://docs.onramper.com/reference/post_checkout-intent.md (Initiate a Transaction)
 */
export interface OnramperCheckoutResult {
  transaction_id: string
  url: string
}
