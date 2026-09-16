import BigNumber from "bignumber.js"
import { InitiaAddress } from "@initia/utils"
import { BRIDGE_QUOTE_MAX_AGE } from "../data/bridges"
import { isDecimalString, isEvmTxHash, isIntegerString } from "../data/parse"
import type { QuoteResult } from "../data/quote"
import type { BridgeOption, BridgeQuoteResponse } from "../data/types"
import type { DepositSessionTransaction } from "./depositSession"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM } from "./depositSources"
import { encodeErc20Transfer } from "./evmRpc"

// Normalized to canonical lowercase bech32 so the issued deposit address, the LI.FI quote
// echo and the indexed Deposit record all compare as the same string. A malformed host
// recipient is an error, never a silent fall back to the connected wallet: crediting the
// wrong wallet is an irreversible misdelivery.
export function resolveDepositRecipient(
  recipientAddress: string | undefined,
  initiaAddress: string,
): { recipient: string } | { error: string } {
  const candidate = recipientAddress || initiaAddress
  if (!candidate) return { error: "Connect a wallet to continue" }
  try {
    const recipient = InitiaAddress(candidate).bech32.toLowerCase()
    if (!recipient) throw new Error("empty address")
    return { recipient }
  } catch {
    return recipientAddress
      ? { error: `The app provided an invalid recipient address: ${recipientAddress}` }
      : { error: "Could not resolve the receiving address" }
  }
}

// The user's pick wins while it is still eligible in the *current* options; otherwise the
// ranked default takes over and the caller clears the stale selection.
export function selectBridgeOption(
  ranked: BridgeOption[],
  selectedKey: string,
): { option?: BridgeOption; clearSelection: boolean } {
  const fallback = ranked.find((option) => option.eligible)
  if (!selectedKey) return { option: fallback, clearSelection: false }

  const selected = ranked.find(
    (option) => option.bridge.toLowerCase() === selectedKey.toLowerCase() && option.eligible,
  )
  if (selected) return { option: selected, clearSelection: false }

  // Only clear once a list is actually loaded: an empty `ranked` is "not fetched yet", and
  // dropping the selection then would lose the pick on every amount keystroke.
  return { option: fallback, clearSelection: ranked.length > 0 }
}

// The options response echoes nothing about the request, so the issued deposit address is
// the only shared identity between the two calls. A mismatch means the minimum the user
// reviewed and the transaction about to be signed came from different backend states.
export function isQuoteBoundToOptions(
  quoteDepositAddress: string | undefined,
  optionsDepositAddress: string | undefined,
): boolean {
  if (!quoteDepositAddress || !optionsDepositAddress) return false
  return quoteDepositAddress.toLowerCase() === optionsDepositAddress.toLowerCase()
}

export function isQuoteStale(dataUpdatedAt: number, now: number): boolean {
  if (!dataUpdatedAt) return true
  return now - dataUpdatedAt > BRIDGE_QUOTE_MAX_AGE
}

// Direct has no bridge leg, so the Ethereum minimum applies to the transferred amount
// itself. Fails closed: below the minimum is neither delivered nor automatically refunded.
export function meetsDirectMinimum(amount: string, routeMinDeposit: string): boolean {
  if (!isIntegerString(amount) || !isIntegerString(routeMinDeposit)) return false
  return BigInt(amount) >= BigInt(routeMinDeposit)
}

/** Whether the pinned token balance covers the amount. Unknown balance answers false — MAX and Deposit stay closed until the pinned read resolves. */
export function coversAmount(balance: string | undefined, amount: string): boolean {
  if (!isIntegerString(balance) || !isIntegerString(amount)) return false
  return BigInt(balance) >= BigInt(amount)
}

/** Direct's equivalent of `bridgeQuoteSignature`: everything a reissued address or a re-quote could change under the user. */
export function directDepositSignature(params: {
  depositAddress: string
  amount: string
  recipient: string
  dstChainId: string
  dstDenom: string
}): string {
  const { depositAddress, amount, recipient, dstChainId, dstDenom } = params
  if (!depositAddress) return ""
  return JSON.stringify([
    depositAddress.toLowerCase(),
    amount,
    recipient,
    dstChainId,
    dstDenom.toLowerCase(),
  ])
}

