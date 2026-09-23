import { describe, expect, it } from "vitest"
import { InitiaAddress } from "@initia/utils"
import { POPUP_BLOCKED_MESSAGE, USER_REJECTED_MESSAGE } from "@/data/http"
import type { QuoteResult } from "../data/quote"
import { DEPOSIT_ADDRESS } from "../data/testing"
import type {
  BridgeOption,
  BridgeQuoteResponse,
  BridgeQuoteTransaction,
  QuoteResponse,
} from "../data/types"
import {
  buildDepositTransaction,
  combineEstimatedSeconds,
  deliverySeconds,
  type DepositReadiness,
  type DepositReadinessInput,
  deriveDepositReadiness,
  derivePreflight,
  formatNetworkFee,
  gteInteger,
  isProvablyNotSent,
  isQuoteBoundToOptions,
  isQuoteStale,
  nextAutoDepositStep,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
  SESSION_IN_FLIGHT_MESSAGE,
  STORAGE_BLOCKED_MESSAGE,
  toBaseUnitString,
  UNKNOWN_SEND_MESSAGE,
} from "./depositTransferLogic"
import { buildDestinationNetwork } from "./testing"

const INITIA_ADDRESS = "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs"
const OTHER_ADDRESS = "init1prdwrp2kwss8lg854u08vya6uw8t9mldsqchdv"

function option(overrides: Partial<BridgeOption> & { bridge: string }): BridgeOption {
  return { amount_out: "1000000", min_received: "990000", eligible: true, ...overrides }
}

describe("resolveDepositRecipient", () => {
  const hex = InitiaAddress(INITIA_ADDRESS).hex.toUpperCase().replace("0X", "0x")

  it.each<[string, string | undefined, string, ReturnType<typeof resolveDepositRecipient>]>([
    ["prefers the host recipient", OTHER_ADDRESS, INITIA_ADDRESS, { recipient: OTHER_ADDRESS }],
    ["falls back to the wallet", undefined, INITIA_ADDRESS, { recipient: INITIA_ADDRESS }],
    ["normalizes hex to lowercase bech32", hex, OTHER_ADDRESS, { recipient: INITIA_ADDRESS }],
    [
      "never credits the wallet for an invalid host recipient",
      "not-an-address",
      INITIA_ADDRESS,
      { error: expect.stringContaining("not-an-address") },
    ],
    ["needs a wallet", undefined, "", { error: "Connect a wallet to continue" }],
    [
      "reports an unreadable wallet address",
      undefined,
      "not-an-address",
      { error: "Could not resolve the receiving address" },
    ],
  ])("%s", (_, host, wallet, expected) => {
    expect(resolveDepositRecipient(host, wallet)).toEqual(expected)
  })
})

describe("selectBridgeOption", () => {
  const ranked = [
    option({ bridge: "across" }),
    option({ bridge: "cctp", min_received: "980000" }),
    option({ bridge: "mayan", eligible: false }),
  ]

  it("defaults to the first eligible option", () => {
    expect(selectBridgeOption(ranked, "")).toEqual({
      option: ranked[0],
      clearSelection: false,
    })
  })

  it("honors an eligible user selection, case-insensitively", () => {
    expect(selectBridgeOption(ranked, "CCTP")).toEqual({
      option: ranked[1],
      clearSelection: false,
    })
  })

  it("falls back and clears when the selection went ineligible", () => {
    expect(selectBridgeOption(ranked, "mayan")).toEqual({
      option: ranked[0],
      clearSelection: true,
    })
  })

  it("keeps the selection while no options have loaded", () => {
    expect(selectBridgeOption([], "across")).toEqual({
      option: undefined,
      clearSelection: false,
    })
  })
})

