import { omit } from "ramda"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Asset } from "../../data/types"
import {
  assertCheckoutUrl,
  assertOnramperSupported,
  fiatLimitError,
  filterSupportedPaymentTypes,
  findAggregatedLimit,
  formatMaxPurchaseLabel,
  getOnrampDisplayName,
  isApplePayOnlyHidden,
  isBelowRouteMinimum,
  logSuppressedQuoteErrors,
  matchOnramperCrypto,
  maxAggregatedLimit,
  quotesErrorMessage,
  rankQuotes,
  resolveFiatAnchor,
  selectRankedQuote,
  supportsApplePay,
  totalQuoteFee,
} from "./onramperLogic"
import type {
  OnramperCrypto,
  OnramperFiat,
  OnramperOnrampMetadata,
  OnramperPaymentType,
  OnramperQuote,
} from "./onramperTypes"

// Mirrors the Onramper supported list (Ethereum, chainId 1). USDC keeps its
// checksummed address to exercise the case-insensitive matching against the
// Deposit API's checksummed src_denom.
const crypto = (overrides: Partial<OnramperCrypto>): OnramperCrypto => ({
  id: "eth",
  code: "ETH",
  name: "Ethereum",
  symbol: "ETH",
  network: "ethereum",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  chainId: 1,
  icon: "",
  networkDisplayName: "Ethereum",
  ...overrides,
})

const ETH = crypto({})
const USDC = crypto({
  id: "usdc_ethereum",
  code: "USDC",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
})
const USDC_POLYGON = crypto({ id: "usdc_polygon", network: "polygon", chainId: 137 })
const CRYPTOS = [ETH, USDC, USDC_POLYGON]

describe("matchOnramperCrypto", () => {
  it("returns undefined for non-Ethereum source chains", () => {
    expect(matchOnramperCrypto(CRYPTOS, "137", USDC.address)).toBeUndefined()
    expect(matchOnramperCrypto(CRYPTOS, "interwoven-1", "uusdc")).toBeUndefined()
  })

  it("maps a -native denom to the zero-address entry", () => {
    expect(matchOnramperCrypto(CRYPTOS, "1", "ethereum-native")).toBe(ETH)
  })

  it("matches ERC-20 addresses case-insensitively", () => {
    expect(matchOnramperCrypto(CRYPTOS, "1", USDC.address)).toBe(USDC)
    expect(matchOnramperCrypto(CRYPTOS, "1", USDC.address.toLowerCase())).toBe(USDC)
    expect(matchOnramperCrypto(CRYPTOS, "1", USDC.address.toUpperCase().replace("0X", "0x"))).toBe(
      USDC,
    )
  })

  it("returns undefined for an unlisted asset", () => {
    expect(matchOnramperCrypto(CRYPTOS, "1", "0x1234567890abcdef1234567890abcdef12345678")).toBe(
      undefined,
    )
  })
})

const offer = (ramp: string, payout: number): OnramperQuote => ({
  ramp,
  paymentMethod: "creditcard",
  rate: 1,
  networkFee: 0,
  payout,
})

const errorEntry = (message: string, errorId?: number): OnramperQuote => ({
  paymentMethod: "creditcard",
  rate: 0,
  networkFee: 0,
  errors: [{ message, errorId }],
})