export interface QuoteAcknowledgement {
  /** The request identity the acknowledgement belongs to; a new identity is a new review. */
  identityKey: string
  signature: string
}

// Readiness is granted against one exact quote signature; when a background refresh changes
// it, the form waits for another deliberate click instead of signing a quote the user never saw.
export function deriveQuoteAcknowledgement(params: {
  acknowledgement: QuoteAcknowledgement | null
  identityKey: string
  signature: string
  /** Everything except this gate is satisfied, i.e. the user is looking at a reviewable quote. */
  isReviewable: boolean
}): { next: QuoteAcknowledgement | null; quoteUpdated: boolean } {
  const { acknowledgement, identityKey, signature, isReviewable } = params

  // A changed identity (amount, source, route) is a new review, not an updated
  // quote: the form was never ready for it, so there is nothing to re-confirm.
  if (acknowledgement && acknowledgement.identityKey !== identityKey) {
    return { next: null, quoteUpdated: false }
  }
  if (!isReviewable || !signature) return { next: acknowledgement, quoteUpdated: false }
  if (!acknowledgement) return { next: { identityKey, signature }, quoteUpdated: false }
  return { next: acknowledgement, quoteUpdated: acknowledgement.signature !== signature }
}

/** An absent estimate displays as unknown, never as zero or "insufficient": the wallet prices the transaction at signing time. */
export function formatNetworkFee(gasCostUsd: string | undefined): string {
  // Guarded before BigNumber(): strict mode throws on unparseable input, and a fee label
  // must never take down the form (same guard as knownGasCost in bridges.ts).
  if (!isDecimalString(gasCostUsd)) return "Shown in wallet"
  const value = BigNumber(gasCostUsd || 0)
  return `$${value.toFixed(value.lt(0.01) && value.gt(0) ? 4 : 2)}`
}

/** Every leg must be known: a partial sum would promise a delivery time that leaves out a whole bridge or settlement leg. */
export function combineEstimatedSeconds(parts: (number | undefined)[]): number | undefined {
  if (parts.some((part) => part === undefined)) return undefined
  return parts.reduce<number>((total, part) => total + (part ?? 0), 0)
}

// The issued deposit address is swept by the backend between deposits: a transfer estimated
// while its balance was nonzero (≈45k) lands after the sweep, where the fresh storage slot
// needs ≈65k, and reverts out of gas with the fee spent. Unused gas is refunded.
export const DIRECT_TRANSFER_GAS_LIMIT = "90000"

export function buildDepositTransaction(
  params:
    | { transport: "lifi"; quote: BridgeQuoteResponse }
    | { transport: "direct"; depositAddress: string; amount: string },
): DepositSessionTransaction {
  if (params.transport === "lifi") {
    const { transaction } = params.quote
    return {
      chainId: transaction.chain_id,
      to: transaction.to,
      data: transaction.data,
      // Preserved verbatim, including a nonzero protocol fee on an ERC-20
      // bridge: rewriting it to "0" makes the call revert after the user paid gas.
      value: transaction.value,
      ...(transaction.gas_limit ? { gasLimit: transaction.gas_limit } : {}),
    }
  }
  return {
    chainId: ETHEREUM_CHAIN_ID,
    to: ETHEREUM_USDC_DENOM,
    data: encodeErc20Transfer(params.depositAddress, params.amount),
    value: "0",
    gasLimit: DIRECT_TRANSFER_GAS_LIMIT,
  }
}

// Native base units a call needs before the wallet prices it: its own `value` plus the gas
// limit at the pinned fee read. Either unknown → undefined.
export function requiredNativeAmount(params: {
  value?: string
  gasLimit?: string
  maxFeePerGas?: string
}): string | undefined {
  const { value, gasLimit, maxFeePerGas } = params
  if (!isIntegerString(value)) return undefined
  if (!gasLimit || !maxFeePerGas) return value
  if (!isIntegerString(gasLimit) || !isIntegerString(maxFeePerGas)) return value
  return (BigInt(value) + BigInt(gasLimit) * BigInt(maxFeePerGas)).toString()
}