describe("isQuoteBoundToOptions", () => {
  it.each([
    [
      "binds the same address in another case",
      DEPOSIT_ADDRESS.toLowerCase(),
      DEPOSIT_ADDRESS,
      true,
    ],
    [
      "rejects a different address",
      "0x2222222222222222222222222222222222222222",
      DEPOSIT_ADDRESS,
      false,
    ],
    ["is unbound without a quote address", undefined, DEPOSIT_ADDRESS, false],
    ["is unbound without an options address", DEPOSIT_ADDRESS, undefined, false],
  ])("%s", (_, quoteAddress, optionsAddress, expected) => {
    expect(isQuoteBoundToOptions(quoteAddress, optionsAddress)).toBe(expected)
  })
})

describe("isQuoteStale", () => {
  const now = 1_000_000

  it.each([
    ["a never-fetched quote is stale", 0, true],
    ["a quote exactly 10 s old is fresh", now - 10_000, false],
    ["a quote past 10 s is stale", now - 10_001, true],
  ])("%s", (_, updatedAt, expected) => {
    expect(isQuoteStale(updatedAt, now)).toBe(expected)
  })
})

describe("gteInteger", () => {
  it("compares integer base units", () => {
    expect(gteInteger("1000000", "1000000")).toBe(true)
    expect(gteInteger("999999", "1000000")).toBe(false)
  })

  it("fails closed on an unknown or malformed value", () => {
    expect(gteInteger(undefined, "1")).toBe(false)
    expect(gteInteger("", "1000000")).toBe(false)
    expect(gteInteger("1.5", "1000000")).toBe(false)
  })
})

describe("toBaseUnitString", () => {
  it.each([
    ["1.234567", "1234567"],
    ["1.2345678", "1234567"],
    ["-1", ""],
    ["abc", ""],
  ])("%s → %j", (quantity, expected) => {
    expect(toBaseUnitString(quantity, 6)).toBe(expected)
  })
})

describe("formatNetworkFee", () => {
  it.each([
    [undefined, "Shown in wallet"],
    ["abc", "Shown in wallet"],
    ["0", "$0.00"],
    ["0.0004", "$0.0004"],
    ["0.42", "$0.42"],
  ])("%s → %s", (gasCostUsd, expected) => {
    expect(formatNetworkFee(gasCostUsd)).toBe(expected)
  })
})

describe("combineEstimatedSeconds", () => {
  it.each([
    [[120, 60], 180],
    [[0, 60], 60],
    [[120, undefined], undefined],
    [[null, 60], undefined],
  ])("%j → %s", (parts, expected) => {
    expect(combineEstimatedSeconds(parts)).toBe(expected)
  })
})

describe("deliverySeconds", () => {
  const destination = buildDestinationNetwork({ processing_time_seconds: 360 })
  const quote = (delivery?: QuoteResponse["delivery"]): QuoteResponse => ({
    amount_out: "5000000",
    min_received: "4975000",
    delivery,
  })

  it.each<[string, QuoteResponse | undefined, number | undefined, number | null | undefined]>([
    ["uses the delivery prediction", quote({ method: "advance", estimated_seconds: 60 }), 360, 60],
    [
      "falls back on a null prediction",
      quote({ method: "standard", estimated_seconds: null }),
      360,
      360,
    ],
    ["falls back when the backend sends no delivery", quote(), 360, 360],
    ["is unknown when neither source has one", quote(), undefined, undefined],
    ["is unknown until quoted", undefined, 360, undefined],
  ])("%s", (_, input, processingSeconds, expected) => {
    expect(
      deliverySeconds(input, { ...destination, processing_time_seconds: processingSeconds }),
    ).toBe(expected)
  })
})