describe("rankQuotes", () => {
  it("ranks by payout descending and flags the best", () => {
    const ranked = rankQuotes([offer("moonpay", 90), offer("banxa", 100), offer("topper", 95)])
    expect(ranked.map((entry) => entry.ramp)).toEqual(["banxa", "topper", "moonpay"])
    expect(ranked.map((entry) => entry.isBest)).toEqual([true, false, false])
  })

  it("labels the gap against the best payout and leaves the best empty", () => {
    const ranked = rankQuotes([offer("banxa", 100), offer("moonpay", 90)])
    expect(ranked[0].diffLabel).toBe("")
    expect(ranked[1].diffLabel).toBe("-10.00%")
  })

  it("flags every entry on a payout tie", () => {
    const ranked = rankQuotes([offer("banxa", 100), offer("moonpay", 100)])
    expect(ranked.every((entry) => entry.isBest)).toBe(true)
  })

  it("drops error-only entries", () => {
    const ranked = rankQuotes([errorEntry("minimum amount is 30 USD"), offer("banxa", 100)])
    expect(ranked.map((entry) => entry.ramp)).toEqual(["banxa"])
  })

  it("returns an empty array when nothing is fillable", () => {
    expect(rankQuotes([])).toEqual([])
    expect(rankQuotes([errorEntry("minimum amount is 30 USD")])).toEqual([])
  })

  it("does not mutate the input order", () => {
    const quotes = [offer("moonpay", 90), offer("banxa", 100)]
    rankQuotes(quotes)
    expect(quotes.map((entry) => entry.ramp)).toEqual(["moonpay", "banxa"])
  })

  it("guards the percentage against a zero best payout", () => {
    const ranked = rankQuotes([offer("banxa", 0), offer("moonpay", 0)])
    expect(ranked.every((entry) => entry.isBest)).toBe(true)
    expect(ranked.every((entry) => entry.diffLabel === "")).toBe(true)
  })
})

describe("selectRankedQuote", () => {
  const ranked = rankQuotes([offer("moonpay", 90), offer("banxa", 100)])

  it("returns the selected provider's offer when it still quotes", () => {
    expect(selectRankedQuote(ranked, "moonpay")?.ramp).toBe("moonpay")
  })

  // A stale providerId (the provider stopped quoting this amount) must fall
  // back to the best offer instead of blanking the form.
  it("falls back to the best offer on a stale providerId", () => {
    expect(selectRankedQuote(ranked, "gone")?.ramp).toBe("banxa")
    expect(selectRankedQuote(ranked, "")?.ramp).toBe("banxa")
  })

  it("returns null when there are no offers", () => {
    expect(selectRankedQuote([], "moonpay")).toBeNull()
  })
})

describe("getOnrampDisplayName", () => {
  const onramps: OnramperOnrampMetadata[] = [
    { id: "moonpay", displayName: "MoonPay", icon: "https://cdn.onramper.com/moonpay.svg" },
  ]

  it("returns the official displayName for a listed ramp", () => {
    expect(getOnrampDisplayName(onramps, "moonpay")).toBe("MoonPay")
  })

  it("capitalizes the id for a ramp missing from the list", () => {
    expect(getOnrampDisplayName(onramps, "banxa")).toBe("Banxa")
    expect(getOnrampDisplayName([], "moonpay")).toBe("Moonpay")
  })

  it("capitalizes the id for a listed ramp without a displayName", () => {
    expect(getOnrampDisplayName([{ id: "banxa" }], "banxa")).toBe("Banxa")
  })
})

describe("totalQuoteFee", () => {
  it("sums the network and transaction fees", () => {
    expect(totalQuoteFee({ ...offer("banxa", 100), networkFee: 1.5, transactionFee: 0.47 })).toBe(
      1.97,
    )
  })

  // `transactionFee` is optional in the contract; an omitted fee is zero, not NaN.
  it("treats an omitted transaction fee as zero", () => {
    expect(totalQuoteFee({ ...offer("banxa", 100), networkFee: 1.5 })).toBe(1.5)
  })

  // Guardarian omits `networkFee` entirely on the wire; NaN here rendered the
  // fee row as a bare currency code.
  it("treats an omitted network fee as zero", () => {
    const withoutNetworkFee = omit(["networkFee"], offer("guardarian", 100))
    expect(totalQuoteFee(withoutNetworkFee)).toBe(0)
    expect(totalQuoteFee({ ...withoutNetworkFee, transactionFee: 0.47 })).toBe(0.47)
  })
})