// The hash ethers attaches when `eth_sendTransaction` succeeded but the follow-up
// `eth_getTransactionByHash` failed (`error.info.sendTransactionHash`). A transfer with a
// hash is on chain and must be tracked, never locked as an ambiguous send.
export function sendTransactionHashOf(error: unknown): string | undefined {
  const info = (error as { info?: { sendTransactionHash?: unknown } } | null)?.info
  const hash = info?.sendTransactionHash
  return typeof hash === "string" && isEvmTxHash(hash) ? hash : undefined
}

/** normalizeErrorMessage maps both `code: 4001` and ethers' `ACTION_REJECTED` to this string. */
export const USER_REJECTED_MESSAGE = "User rejected"

/** A rejected prompt is one failure that leaves the form re-signable; see isKnownNotSent for the other. */
export function isWalletRejection(message: string): boolean {
  return message === USER_REJECTED_MESSAGE
}

// Node-side refusals that happen before anything enters the mempool: provably never
// accepted, so retrying cannot double-send. Anything else without a hash stays ambiguous.
export function isKnownNotSent(message: string): boolean {
  const text = message.toLowerCase()
  return text.includes("insufficient funds") || text.includes("intrinsic gas too low")
}

/** A wallet call that never returned a hash. The form locks; nothing is ever re-sent from here. */
export const UNKNOWN_SEND_MESSAGE =
  "The wallet did not confirm whether this transfer was sent. Do not send it again — open the progress view to check its status."

export const SESSION_IN_FLIGHT_MESSAGE =
  "A transfer for this deposit is already in progress. Open the progress view to follow it."

export const STORAGE_BLOCKED_MESSAGE =
  "This deposit could not be saved in your browser, so it cannot be sent safely. Free up storage or try another browser."

/** Downstream /v1/quote at the worst-case Ethereum amount, as the readiness gate reads it. */
export type PreflightStatus = "idle" | "loading" | "quoted" | "declined" | "error"

// Only a *settled* result may be read as this amount's: `keepPreviousData` holds the
// previous verdict, which must not speak for an amount it was never quoted for.
export function derivePreflight(params: {
  /** "" when there is nothing to quote yet. */
  amountIn: string
  hasError: boolean
  result?: QuoteResult
  /** React Query is still showing the previous amount's result. */
  isPlaceholderData: boolean
}): { status: PreflightStatus; reason?: string } {
  const { amountIn, hasError, result, isPlaceholderData } = params
  if (!amountIn) return { status: "idle" }
  if (hasError) return { status: "error" }
  if (!result || isPlaceholderData) return { status: "loading" }
  if (result.status === "declined") return { status: "declined", reason: result.reason }
  return { status: "quoted" }
}

export type ReadinessLevel = "error" | "warning" | "info"

export interface DepositReadiness {
  status: "loading" | "blocked" | "ready"
  message?: string
  level?: ReadinessLevel
}

export interface DepositReadinessInput {
  transport: "direct" | "lifi"
  /** Hard locks, checked before anything else; none of them can be cleared by refreshing data. */
  unknownSend: boolean
  /** The stored record already reached the send prompt on another mount. */
  sessionInFlight: boolean
  storageBlocked: boolean
  lockError?: string
  recipientError?: string

  quantityEntered: boolean
  /** Source base units; "" when the typed quantity is not representable. */
  amount: string
  /** The debounced amount matches what is typed; a click inside the debounce must not send the previous amount. */
  isAmountSettled: boolean

  balancesError: boolean
  /** Pinned reads (evmRpc), the single authority for a Deposit API pair. */
  tokenBalance?: string
  nativeBalance?: string
  nativeSymbol: string
  /** Native base units the call itself needs: the quote's `value` (a bridge fee, paid in ETH even for USDC) plus priced gas when both are known. */
  requiredNative?: string

  optionsError?: string
  hasOptions: boolean
  hasEligibleOption: boolean
  quoteError?: string
  hasQuote: boolean
  quoteBound: boolean
  /** Options or quote are being re-read; an unbound quote is then a transient state. */
  isRefreshing: boolean
  meetsMinimum: boolean
  minimumLabel: string
  approvalChecking: boolean
  approvalError?: string

  depositAddressError?: string
  hasDepositAddress: boolean

  preflight: PreflightStatus
  preflightReason?: string