describe("buildDepositTransaction", () => {
  const ROUTER = "0x4444444444444444444444444444444444444444"
  const quote = (transaction: Partial<BridgeQuoteTransaction>) =>
    ({
      transaction: {
        chain_id: "8453",
        from: "0x3333333333333333333333333333333333333333",
        to: ROUTER,
        data: "0xdeadbeef",
        value: "1500",
        ...transaction,
      },
    }) as BridgeQuoteResponse
  const call = { chainId: "8453", to: ROUTER, data: "0xdeadbeef", value: "1500" }

  it.each([
    ["with its gas limit", { gas_limit: "210000" }, { ...call, gasLimit: "210000" }],
    ["leaving gas to the wallet when none is quoted", {}, call],
  ])("passes the LI.FI call through verbatim, %s", (_, transaction, expected) => {
    expect(buildDepositTransaction({ transport: "lifi", quote: quote(transaction) })).toEqual(
      expected,
    )
  })

  it("sends one Ethereum USDC transfer to the issued address with gas for a fresh slot", () => {
    const tx = buildDepositTransaction({
      transport: "direct",
      depositAddress: DEPOSIT_ADDRESS,
      amount: "1000000",
    })
    expect(tx).toMatchObject({
      chainId: "1",
      to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      value: "0",
      data:
        "0xa9059cbb" +
        "000000000000000000000000abcd000000000000000000000000000000000001" +
        "00000000000000000000000000000000000000000000000000000000000f4240",
    })
    expect(BigInt(tx.gasLimit ?? 0)).toBeGreaterThanOrEqual(65_000n)
  })
})

describe("sendTransactionHashOf", () => {
  const hash = "0x" + "ab".repeat(32)
  it("adopts the hash ethers attaches to a failed post-send read", () => {
    expect(sendTransactionHashOf({ info: { sendTransactionHash: hash } })).toBe(hash)
  })
  it("ignores errors without a valid hash", () => {
    expect(sendTransactionHashOf(new Error("timeout"))).toBeUndefined()
    expect(sendTransactionHashOf({ info: { sendTransactionHash: "0x12" } })).toBeUndefined()
    expect(sendTransactionHashOf(null)).toBeUndefined()
  })
})

describe("isProvablyNotSent", () => {
  it.each([
    [USER_REJECTED_MESSAGE, true],
    [POPUP_BLOCKED_MESSAGE, true],
    ["Insufficient funds for gas * price + value", true],
    ["intrinsic gas too low", true],
    ["network error", false],
    ["nonce too low", false],
    ["replacement underpriced", false],
  ])("%s → %s", (message, expected) => {
    expect(isProvablyNotSent(message)).toBe(expected)
  })
})

describe("requiredNativeAmount", () => {
  it("adds priced gas to the call value only when both are known", () => {
    expect(requiredNativeAmount({ value: "669", gasLimit: "10", maxFeePerGas: "2" })).toBe("689")
    expect(requiredNativeAmount({ value: "669", gasLimit: "10" })).toBe("669")
    expect(requiredNativeAmount({ value: undefined })).toBeUndefined()
    expect(requiredNativeAmount({ value: "0", gasLimit: "10", maxFeePerGas: "2" })).toBe("20")
  })
})

describe("derivePreflight", () => {
  const quoted: QuoteResult = { status: "quoted", quote: { amount_out: "1", min_received: "1" } }
  const declined: QuoteResult = { status: "declined", reason: "Amount too small" }
  const settled: Parameters<typeof derivePreflight>[0] = {
    amountIn: "1000",
    hasError: false,
    result: quoted,
    isPlaceholderData: false,
  }

  it.each<[string, Partial<typeof settled>, ReturnType<typeof derivePreflight>]>([
    ["quoted once the verdict settles", {}, { status: "quoted" }],
    [
      "idle without an amount, even after a failure",
      { amountIn: "", hasError: true },
      { status: "idle" },
    ],
    ["error on a failed read", { hasError: true }, { status: "error" }],
    ["loading before any verdict", { result: undefined }, { status: "loading" }],
    [
      "loading while the previous amount's verdict is held",
      { result: declined, isPlaceholderData: true },
      { status: "loading" },
    ],
    ["declined with the backend reason", { result: declined }, declined],
  ])("%s", (_, overrides, expected) => {
    expect(derivePreflight({ ...settled, ...overrides })).toEqual(expected)
  })
})

