import BigNumber from "bignumber.js"
import { toBaseUnit } from "@initia/utils"
import type { Asset } from "../../data/types"
import type {
  OnramperCrypto,
  OnramperFiat,
  OnramperOnrampMetadata,
  OnramperPaymentType,
  OnramperQuote,
  OnramperSupported,
} from "./onramperTypes"

// Onramper source routes live on Ethereum L1. Native ETH is represented by the
// zero address; ERC-20s (e.g. USDC) by their contract address.
const ETHEREUM_CHAIN_ID = 1
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * Rejects an empty `/supported` response. Onramper answers a misconfigured
 * API key (invalid, or prod key against staging) with 200 and empty lists,
 * not a 401 — accepting that would surface downstream as "Not available for
 * this asset". Also guarantees consumers a non-empty fiat list.
 */
export function assertOnramperSupported(
  message: OnramperSupported["message"],
): OnramperSupported["message"] {
  if (message.fiat.length === 0 || message.crypto.length === 0) {
    throw new Error(
      "Onramper returned no supported currencies. onramperApiKey or onramperApiUrl is likely misconfigured.",
    )
  }
  return message
}

/**
 * Maps a Deposit API source route to its Onramper crypto. The route's
 * `src_denom` is either "<chain>-native" (native coin -> zero address) or an
 * ERC-20 contract address; both are matched case-insensitively on Ethereum.
 */
export function matchOnramperCrypto(
  cryptos: OnramperCrypto[],
  srcChainId: string,
  srcDenom: string,
): OnramperCrypto | undefined {
  if (srcChainId !== String(ETHEREUM_CHAIN_ID)) return undefined
  const targetAddress = srcDenom.endsWith("-native") ? ZERO_ADDRESS : srcDenom.toLowerCase()
  return cryptos.find(
    (crypto) =>
      crypto.chainId === ETHEREUM_CHAIN_ID && crypto.address.toLowerCase() === targetAddress,
  )
}

/** Candidate sources for the Buy form's fiat anchor, in priority order. */
export interface FiatAnchorCandidates {
  /** The user's remembered explicit pick (localStorage), a lowercase fiat id. */
  persistedId: string | null
  /** Onramper's geolocated recommendation, an uppercase fiat CODE (e.g.
   * "THB") — a different namespace than ids, hence matched by code. */
  recommendedCode: string | null
  /** The static fallback currency, a lowercase fiat id. */
  defaultId: string
}

/**
 * The fiat the Buy form should anchor to: the user's remembered pick, else
 * Onramper's geolocated recommendation, else the default currency, else the
 * first listed fiat. Every candidate must resolve against the live supported
 * list — an unlisted value would wedge the payment-types and quotes queries
 * with no automatic recovery. Non-empty input (assertOnramperSupported)
 * guarantees a result.
 */
export function resolveFiatAnchor(
  supportedFiat: OnramperFiat[],
  { persistedId, recommendedCode, defaultId }: FiatAnchorCandidates,
): OnramperFiat {
  const byId = (id: string | null) =>
    id ? supportedFiat.find((entry) => entry.id === id) : undefined
  // The recommendation is a code, not an id (distinct namespaces); the id
  // pass hedges an id/code desync in the list. Two passes, not one find with
  // an OR, so an id match cannot shadow an exact code match.
  const byCode = (code: string | null) => {
    if (!code) return undefined
    const lower = code.toLowerCase()
    return (
      supportedFiat.find((entry) => entry.code.toLowerCase() === lower) ??
      supportedFiat.find((entry) => entry.id === lower)
    )
  }
  return byId(persistedId) ?? byCode(recommendedCode) ?? byId(defaultId) ?? supportedFiat[0]
}

const APPLE_PAY_PAYMENT_TYPE_ID = "applepay"

/**
 * Whether this browser can complete an Apple Pay payment. Apple Pay on the
 * web exists only where WebKit exposes `ApplePaySession` (Safari, iOS
 * browsers); elsewhere a hosted checkout can only attempt it via the Payment
 * Request API, which fails after the user has entered the payment flow.
 * `canMakePayments()` rules out devices where the API exists but Apple Pay
 * itself is unavailable.
 */
export function supportsApplePay(): boolean {
  if (typeof window === "undefined") return false
  const applePaySession = (window as { ApplePaySession?: { canMakePayments: () => boolean } })
    .ApplePaySession
  if (!applePaySession) return false
  try {
    return applePaySession.canMakePayments()
  } catch {
    // The probe itself can throw (e.g. insecure context); treat as unsupported.
    return false
  }
}

/**
 * Drops payment types this browser cannot complete. The provider hand-off
 * opens in the same browser, so offering Apple Pay without WebKit support is
 * a guaranteed dead end on the provider's checkout page.
 */