  hasPreSubmitBlock: boolean
  pinnedRpcAvailable: boolean
}

// Ordered so the most consequential blocker wins: unrecoverable states first (an ambiguous
// send must never be overwritten by "Fetching route…"), then identity, the user's inputs,
// the backend evidence, and last the pre-send capabilities.
export function deriveDepositReadiness(input: DepositReadinessInput): DepositReadiness {
  const blocked = (message: string, level: ReadinessLevel = "error"): DepositReadiness => ({
    status: "blocked",
    message,
    level,
  })
  const loading = (message?: string): DepositReadiness => ({ status: "loading", message })

  if (input.unknownSend) return blocked(UNKNOWN_SEND_MESSAGE)
  if (input.sessionInFlight) return blocked(SESSION_IN_FLIGHT_MESSAGE)
  if (input.storageBlocked) return blocked(STORAGE_BLOCKED_MESSAGE)
  if (input.lockError) return blocked(input.lockError)
  if (input.recipientError) return blocked(input.recipientError)

  // Input prompts, not failures: the footer renders an `info` blocker as the disabled
  // button's own label, and only an `error` as a FormHelp message.
  if (!input.quantityEntered) return blocked("Enter amount", "info")
  if (!input.amount) return blocked("Enter a valid amount", "info")
  if (!input.isAmountSettled) return loading("Updating amount...")

  if (input.balancesError) return blocked("Failed to load balance")
  if (!input.pinnedRpcAvailable) return blocked("This source chain cannot be verified right now")
  // The pinned read is the single authority for a Deposit API pair: no verified balance
  // until it resolves, even when Skip's aggregate snapshot already showed a number.
  if (input.tokenBalance === undefined) return loading("Loading balance...")
  if (!coversAmount(input.tokenBalance, input.amount))
    return blocked("Insufficient balance", "info")
  // Fees are read, never simulated. A native balance short of the call's own value plus
  // priced gas is a verdict the client can state before the node refuses the broadcast.
  if (input.nativeBalance !== undefined) {
    const native = BigInt(input.nativeBalance || "0")
    if (native === 0n) return blocked(`Not enough ${input.nativeSymbol} for gas`)
    if (input.requiredNative && native < BigInt(input.requiredNative)) {
      return blocked(`Not enough ${input.nativeSymbol} for this route's fee and gas`)
    }
  }

  if (input.transport === "lifi") {
    if (input.optionsError) return blocked(input.optionsError)
    if (!input.hasOptions) return loading("Finding routes...")
    // The minimum applies to what arrives on Ethereum, after the bridge's fee,
    // so a small source amount fails it even though it is above the minimum.
    if (!input.hasEligibleOption) {
      return blocked(
        `No route can bring at least ${input.minimumLabel} to Ethereum after fees. Try a larger amount.`,
      )
    }
    if (input.quoteError) return blocked(input.quoteError)
    if (!input.hasQuote) return loading("Fetching quote...")
    if (!input.quoteBound) {
      return input.isRefreshing
        ? loading("Refreshing quote...")
        : blocked(
            "The issued deposit address changed. Change the amount or provider for a fresh quote.",
          )
    }
    if (!input.meetsMinimum) {
      return blocked(
        `This route would deliver less than ${input.minimumLabel} to Ethereum. Try a larger amount or another provider.`,
      )
    }
  } else {
    if (!input.meetsMinimum) return blocked(`Enter at least ${input.minimumLabel}`, "info")
    if (input.depositAddressError) return blocked(input.depositAddressError)
    if (!input.hasDepositAddress) return loading("Preparing deposit address...")
  }

  if (input.preflight === "declined") {
    return blocked(input.preflightReason || "This deposit cannot be quoted right now")
  }
  if (input.preflight === "error") return blocked("Could not verify the destination estimate")
  if (input.preflight !== "quoted") return loading("Checking destination...")

  if (input.approvalError) return blocked(input.approvalError)
  if (input.approvalChecking) return loading("Checking approvals...")
  if (!input.hasPreSubmitBlock) return loading("Preparing...")

  // A failed *attempt* (a rejected prompt, a chain-switch refusal) deliberately does not
  // land here: the form stays ready and the footer shows the error alongside the action.
  return { status: "ready" }
}
