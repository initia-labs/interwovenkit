import { describe, expect, it } from "vitest"
import { InitiaAddress } from "@initia/utils"
import { BRIDGE_QUOTE_MAX_AGE } from "../data/bridges"
import type { BridgeOption, BridgeQuoteResponse } from "../data/types"
import {
  buildDepositTransaction,
  combineEstimatedSeconds,
  coversAmount,
  type DepositReadinessInput,
  deriveDepositReadiness,
  derivePreflight,
  deriveQuoteAcknowledgement,
  directDepositSignature,
  formatNetworkFee,
  isKnownNotSent,
  isQuoteBoundToOptions,
  isQuoteStale,
  isWalletRejection,
  meetsDirectMinimum,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
  SESSION_IN_FLIGHT_MESSAGE,
  STORAGE_BLOCKED_MESSAGE,
  UNKNOWN_SEND_MESSAGE,
} from "./depositTransferLogic"

const INITIA_ADDRESS = "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs"
const OTHER_ADDRESS = "init1prdwrp2kwss8lg854u08vya6uw8t9mldsqchdv"
const DEPOSIT_ADDRESS = "0x1111111111111111111111111111111111111111"

function option(overrides: Partial<BridgeOption> & { bridge: string }): BridgeOption {
  return { amount_out: "1000000", min_received: "990000", eligible: true, ...overrides }
}