describe("deriveDepositReadiness", () => {
  const ready: DepositReadinessInput = {
    transport: "lifi",
    unknownSend: false,
    sessionInFlight: false,
    storageBlocked: false,
    quantityEntered: true,
    amount: "1000000",
    isAmountSettled: true,
    balancesError: false,
    tokenBalance: "5000000",
    nativeBalance: "10000000000000000",
    sourceChainLoaded: true,
    hasOptions: true,
    hasEligibleOption: true,
    hasQuote: true,
    quoteBound: true,
    isRefreshing: false,
    meetsMinimum: true,
    minimumLabel: "1 USDC",
    approvalChecking: false,
    hasDepositAddress: true,
    preflight: "quoted",
  }
  const blocked = (message: string, level: DepositReadiness["level"] = "error") => ({
    status: "blocked" as const,
    message,
    level,
  })
  const loading = (message?: string) => ({ status: "loading" as const, message })
  const ROUTE_MINIMUM =
    "This route would deliver less than 1 USDC to Ethereum. Try a larger amount or another route."
  const PREFLIGHT_ERROR = "Could not verify the destination estimate"

  it.each<[string, Partial<DepositReadinessInput>, DepositReadiness]>([
    ["ready when every gate passes", {}, { status: "ready" }],
    ["an ambiguous send", { unknownSend: true }, blocked(UNKNOWN_SEND_MESSAGE)],
    ["a session in flight", { sessionInFlight: true }, blocked(SESSION_IN_FLIGHT_MESSAGE)],
    ["unwritable storage", { storageBlocked: true }, blocked(STORAGE_BLOCKED_MESSAGE)],
    ["an invalid host recipient", { recipientError: "Bad recipient" }, blocked("Bad recipient")],
    ["no amount", { quantityEntered: false }, blocked("Enter amount", "info")],
    ["an unusable amount", { amount: "" }, blocked("Enter a valid amount", "info")],
    ["an unsettled amount", { isAmountSettled: false }, loading("Updating amount...")],
    ["a failed balance read", { balancesError: true }, blocked("Failed to load balance")],
    ["an unread balance", { tokenBalance: undefined }, loading("Loading balance...")],
    ["a short balance", { tokenBalance: "999999" }, blocked("Insufficient balance", "info")],
    ["no ETH", { nativeBalance: "0" }, blocked("Not enough ETH for gas")],
    [
      "ETH short of the call's value plus gas",
      { nativeBalance: "668", requiredNative: "669" },
      blocked("Not enough ETH for this route's fee and gas"),
    ],
    [
      "ETH exactly covering value plus gas",
      { nativeBalance: "669", requiredNative: "669" },
      { status: "ready" },
    ],
    ["an unread head block or nonce", { sourceChainLoaded: false }, loading()],
    ["a failed routes read", { optionsError: "Routes failed" }, blocked("Routes failed")],
    ["unread routes", { hasOptions: false }, loading("Finding routes...")],
    [
      "no eligible route",
      { hasEligibleOption: false },
      blocked("No route can bring at least 1 USDC to Ethereum after fees. Try a larger amount."),
    ],
    ["a failed quote", { quoteError: "Quote failed" }, blocked("Quote failed")],
    ["no quote yet", { hasQuote: false }, loading("Fetching quote...")],
    [
      "an unbound quote being re-read",
      { quoteBound: false, isRefreshing: true },
      loading("Refreshing quote..."),
    ],
    [
      "an unbound quote",
      { quoteBound: false },
      blocked("The issued deposit address changed. Change the amount or route for a fresh quote."),
    ],
    ["a route below the minimum", { meetsMinimum: false }, blocked(ROUTE_MINIMUM)],
    [
      "a direct amount below the minimum",
      { transport: "direct", meetsMinimum: false },
      blocked("Enter at least 1 USDC", "info"),
    ],
    [
      "a failed deposit address",
      { transport: "direct", depositAddressError: "Address failed" },
      blocked("Address failed"),
    ],
    [
      "an unissued deposit address",
      { transport: "direct", hasDepositAddress: false },
      loading("Preparing deposit address..."),
    ],
    [
      "a declined preflight, verbatim",
      { preflight: "declined", preflightReason: "amount below minimum" },
      blocked("amount below minimum"),
    ],
    [
      "a declined preflight without a reason",
      { preflight: "declined" },
      blocked("This deposit cannot be quoted right now"),
    ],
    ["a failed preflight", { preflight: "error" }, blocked(PREFLIGHT_ERROR)],
    ["a pending preflight", { preflight: "loading" }, loading("Checking destination...")],
    ["an idle preflight", { preflight: "idle" }, loading("Checking destination...")],
    ["a failed allowance read", { approvalError: "Allowance failed" }, blocked("Allowance failed")],
    ["an allowance recheck", { approvalChecking: true }, loading("Checking approvals...")],
    [
      "direct ignoring LI.FI state",
      {
        transport: "direct",
        optionsError: "Routes failed",
        hasOptions: false,
        hasEligibleOption: false,
        quoteError: "Quote failed",
        hasQuote: false,
        quoteBound: false,
      },
      { status: "ready" },
    ],
    [
      "LI.FI ignoring the direct address state",
      { depositAddressError: "Address failed", hasDepositAddress: false },
      { status: "ready" },
    ],
    [
      "an ambiguous send over every other state",
      {
        unknownSend: true,
        sessionInFlight: true,
        storageBlocked: true,
        quantityEntered: false,
        tokenBalance: undefined,
      },
      blocked(UNKNOWN_SEND_MESSAGE),
    ],
    [
      "a session in flight over unwritable storage",
      { sessionInFlight: true, storageBlocked: true },
      blocked(SESSION_IN_FLIGHT_MESSAGE),
    ],
    [
      "an invalid recipient over a missing amount",
      { recipientError: "Bad recipient", quantityEntered: false },
      blocked("Bad recipient"),
    ],
    [
      "a short balance over chain and route loading",
      { tokenBalance: "999999", sourceChainLoaded: false, hasOptions: false },
      blocked("Insufficient balance", "info"),
    ],
    [
      "the route minimum over the preflight",
      { meetsMinimum: false, preflight: "declined" },
      blocked(ROUTE_MINIMUM),
    ],
    [
      "the preflight over the allowance",
      { preflight: "error", approvalError: "Allowance failed" },
      blocked(PREFLIGHT_ERROR),
    ],
  ])("%s", (_, overrides, expected) => {
    expect(deriveDepositReadiness({ ...ready, ...overrides })).toEqual(expected)
  })
})

describe("nextAutoDepositStep", () => {
  const settled = {
    approved: true,
    inputsChanged: false,
    readiness: "ready",
    approvalRequired: false,
    quoteChanged: false,
  } as const

  it.each([
    ["sends once approved on unchanged inputs and quote", {}, "send"],
    ["waits for the approval", { approved: false }, "wait"],
    [
      "waits while readiness loads, before trusting a stale allowance",
      { readiness: "loading", approvalRequired: true },
      "wait",
    ],
    ["cancels when an input changed", { inputsChanged: true, approved: false }, "cancel"],
    ["cancels when readiness is blocked", { readiness: "blocked" }, "cancel"],
    [
      "cancels rather than reviews when the allowance still falls short",
      { approvalRequired: true, quoteChanged: true },
      "cancel",
    ],
    ["asks for review when the quote changed", { quoteChanged: true }, "review"],
  ] as const)("%s", (_, overrides, expected) => {
    expect(nextAutoDepositStep({ ...settled, ...overrides })).toBe(expected)
  })
})