describe("quotesErrorMessage", () => {
  const genericCopy =
    "No provider currently supports this combination. Try a different payment method or currency."

  // 6101 is the one class phrased as a user instruction; it must win even behind
  // noise entries (6103). The leading offer entry pins the errors-anywhere scan:
  // real responses mix offer and error entries, and a first-entry regression
  // would fall back to the generic copy.
  it("prefers a provider's amount-range message (6101) over earlier noise", () => {
    expect(
      quotesErrorMessage([
        offer("banxa", 100),
        errorEntry("No supported payments found", 6103),
        errorEntry("Amount should be in between ZAR 842.59 and ZAR 182094.29", 6101),
      ]),
    ).toBe("Amount should be in between ZAR 842.59 and ZAR 182094.29")
  })

  // Two providers may report different ranges; the first in response order is
  // shown (either is valid guidance — this pins the determinism, not a ranking).
  it("shows the first amount-range message when several providers report one", () => {
    expect(
      quotesErrorMessage([
        errorEntry("Amount should be in between USD 30 and USD 50000", 6101),
        errorEntry("Amount should be in between USD 50 and USD 20000", 6101),
      ]),
    ).toBe("Amount should be in between USD 30 and USD 50000")
  })

  // An only-outage response (Onramper upstream failure) must say "retry", not
  // pose as a permanent capability gap; one non-outage error means the gap
  // explanation applies after all.
  it("uses retry copy when every error is a provider outage (6200)", () => {
    expect(
      quotesErrorMessage([
        errorEntry("Unable to retrieve quotes.", 6200),
        errorEntry("Unable to retrieve quotes.", 6200),
      ]),
    ).toBe("Providers are temporarily unavailable. Try again in a moment.")
    expect(
      quotesErrorMessage([
        errorEntry("Unable to retrieve quotes.", 6200),
        errorEntry("moonpay does not support Payment Method to be banktransfer", 6100),
      ]),
    ).toBe(genericCopy)
  })

  // The form quotes without a walletAddress, so 6403 validation entries
  // accompany every live response. Counting them as signal would make the
  // only-outage branch unreachable in production.
  it("ignores request-validation entries (6403) when detecting an outage", () => {
    expect(
      quotesErrorMessage([
        errorEntry("Unable to retrieve quotes.", 6200),
        errorEntry("Error in walletAddress: Wallet Address is required", 6403),
      ]),
    ).toBe("Providers are temporarily unavailable. Try again in a moment.")
    // Only-validation errors carry no provider signal at all; that is a
    // capability question, not an outage.
    expect(
      quotesErrorMessage([errorEntry("Error in walletAddress: Wallet Address is required", 6403)]),
    ).toBe(genericCopy)
  })

  // Raw internals ("moonpay does not support Payment Method to be banktransfer"
  // for a method picked from our list) read as widget bugs, so everything but
  // 6101 collapses to the generic copy.
  it("replaces provider-internal errors with generic copy", () => {
    expect(
      quotesErrorMessage([
        errorEntry("moonpay does not support Payment Method to be banktransfer", 6100),
        errorEntry("No supported payments found", 6103),
      ]),
    ).toBe(genericCopy)
  })

  // Fail-safe direction of the allowlist: an errorId we have never seen (or a
  // missing one) must not leak its raw message.
  it("replaces unknown or missing errorIds with generic copy", () => {
    expect(quotesErrorMessage([errorEntry("minimum amount is 30 USD")])).toBe(genericCopy)
    expect(quotesErrorMessage([errorEntry("some new provider error", 9999)])).toBe(genericCopy)
  })

  // A no-offers response with no error entries still needs an explanation:
  // an empty reason would leave the form footer blank and the disabled
  // button ("No quote available") reading as a dead end.
  it("falls back to generic copy when no entry carries an error", () => {
    expect(quotesErrorMessage([offer("banxa", 100)])).toBe(genericCopy)
    expect(quotesErrorMessage([])).toBe(genericCopy)
  })
})

describe("logSuppressedQuoteErrors", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("logs raw errors only when the response produced no offers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errors = [{ message: "No supported payments found", errorId: 6103 }]

    logSuppressedQuoteErrors([{ ...offer("banxa", 100), errors }])
    expect(warn).not.toHaveBeenCalled()

    logSuppressedQuoteErrors([errorEntry("No supported payments found", 6103)])
    expect(warn).toHaveBeenCalledWith("[onramp] provider quote errors:", errors)
  })

  it("stays silent for an error-free empty response", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logSuppressedQuoteErrors([])
    expect(warn).not.toHaveBeenCalled()
  })
})

const paymentType = (
  paymentTypeId: string,
  aggregatedLimit?: { min?: number; max?: number },
): OnramperPaymentType => ({
  paymentTypeId,
  name: paymentTypeId,
  icon: "",
  details: aggregatedLimit ? { limits: { aggregatedLimit } } : undefined,
})