export function filterSupportedPaymentTypes(
  paymentTypes: OnramperPaymentType[],
  applePayAvailable: boolean,
): OnramperPaymentType[] {
  if (applePayAvailable) return paymentTypes
  return paymentTypes.filter(
    (paymentType) => paymentType.paymentTypeId !== APPLE_PAY_PAYMENT_TYPE_ID,
  )
}

/**
 * Whether capability filtering alone emptied the payment-type list (every
 * method is Apple Pay in a browser that cannot complete it). Lets the
 * picker's empty state name the actual fix instead of reading as a pair
 * with no methods at all.
 */
export function isApplePayOnlyHidden(
  paymentTypes: OnramperPaymentType[],
  applePayAvailable: boolean,
): boolean {
  return (
    paymentTypes.length > 0 &&
    filterSupportedPaymentTypes(paymentTypes, applePayAvailable).length === 0
  )
}

/**
 * The highest `aggregatedLimit.max` across payment types — the method hub's
 * "Up to" hint, shown before a method is chosen, hence the widest bound
 * rather than one method's. Undefined when no payment type reports a max.
 */
export function maxAggregatedLimit(paymentTypes: OnramperPaymentType[]): number | undefined {
  const maxes = paymentTypes
    .map((paymentType) => paymentType.details?.limits?.aggregatedLimit?.max)
    .filter((max): max is number => typeof max === "number" && Number.isFinite(max))
  if (maxes.length === 0) return undefined
  return Math.max(...maxes)
}

/**
 * Formats a fiat amount with its symbol glyph, e.g. "$20,000". Stringified
 * first: BigNumber strict mode throws on floats with more than 15
 * significant digits; strings carry no such limit.
 */
export function formatFiatAmount(value: number, fiatSymbol: string): string {
  return `${fiatSymbol}${BigNumber(String(value)).toFormat()}`
}

/**
 * Formats the maximum-purchase hint, e.g. "Up to $20,000". The selected
 * payment method may allow less (see fiatLimitError), so the copy reads as
 * a ceiling hint rather than a promised limit.
 */
export function formatMaxPurchaseLabel(max: number, fiatSymbol: string): string {
  return `Up to ${formatFiatAmount(max, fiatSymbol)}`
}

/** The aggregated (cross-provider) fiat bounds of one payment type, if known. */
export function findAggregatedLimit(
  paymentTypes: OnramperPaymentType[],
  paymentTypeId: string,
): { min?: number; max?: number } | undefined {
  return paymentTypes.find((paymentType) => paymentType.paymentTypeId === paymentTypeId)?.details
    ?.limits?.aggregatedLimit
}

/**
 * Pre-quote validation of the typed fiat amount against the selected payment
 * type's bounds: an actionable message when out of range, else "". Keeps
 * failing amounts from reaching `/quotes` at all. `paymentMethodName` names
 * the bound's owner so the message cannot look like it contradicts the
 * method hub's widest-bound hint.
 */
export function fiatLimitError(
  amount: string,
  limit: { min?: number; max?: number } | undefined,
  fiatSymbol: string,
  paymentMethodName?: string,
): string {
  if (!limit) return ""
  const value = Number(amount)
  if (!(value > 0)) return ""
  const method = paymentMethodName ? ` with ${paymentMethodName}` : ""
  if (limit.min !== undefined && value < limit.min)
    return `Minimum purchase${method} is ${formatFiatAmount(limit.min, fiatSymbol)}`
  if (limit.max !== undefined && value > limit.max)
    return `Maximum purchase${method} is ${formatFiatAmount(limit.max, fiatSymbol)}`
  return ""
}

/**
 * Whether a provider payout falls below the route's `min_deposit_amount`.
 * The bridge minimum is separate from (and often stricter than) Onramper's
 * fiat floor; a purchase below it clears payment yet dies at the bridge with
 * no refund, so the Buy form blocks submission on it.
 */
export function isBelowRouteMinimum(payout: number, route: Asset): boolean {
  const payoutBase = toBaseUnit(String(payout), { decimals: route.src_decimals }) || "0"
  // No fallback on min_deposit_amount: parseAssets guarantees a valid integer
  // string, and `|| 0` here would silently disarm the only gate protecting
  // funds — better to let BigNumber strict mode throw.
  return BigNumber(payoutBase).lt(route.min_deposit_amount)
}

/** "moonpay" -> "Moonpay". */
function capitalizeRamp(ramp: string): string {
  return ramp.charAt(0).toUpperCase() + ramp.slice(1)
}

/** Display name for a ramp: the metadata `displayName` (e.g. "MoonPay"),
 * else the capitalized id. */
export function getOnrampDisplayName(onramps: OnramperOnrampMetadata[], ramp: string): string {
  return onramps.find((entry) => entry.id === ramp)?.displayName ?? capitalizeRamp(ramp)
}

/** A provider quote ranked for display: the best payout is flagged and others
 * carry their percentage gap against it. */
