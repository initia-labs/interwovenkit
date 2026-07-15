import { describe, expect, it } from "vitest"
import type { Asset } from "../data/types"
import type { OnramperCrypto, OnramperQuote } from "./data/onramperTypes"
import type { DeriveOnrampQuoteParams } from "./quote"
import { deriveOnrampQuote } from "./quote"

// Mirrors the Deposit API's live config/assets (USDC on Ethereum, 10 USDC
// minimum in base units).
const USDC_ROUTE: Asset = {
  src_chain_id: "1",
  src_denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  src_decimals: 6,
  min_deposit_amount: "10000000",
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [],
}

const USDC_CRYPTO: OnramperCrypto = {
  id: "usdc_ethereum",
  code: "USDC",
  name: "USD Coin",
  symbol: "USDC",
  network: "ethereum",
  decimals: 6,
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  chainId: 1,
  icon: "",
  networkDisplayName: "Ethereum",
}

const SOURCE_ROUTE = { route: USDC_ROUTE, crypto: USDC_CRYPTO }

const offer = (
  ramp: string,
  payout: number,
  overrides?: Partial<OnramperQuote>,
): OnramperQuote => ({
  ramp,
  paymentMethod: "creditcard",
  rate: 1,
  networkFee: 0,
  payout,
  ...overrides,
})

const errorEntry = (message: string, errorId?: number): OnramperQuote => ({
  paymentMethod: "creditcard",
  rate: 0,
  networkFee: 0,
  errors: [{ message, errorId }],
})

const params = (overrides: Partial<DeriveOnrampQuoteParams>): DeriveOnrampQuoteParams => ({
  sourceCryptoId: "usdc_ethereum",
  sourceRoute: SOURCE_ROUTE,
  fiatAmount: "100",
  limitError: "",
  quotes: { isError: false, data: [offer("moonpay", 99)], errorMessage: "" },
  providerId: "",
  receiveSymbol: "iUSD",
  fiat: "USD",
  ...overrides,
})

describe("deriveOnrampQuote", () => {
  // The gates are ordered from the broadest inward; each case fixes one gate
  // firing even when every later gate's input is present.
  it("is unsupported without a source route, even with an amount and quotes", () => {
    expect(deriveOnrampQuote(params({ sourceRoute: null }))).toEqual({
      sourceCryptoId: "usdc_ethereum",
      status: "unsupported",
    })
  })

  it("is idle without a positive amount", () => {
    for (const fiatAmount of ["", "0", "-1"]) {
      expect(deriveOnrampQuote(params({ fiatAmount })).status).toBe("idle")
    }
  })

  it("surfaces a fiat-limit error before touching quote state", () => {
    const quote = deriveOnrampQuote(params({ limitError: "Minimum purchase is $30" }))
    expect(quote).toMatchObject({ status: "limit-error", message: "Minimum purchase is $30" })
  })

  it("is an error only when the fetch failed with nothing cached", () => {
    const quote = deriveOnrampQuote(
      params({ quotes: { isError: true, data: undefined, errorMessage: "rate limited" } }),
    )
    expect(quote).toMatchObject({ status: "error", message: "rate limited" })
  })

  // A transient refetch failure must not blank a workable form: cached quotes
  // keep rendering until the next successful refresh.
  it("keeps rendering stale quotes when a refetch fails with data cached", () => {
    const quote = deriveOnrampQuote(
      params({ quotes: { isError: true, data: [offer("moonpay", 99)], errorMessage: "down" } }),
    )
    expect(quote.status).toBe("quoted")
  })

  it("is loading while nothing is fetched and nothing failed", () => {
    const quote = deriveOnrampQuote(
      params({ quotes: { isError: false, data: undefined, errorMessage: "" } }),
    )
    expect(quote.status).toBe("loading")
  })

  // Reason selection itself (6101 preference, generic fallback) is covered by
  // the quotesErrorMessage tests; here only the wiring into the variant matters.
  it("is no-offers when providers returned only error entries, with their reason", () => {
    const quote = deriveOnrampQuote(
      params({
        quotes: { isError: false, data: [errorEntry("Amount too small", 6101)], errorMessage: "" },
      }),
    )
    expect(quote).toMatchObject({ status: "no-offers", reason: "Amount too small" })
  })

  it("selects the requested provider and falls back to the best payout", () => {
    const quotes = {
      isError: false,
      data: [offer("moonpay", 98), offer("banxa", 99)],
      errorMessage: "",
    }
    const picked = deriveOnrampQuote(params({ quotes, providerId: "moonpay" }))
    const fallback = deriveOnrampQuote(params({ quotes, providerId: "gone" }))
    if (picked.status !== "quoted" || fallback.status !== "quoted") throw new Error("not quoted")
    expect(picked.selected.ramp).toBe("moonpay")
    expect(fallback.selected.ramp).toBe("banxa")
    expect(fallback.ranked.map((entry) => entry.ramp)).toEqual(["banxa", "moonpay"])
  })

  // 9.99 USDC payout < the 10 USDC bridge minimum: payment would clear but the
  // bridge would strand the funds (no refund), so the flag must trip.
  it("flags a payout below the bridge minimum", () => {
    const below = deriveOnrampQuote(
      params({ quotes: { isError: false, data: [offer("moonpay", 9.99)], errorMessage: "" } }),
    )
    const at = deriveOnrampQuote(
      params({ quotes: { isError: false, data: [offer("moonpay", 10)], errorMessage: "" } }),
    )
    if (below.status !== "quoted" || at.status !== "quoted") throw new Error("not quoted")
    expect(below.belowRouteMinimum).toBe(true)
    expect(below.routeMinimumLabel).toBe("10 USDC")
    expect(at.belowRouteMinimum).toBe(false)
  })

  it("formats the quoted labels", () => {
    const quote = deriveOnrampQuote(
      params({
        quotes: {
          isError: false,
          data: [offer("moonpay", 99.38, { rate: 1.23, transactionFee: 3, networkFee: 1.5 })],
          errorMessage: "",
        },
      }),
    )
    if (quote.status !== "quoted") throw new Error("not quoted")
    expect(quote.receiveAmount).toBe("99.380000")
    expect(quote.estimatedPriceLabel).toBe("1 iUSD ≈ 1.23 USD")
    expect(quote.feeLabel).toBe("4.50 USD")
  })
})