describe("filterSupportedPaymentTypes", () => {
  const paymentTypes = [paymentType("creditcard"), paymentType("applepay"), paymentType("iach")]

  // Offering Apple Pay in a browser without it is a guaranteed dead end at the
  // provider's checkout (fails after payment details), so it must not be listed.
  it("drops Apple Pay when the browser cannot complete it", () => {
    expect(
      filterSupportedPaymentTypes(paymentTypes, false).map((type) => type.paymentTypeId),
    ).toEqual(["creditcard", "iach"])
  })

  it("keeps the list intact when Apple Pay is available", () => {
    expect(filterSupportedPaymentTypes(paymentTypes, true)).toEqual(paymentTypes)
  })
})

describe("isApplePayOnlyHidden", () => {
  // The picker's empty state keys on this to name the actual fix (a browser
  // with Apple Pay) instead of reading as a pair with no methods at all.
  it("reports when the capability filter alone emptied the list", () => {
    expect(isApplePayOnlyHidden([paymentType("applepay")], false)).toBe(true)
  })

  it("stays false when other methods survive the filter", () => {
    expect(isApplePayOnlyHidden([paymentType("applepay"), paymentType("creditcard")], false)).toBe(
      false,
    )
  })

  it("stays false when the pair offers no methods at all", () => {
    expect(isApplePayOnlyHidden([], false)).toBe(false)
  })

  it("stays false when Apple Pay is available", () => {
    expect(isApplePayOnlyHidden([paymentType("applepay")], true)).toBe(false)
  })
})

describe("supportsApplePay", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // This vitest environment is node, so the bare call exercises the
  // no-window (SSR) branch.
  it("is false without a window", () => {
    expect(supportsApplePay()).toBe(false)
  })

  it("is false without ApplePaySession (non-WebKit browsers)", () => {
    vi.stubGlobal("window", {})
    expect(supportsApplePay()).toBe(false)
  })

  it("is false when the device reports Apple Pay unavailable", () => {
    vi.stubGlobal("window", { ApplePaySession: { canMakePayments: () => false } })
    expect(supportsApplePay()).toBe(false)
  })

  it("is true when the session API reports Apple Pay available", () => {
    vi.stubGlobal("window", { ApplePaySession: { canMakePayments: () => true } })
    expect(supportsApplePay()).toBe(true)
  })

  // The probe itself can throw (e.g. insecure context); a throwing probe must
  // read as unsupported, not crash the payment-types query.
  it("is false when the probe throws", () => {
    vi.stubGlobal("window", {
      ApplePaySession: {
        canMakePayments: () => {
          throw new DOMException("insecure context")
        },
      },
    })
    expect(supportsApplePay()).toBe(false)
  })
})

describe("maxAggregatedLimit", () => {
  it("takes the widest max across payment types", () => {
    const paymentTypes = [
      paymentType("creditcard", { min: 30, max: 20_000 }),
      paymentType("applepay", { min: 30, max: 11_640 }),
    ]
    expect(maxAggregatedLimit(paymentTypes)).toBe(20_000)
  })

  it("skips entries without a reported max", () => {
    const paymentTypes = [
      paymentType("creditcard"),
      paymentType("applepay", { min: 30 }),
      paymentType("banktransfer", { max: 5_000 }),
    ]
    expect(maxAggregatedLimit(paymentTypes)).toBe(5_000)
  })

  it("returns undefined when no payment type reports a max", () => {
    expect(maxAggregatedLimit([])).toBeUndefined()
    expect(maxAggregatedLimit([paymentType("creditcard")])).toBeUndefined()
  })
})

describe("formatMaxPurchaseLabel", () => {
  it("formats with the fiat symbol and thousands separators", () => {
    expect(formatMaxPurchaseLabel(20_000, "$")).toBe("Up to $20,000")
  })

  it("keeps fractional limits as-is", () => {
    expect(formatMaxPurchaseLabel(11_640.5, "€")).toBe("Up to €11,640.5")
  })

  // Floats with more than 15 significant digits throw under BigNumber strict
  // mode (vitest sets DEBUG) unless stringified first — pins the String(value)
  // guard in formatFiatAmount.
  it("does not throw on a float with more than 15 significant digits", () => {
    expect(formatMaxPurchaseLabel(0.30000000000000004, "$")).toBe("Up to $0.30000000000000004")
  })
})