describe("resolveDepositRecipient", () => {
  it("prefers the host recipient over the connected wallet", () => {
    expect(resolveDepositRecipient(OTHER_ADDRESS, INITIA_ADDRESS)).toEqual({
      recipient: OTHER_ADDRESS,
    })
  })

  it("falls back to the connected wallet when the host set none", () => {
    expect(resolveDepositRecipient(undefined, INITIA_ADDRESS)).toEqual({
      recipient: INITIA_ADDRESS,
    })
  })

  it("normalizes a hex host recipient to lowercase bech32", () => {
    const hex = InitiaAddress(INITIA_ADDRESS).hex
    const resolved = resolveDepositRecipient(hex.toUpperCase().replace("0X", "0x"), INITIA_ADDRESS)
    expect(resolved).toEqual({ recipient: INITIA_ADDRESS })
  })

  it("blocks on an invalid host recipient instead of crediting the connected wallet", () => {
    const resolved = resolveDepositRecipient("not-an-address", INITIA_ADDRESS)
    expect(resolved).toEqual({ error: expect.stringContaining("not-an-address") })
  })

  it("reports a missing wallet rather than an empty recipient", () => {
    expect(resolveDepositRecipient(undefined, "")).toEqual({
      error: "Connect a wallet to continue",
    })
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
  it("binds on the issued address, case-insensitively", () => {
    expect(isQuoteBoundToOptions(DEPOSIT_ADDRESS.toUpperCase(), DEPOSIT_ADDRESS)).toBe(true)
  })

  it("rejects a quote issued against a different address", () => {
    expect(
      isQuoteBoundToOptions("0x2222222222222222222222222222222222222222", DEPOSIT_ADDRESS),
    ).toBe(false)
  })

  it("is unbound when either side is missing", () => {
    expect(isQuoteBoundToOptions(undefined, DEPOSIT_ADDRESS)).toBe(false)
    expect(isQuoteBoundToOptions(DEPOSIT_ADDRESS, undefined)).toBe(false)
  })
})

describe("isQuoteStale", () => {
  it("treats a never-fetched quote as stale", () => {
    expect(isQuoteStale(0, 1_000)).toBe(true)
  })

  it("holds the quote fresh inside the window and stale past it", () => {
    const now = 1_000_000
    expect(isQuoteStale(now - BRIDGE_QUOTE_MAX_AGE, now)).toBe(false)
    expect(isQuoteStale(now - BRIDGE_QUOTE_MAX_AGE - 1, now)).toBe(true)
  })
})

describe("minimum and balance gates", () => {
  it("compares the direct amount against the live route minimum", () => {
    expect(meetsDirectMinimum("1000000", "1000000")).toBe(true)
    expect(meetsDirectMinimum("999999", "1000000")).toBe(false)
  })

  it("fails closed on unparseable amounts", () => {
    expect(meetsDirectMinimum("", "1000000")).toBe(false)
    expect(meetsDirectMinimum("1.5", "1000000")).toBe(false)
  })

  it("keeps an unknown balance from covering anything", () => {
    expect(coversAmount(undefined, "1")).toBe(false)
    expect(coversAmount("1000000", "1000000")).toBe(true)
    expect(coversAmount("999999", "1000000")).toBe(false)
  })
})

describe("deriveQuoteAcknowledgement", () => {
  const identityKey = "8453:1000000:across"

  it("records the reviewed signature once the form is reviewable", () => {
    const result = deriveQuoteAcknowledgement({
      acknowledgement: null,
      identityKey,
      signature: "sig-a",
      isReviewable: true,
    })
    expect(result).toEqual({ next: { identityKey, signature: "sig-a" }, quoteUpdated: false })
  })

  it("does not record anything before the form is reviewable", () => {
    const result = deriveQuoteAcknowledgement({
      acknowledgement: null,
      identityKey,
      signature: "sig-a",
      isReviewable: false,
    })
    expect(result).toEqual({ next: null, quoteUpdated: false })
  })

  it("flags a changed signature as an updated quote", () => {
    const result = deriveQuoteAcknowledgement({
      acknowledgement: { identityKey, signature: "sig-a" },
      identityKey,
      signature: "sig-b",
      isReviewable: true,
    })
    expect(result.quoteUpdated).toBe(true)
  })

  it("resets instead of re-confirming when the request identity changed", () => {
    const result = deriveQuoteAcknowledgement({
      acknowledgement: { identityKey, signature: "sig-a" },
      identityKey: "8453:2000000:across",
      signature: "sig-b",
      isReviewable: true,
    })
    expect(result).toEqual({ next: null, quoteUpdated: false })
  })
})

describe("formatNetworkFee", () => {
  it("shows an unknown estimate as wallet-priced, never as zero", () => {
    expect(formatNetworkFee(undefined)).toBe("Shown in wallet")
    expect(formatNetworkFee("")).toBe("Shown in wallet")
  })

  it("formats a known estimate", () => {
    expect(formatNetworkFee("0.42")).toBe("$0.42")
    expect(formatNetworkFee("0.0004")).toBe("$0.0004")
    expect(formatNetworkFee("0")).toBe("$0.00")
  })

  it("rejects malformed values rather than rendering NaN", () => {
    expect(formatNetworkFee("abc")).toBe("Shown in wallet")
  })
})

describe("combineEstimatedSeconds", () => {
  it("sums known legs", () => {
    expect(combineEstimatedSeconds([120, 60])).toBe(180)
  })

  it("is unknown when any leg is unknown", () => {
    expect(combineEstimatedSeconds([120, undefined])).toBeUndefined()
    expect(combineEstimatedSeconds([undefined])).toBeUndefined()
  })
})

describe("buildDepositTransaction", () => {
  it("preserves the LI.FI calldata and nonzero value verbatim", () => {
    const quote = {
      transaction: {
        chain_id: "8453",
        from: "0x3333333333333333333333333333333333333333",
        to: "0x4444444444444444444444444444444444444444",
        data: "0xdeadbeef",
        value: "1500",
        gas_limit: "210000",
      },
    } as BridgeQuoteResponse
    expect(buildDepositTransaction({ transport: "lifi", quote })).toEqual({
      chainId: "8453",
      to: "0x4444444444444444444444444444444444444444",
      data: "0xdeadbeef",
      value: "1500",
      gasLimit: "210000",
    })
  })

  it("builds one canonical Ethereum USDC transfer for the direct path", () => {
    const tx = buildDepositTransaction({
      transport: "direct",
      depositAddress: DEPOSIT_ADDRESS,
      amount: "1000000",
    })
    expect(tx.chainId).toBe("1")
    expect(tx.to).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
    expect(tx.value).toBe("0")
    // Fixed headroom over the wallet's estimate; see DIRECT_TRANSFER_GAS_LIMIT.
    expect(tx.gasLimit).toBe("90000")
    // transfer(address,uint256) selector + padded recipient + padded amount
    expect(tx.data).toBe(
      "0xa9059cbb" +
        "0000000000000000000000001111111111111111111111111111111111111111" +
        "00000000000000000000000000000000000000000000000000000000000f4240",
    )
  })
})

describe("directDepositSignature", () => {
  const base = {
    depositAddress: DEPOSIT_ADDRESS,
    amount: "1000000",
    recipient: INITIA_ADDRESS,
    dstChainId: "interwoven-1",
    dstDenom: "l2/iusd",
  }

  it("is stable across address casing", () => {
    expect(directDepositSignature({ ...base, depositAddress: DEPOSIT_ADDRESS.toUpperCase() })).toBe(
      directDepositSignature(base),
    )
  })

  it("changes when the issued address or amount changes", () => {
    expect(directDepositSignature({ ...base, amount: "2000000" })).not.toBe(
      directDepositSignature(base),
    )
  })

  it("is empty until an address is issued", () => {
    expect(directDepositSignature({ ...base, depositAddress: "" })).toBe("")
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

describe("readiness amount settlement", () => {
  it("waits for the debounced amount to match the typed one", () => {
    const view = deriveDepositReadiness(readinessInput({ isAmountSettled: false }))
    expect(view).toEqual({ status: "loading", message: "Updating amount..." })
  })
})

describe("isKnownNotSent", () => {
  it("recognizes node refusals that never reach the mempool", () => {
    expect(isKnownNotSent("insufficient funds for intrinsic transaction cost")).toBe(true)
    expect(isKnownNotSent("Insufficient funds for gas * price + value")).toBe(true)
    expect(isKnownNotSent("intrinsic gas too low")).toBe(true)
  })
  it("keeps everything ambiguous otherwise", () => {
    for (const message of [
      "network error",
      "timeout",
      "nonce too low",
      "replacement underpriced",
    ]) {
      expect(isKnownNotSent(message)).toBe(false)
    }
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

describe("isWalletRejection", () => {
  it("matches the normalized rejection message only", () => {
    expect(isWalletRejection("User rejected")).toBe(true)
    expect(isWalletRejection("network error")).toBe(false)
  })
})

function readinessInput(overrides: Partial<DepositReadinessInput> = {}): DepositReadinessInput {
  return {
    transport: "lifi",
    unknownSend: false,
    sessionInFlight: false,
    isAmountSettled: true,
    storageBlocked: false,
    quantityEntered: true,
    amount: "1000000",
    balancesError: false,
    tokenBalance: "5000000",
    nativeBalance: "10000000000000000",
    nativeSymbol: "ETH",
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
    hasPreSubmitBlock: true,
    pinnedRpcAvailable: true,
    ...overrides,
  }
}

describe("derivePreflight", () => {
  const quoted = { status: "quoted", quote: { amount_out: "1", min_received: "1" } } as const
  const declined = { status: "declined", reason: "Amount too small" } as const

  it("is idle until there is an amount to quote", () => {
    expect(
      derivePreflight({ amountIn: "", hasError: false, result: quoted, isPlaceholderData: false }),
    ).toEqual({ status: "idle" })
  })

  it("reports the read failure rather than a verdict", () => {
    expect(
      derivePreflight({
        amountIn: "1000",
        hasError: true,
        result: quoted,
        isPlaceholderData: false,
      }),
    ).toEqual({ status: "error" })
  })

  it("keeps a held previous result from speaking for this amount", () => {
    expect(
      derivePreflight({
        amountIn: "1000",
        hasError: false,
        result: declined,
        isPlaceholderData: true,
      }),
    ).toEqual({ status: "loading" })
    expect(
      derivePreflight({ amountIn: "1000", hasError: false, isPlaceholderData: false }),
    ).toEqual({ status: "loading" })
  })

  it("carries the decline reason of a settled verdict", () => {
    expect(
      derivePreflight({
        amountIn: "1000",
        hasError: false,
        result: declined,
        isPlaceholderData: false,
      }),
    ).toEqual({ status: "declined", reason: "Amount too small" })
    expect(
      derivePreflight({
        amountIn: "1000",
        hasError: false,
        result: quoted,
        isPlaceholderData: false,
      }),
    ).toEqual({ status: "quoted" })
  })
})

describe("deriveDepositReadiness", () => {
  it("is ready when every gate passes", () => {
    expect(deriveDepositReadiness(readinessInput())).toEqual({ status: "ready" })
  })

  it("locks on an ambiguous send ahead of every other state", () => {
    const readiness = deriveDepositReadiness(
      readinessInput({ unknownSend: true, storageBlocked: true, quantityEntered: false }),
    )
    expect(readiness).toEqual({
      status: "blocked",
      message: UNKNOWN_SEND_MESSAGE,
      level: "error",
    })
  })

  it("blocks signing when the session could not be stored", () => {
    expect(deriveDepositReadiness(readinessInput({ storageBlocked: true })).message).toBe(
      STORAGE_BLOCKED_MESSAGE,
    )
  })

  it("blocks on a lock held by another tab", () => {
    expect(deriveDepositReadiness(readinessInput({ lockError: "already running" })).message).toBe(
      "already running",
    )
  })

  it("blocks on an invalid host recipient before touching backend state", () => {
    const readiness = deriveDepositReadiness(
      readinessInput({ recipientError: "bad recipient", hasOptions: false }),
    )
    expect(readiness.message).toBe("bad recipient")
  })

  it("asks for an amount before any network state", () => {
    expect(deriveDepositReadiness(readinessInput({ quantityEntered: false }))).toEqual({
      status: "blocked",
      message: "Enter amount",
      level: "info",
    })
    expect(deriveDepositReadiness(readinessInput({ amount: "" })).message).toBe(
      "Enter a valid amount",
    )
  })

  it("waits for the pinned balance rather than trusting a snapshot", () => {
    expect(deriveDepositReadiness(readinessInput({ tokenBalance: undefined }))).toEqual({
      status: "loading",
      message: "Loading balance...",
    })
  })

  it("blocks when the pinned balance does not cover the amount", () => {
    expect(deriveDepositReadiness(readinessInput({ tokenBalance: "999999" }))).toEqual({
      status: "blocked",
      message: "Insufficient balance",
      level: "info",
    })
  })

  it("blocks on a zero native balance with the chain's gas symbol", () => {
    expect(deriveDepositReadiness(readinessInput({ nativeBalance: "0" })).message).toBe(
      "Not enough ETH for gas",
    )
  })

  it("blocks when the native balance cannot cover the call's value plus priced gas", () => {
    const short = readinessInput({ nativeBalance: "500", requiredNative: "669" })
    expect(deriveDepositReadiness(short).message).toBe(
      "Not enough ETH for this route's fee and gas",
    )
    const enough = readinessInput({ nativeBalance: "700", requiredNative: "669" })
    expect(deriveDepositReadiness(enough).status).toBe("ready")
  })

  it("blocks when the source chain has no pinned RPC", () => {
    expect(deriveDepositReadiness(readinessInput({ pinnedRpcAvailable: false })).status).toBe(
      "blocked",
    )
  })

  it("loads while routes are unknown and blocks when none is eligible", () => {
    expect(deriveDepositReadiness(readinessInput({ hasOptions: false })).status).toBe("loading")
    expect(deriveDepositReadiness(readinessInput({ hasEligibleOption: false })).message).toBe(
      "No route can bring at least 1 USDC to Ethereum after fees. Try a larger amount.",
    )
  })

  it("blocks an unbound quote", () => {
    expect(
      deriveDepositReadiness(readinessInput({ quoteBound: false, isRefreshing: true })),
    ).toEqual({ status: "loading", message: "Refreshing quote..." })
    expect(deriveDepositReadiness(readinessInput({ sessionInFlight: true })).message).toBe(
      SESSION_IN_FLIGHT_MESSAGE,
    )
    expect(deriveDepositReadiness(readinessInput({ quoteBound: false })).message).toBe(
      "The issued deposit address changed. Change the amount or provider for a fresh quote.",
    )
  })

  it("blocks a route that cannot clear the Ethereum minimum", () => {
    expect(deriveDepositReadiness(readinessInput({ meetsMinimum: false })).message).toBe(
      "This route would deliver less than 1 USDC to Ethereum. Try a larger amount or another provider.",
    )
  })

  it("asks a direct deposit for the route minimum in its own terms", () => {
    const readiness = deriveDepositReadiness(
      readinessInput({ transport: "direct", meetsMinimum: false }),
    )
    expect(readiness.message).toBe("Enter at least 1 USDC")
  })

  it("waits for the issued address on the direct path", () => {
    const readiness = deriveDepositReadiness(
      readinessInput({ transport: "direct", hasDepositAddress: false }),
    )
    expect(readiness).toEqual({ status: "loading", message: "Preparing deposit address..." })
  })

  it("blocks on a declined downstream preflight and keeps the backend reason", () => {
    const readiness = deriveDepositReadiness(
      readinessInput({ preflight: "declined", preflightReason: "amount below minimum" }),
    )
    expect(readiness).toEqual({
      status: "blocked",
      message: "amount below minimum",
      level: "error",
    })
  })

  it("waits for the preflight and for the pinned pre-submit block", () => {
    expect(deriveDepositReadiness(readinessInput({ preflight: "loading" })).status).toBe("loading")
    expect(deriveDepositReadiness(readinessInput({ hasPreSubmitBlock: false }))).toEqual({
      status: "loading",
      message: "Preparing...",
    })
  })

  it("blocks when the allowance cannot be verified", () => {
    expect(
      deriveDepositReadiness(
        readinessInput({ allowanceError: "Could not check the USDC allowance" }),
      ),
    ).toEqual({
      status: "blocked",
      message: "Could not check the USDC allowance",
      level: "error",
    })
  })

  it("is ready once the blocking gates clear", () => {
    expect(deriveDepositReadiness(readinessInput())).toEqual({ status: "ready" })
  })
})