export interface RankedQuote {
  quote: OnramperQuote
  ramp: string
  payout: number
  isBest: boolean
  /** Percentage difference vs the best payout, e.g. "-1.20%"; empty for best. */
  diffLabel: string
}

/**
 * Ranks provider quotes by payout, best first. Best means max payout, not
 * Onramper's `recommendations` tag (they usually agree but are not
 * identical). Drops error-only entries (no payout).
 */
export function rankQuotes(quotes: OnramperQuote[]): RankedQuote[] {
  const valid = quotes.filter(
    (quote): quote is OnramperQuote & { payout: number; ramp: string } =>
      typeof quote.payout === "number" && !!quote.ramp,
  )
  if (!valid.length) return []
  const bestPayout = Math.max(...valid.map((quote) => quote.payout))
  // Spread-and-sort instead of toSorted (this tsconfig's lib < es2023).
  return [...valid]
    .sort((a, b) => b.payout - a.payout)
    .map((quote) => {
      const isBest = quote.payout === bestPayout
      const diff = bestPayout ? ((quote.payout - bestPayout) / bestPayout) * 100 : 0
      return {
        quote,
        ramp: quote.ramp,
        payout: quote.payout,
        isBest,
        diffLabel: isBest ? "" : `${diff.toFixed(2)}%`,
      }
    })
}

/**
 * The offer to act on: the selected provider's entry when it still makes an
 * offer, else the best payout (`ranked[0]`, covering a stale `providerId`).
 * Null when no provider made an offer.
 */
export function selectRankedQuote(ranked: RankedQuote[], providerId: string): RankedQuote | null {
  return ranked.find((entry) => entry.ramp === providerId) ?? ranked[0] ?? null
}

/** Total fee of an offer in fiat. Both fee fields are optional (absence
 * means none reported); default to 0 so the sum cannot be NaN. */
export function totalQuoteFee(quote: OnramperQuote): number {
  return (quote.networkFee ?? 0) + (quote.transactionFee ?? 0)
}

// Amount-range guidance ("Amount should be in between ZAR 842.59 and ZAR
// 182094.29") — the one error class phrased as a user instruction.
const AMOUNT_RANGE_ERROR_ID = 6101

// Provider failed to produce a quote at all ("Unable to retrieve quotes.") —
// a transient outage, not a capability gap.
const PROVIDER_OUTAGE_ERROR_ID = 6200

// Request-shape validation ("Wallet Address is required" for price-only
// quotes). The form quotes without an address, so a couple of these accompany
// every response — pure noise when classifying the rest.
const REQUEST_VALIDATION_ERROR_ID = 6403

const PROVIDERS_UNAVAILABLE_MESSAGE =
  "Providers are temporarily unavailable. Try again in a moment."

// Replaces provider-internal error noise when no offer was made: the other
// observed classes (6100, 6103, 6403) blame internals the user never chose
// and read as widget bugs rather than a capability gap.
const NO_OFFERS_MESSAGE =
  "No provider currently supports this combination. Try a different payment method or currency."

/**
 * User-facing reason for a quotes response with no offers. Prefers a
 * provider's amount-range message (6101); an outage-only response (all 6200,
 * ignoring the ever-present 6403 entries) gets retry copy so an upstream
 * failure does not read as a permanent capability gap. Everything else —
 * unknown errorIds and error-free empty responses included — gets the
 * generic copy pointing at the choices the user can actually change.
 */
export function quotesErrorMessage(quotes: OnramperQuote[]): string {
  const errors = quotes.flatMap((quote) => quote.errors ?? [])
  const amountRangeError = errors.find((error) => error.errorId === AMOUNT_RANGE_ERROR_ID)
  if (amountRangeError) return amountRangeError.message
  const signal = errors.filter((error) => error.errorId !== REQUEST_VALIDATION_ERROR_ID)
  if (signal.length > 0 && signal.every((error) => error.errorId === PROVIDER_OUTAGE_ERROR_ID))
    return PROVIDERS_UNAVAILABLE_MESSAGE
  return NO_OFFERS_MESSAGE
}

/**
 * Logs the raw provider errors of a quotes response that produced no offers,
 * since quotesErrorMessage collapses them into generic copy. Called at the
 * query layer so it fires once per response instead of once per render.
 */
export function logSuppressedQuoteErrors(quotes: OnramperQuote[]) {
  if (rankQuotes(quotes).length > 0) return
  const errors = quotes.flatMap((quote) => quote.errors ?? [])
  if (errors.length === 0) return
  // eslint-disable-next-line no-console
  console.warn("[onramp] provider quote errors:", errors)
}

// Guards the external checkout URL: non-https schemes fail loudly instead of
// being opened.
export function assertCheckoutUrl(url: string) {
  let protocol = ""
  try {
    protocol = new URL(url).protocol
  } catch {
    // Not a parseable URL; the throw below reports it.
  }
  if (protocol !== "https:") throw new Error(`Unexpected checkout URL from the provider: ${url}`)
}