describe("findAggregatedLimit", () => {
  const paymentTypes = [
    paymentType("creditcard", { min: 30, max: 20_000 }),
    paymentType("applepay"),
  ]

  it("returns the selected payment type's aggregated bounds", () => {
    expect(findAggregatedLimit(paymentTypes, "creditcard")).toEqual({ min: 30, max: 20_000 })
  })

  it("returns undefined when the type is missing or carries no bounds", () => {
    expect(findAggregatedLimit(paymentTypes, "applepay")).toBeUndefined()
    expect(findAggregatedLimit(paymentTypes, "banktransfer")).toBeUndefined()
  })
})

describe("fiatLimitError", () => {
  const limit = { min: 30, max: 20_000 }

  it("reports an amount below the minimum", () => {
    expect(fiatLimitError("10", limit, "$")).toBe("Minimum purchase is $30")
  })

  it("reports an amount above the maximum", () => {
    expect(fiatLimitError("25000", limit, "$")).toBe("Maximum purchase is $20,000")
  })

  // The hub hints the widest bound across payment types ("Up to $56,843"), so
  // the error must name the selected method to explain the smaller bound.
  it("names the selected payment method when provided", () => {
    expect(fiatLimitError("10", limit, "$", "Credit Card")).toBe(
      "Minimum purchase with Credit Card is $30",
    )
    expect(fiatLimitError("25000", limit, "$", "Credit Card")).toBe(
      "Maximum purchase with Credit Card is $20,000",
    )
  })

  it("passes amounts inside the bounds, inclusive", () => {
    expect(fiatLimitError("30", limit, "$")).toBe("")
    expect(fiatLimitError("100", limit, "$")).toBe("")
    expect(fiatLimitError("20000", limit, "$")).toBe("")
  })

  it("stays silent without a positive amount or without bounds", () => {
    expect(fiatLimitError("", limit, "$")).toBe("")
    expect(fiatLimitError("0", limit, "$")).toBe("")
    expect(fiatLimitError("10", undefined, "$")).toBe("")
  })

  it("checks only the bound the API reported", () => {
    expect(fiatLimitError("10", { max: 20_000 }, "$")).toBe("")
    expect(fiatLimitError("25000", { min: 30 }, "$")).toBe("")
  })
})

describe("isBelowRouteMinimum", () => {
  // Mirrors the Deposit API's live config/assets (Ethereum, chain id "1").
  const route = (src_decimals: number, min_deposit_amount: string): Asset => ({
    src_chain_id: "1",
    src_denom: "ethereum-native",
    src_decimals,
    min_deposit_amount,
    max_slippage_percent: "0.5",
    dst_symbol: "ETH",
    dst_networks: [],
  })
  const ETH_ROUTE = route(18, "5000000000000000000") // 5 ETH
  const USDC_ROUTE = route(6, "10000000") // 10 USDC

  it("flags a payout below the bridge minimum", () => {
    expect(isBelowRouteMinimum(4.9, ETH_ROUTE)).toBe(true)
    expect(isBelowRouteMinimum(9.999999, USDC_ROUTE)).toBe(true)
  })

  it("passes a payout at or above the bridge minimum", () => {
    expect(isBelowRouteMinimum(5, ETH_ROUTE)).toBe(false)
    expect(isBelowRouteMinimum(5.1, ETH_ROUTE)).toBe(false)
    expect(isBelowRouteMinimum(10, USDC_ROUTE)).toBe(false)
  })
})

describe("assertOnramperSupported", () => {
  const USD: OnramperFiat = { id: "usd", code: "USD", name: "US Dollar", symbol: "$", icon: "" }

  it("passes a populated response through", () => {
    const message = { fiat: [USD], crypto: CRYPTOS }
    expect(assertOnramperSupported(message)).toBe(message)
  })

  // Onramper answers 200 with empty lists for an invalid API key (and for a
  // prod key against staging) — the misconfiguration signal. A single empty
  // list is equally unusable for the cash path, so either one throws.
  it("throws when either list is empty", () => {
    expect(() => assertOnramperSupported({ fiat: [], crypto: [] })).toThrow(/misconfigured/)
    expect(() => assertOnramperSupported({ fiat: [USD], crypto: [] })).toThrow(/misconfigured/)
    expect(() => assertOnramperSupported({ fiat: [], crypto: CRYPTOS })).toThrow(/misconfigured/)
  })
})

describe("resolveFiatAnchor", () => {
  const fiat = (id: string, code: string): OnramperFiat => ({
    id,
    code,
    name: code,
    symbol: "",
    icon: "",
  })
  const USD = fiat("usd", "USD")
  const THB = fiat("thb", "THB")
  const KRW = fiat("krw", "KRW")
  const FIATS = [USD, THB, KRW]
  const candidates = (overrides: {
    persistedId?: string | null
    recommendedCode?: string | null
  }) => ({
    persistedId: null,
    recommendedCode: null,
    defaultId: "usd",
    ...overrides,
  })

  it("prefers the user's remembered pick over the recommendation", () => {
    expect(
      resolveFiatAnchor(FIATS, candidates({ persistedId: "thb", recommendedCode: "KRW" })),
    ).toBe(THB)
  })

  it("falls back to the geolocated recommendation without a remembered pick", () => {
    expect(resolveFiatAnchor(FIATS, candidates({ recommendedCode: "KRW" }))).toBe(KRW)
  })

  // The recommendation carries an uppercase CODE while list entries are keyed
  // by lowercase id; the match must bridge the namespaces either way.
  it("matches the recommendation case-insensitively by code or id", () => {
    expect(resolveFiatAnchor(FIATS, candidates({ recommendedCode: "thb" }))).toBe(THB)
    const desynced = fiat("krw", "WON")
    expect(resolveFiatAnchor([desynced], candidates({ recommendedCode: "KRW" }))).toBe(desynced)
  })

  // byCode runs two passes (all codes, then all ids): an id match on an
  // earlier entry must not shadow an exact code match on a later one.
  it("prefers an exact code match over an earlier entry's id match", () => {
    const idOnlyMatch = fiat("thb", "XXX")
    const codeMatch = fiat("xyz", "THB")
    expect(
      resolveFiatAnchor([idOnlyMatch, codeMatch], candidates({ recommendedCode: "THB" })),
    ).toBe(codeMatch)
  })

  it("skips an unlisted remembered pick in favor of the recommendation", () => {
    expect(
      resolveFiatAnchor(FIATS, candidates({ persistedId: "xyz", recommendedCode: "THB" })),
    ).toBe(THB)
  })

  it("falls back to the default currency without any candidate", () => {
    expect(resolveFiatAnchor(FIATS, candidates({}))).toBe(USD)
    expect(resolveFiatAnchor(FIATS, candidates({ recommendedCode: "XYZ" }))).toBe(USD)
  })

  it("falls back to the first listed fiat when even the default is unlisted", () => {
    expect(resolveFiatAnchor([THB, KRW], candidates({ recommendedCode: "XYZ" }))).toBe(THB)
  })
})

describe("assertCheckoutUrl", () => {
  it("passes an https hand-off url", () => {
    expect(() => assertCheckoutUrl("https://buy.onramper.com/?sessionId=abc")).not.toThrow()
  })

  // The url comes from an external API and is navigated to with funds in play,
  // so every non-https scheme fails loudly instead of being opened.
  it("rejects non-https schemes", () => {
    expect(() => assertCheckoutUrl("http://buy.onramper.com")).toThrow(/Unexpected checkout URL/)
    expect(() => assertCheckoutUrl("javascript:alert(1)")).toThrow(/Unexpected checkout URL/)
    expect(() => assertCheckoutUrl("data:text/html,<script>1</script>")).toThrow(
      /Unexpected checkout URL/,
    )
  })

  it("rejects an unparseable url", () => {
    expect(() => assertCheckoutUrl("")).toThrow(/Unexpected checkout URL/)
    expect(() => assertCheckoutUrl("not a url")).toThrow(/Unexpected checkout URL/)
  })
})
