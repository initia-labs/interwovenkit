import BigNumber from "bignumber.js"
import { InitiaAddress, toBaseUnit } from "@initia/utils"
import { isUserRejection, POPUP_BLOCKED_MESSAGE } from "@/data/http"
import { formatDuration } from "@/pages/bridge/data/format"
import { BRIDGE_QUOTE_MAX_AGE } from "../data/bridges"
import { gteInteger, isDecimalString, isIntegerString } from "../data/parse"
import { QUOTE_STALE_TIME, type QuoteResult } from "../data/quote"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM } from "../data/source"
import type {
  Asset,
  BridgeOption,
  BridgeQuoteResponse,
  BridgeRequestIdentity,
  DestinationNetwork,
  QuoteResponse,
} from "../data/types"
import type { DepositSessionTransaction } from "./depositSession"
import { encodeErc20Transfer } from "./evmRpc"

export function toBaseUnitString(quantity: string, decimals: number): string {
  const amount = toBaseUnit(quantity, { decimals })
  return isIntegerString(amount) ? amount : ""
}

export function depositInputMinimum(
  route: Pick<Asset, "min_deposit_amount" | "bridge_min_input_amount">,
  transport: "direct" | "lifi",
): string {
  return transport === "lifi" ? route.bridge_min_input_amount : route.min_deposit_amount
}

export function meetsDepositInputMinimum(
  amount: string,
  route: Pick<Asset, "min_deposit_amount" | "bridge_min_input_amount">,
  transport: "direct" | "lifi",
): boolean {
  return gteInteger(amount, depositInputMinimum(route, transport))
}

export function lifiOutputMinimum(
  route: Pick<Asset, "min_deposit_amount">,
  requiredMinReceived: string | undefined,
): string {
  return requiredMinReceived && gteInteger(requiredMinReceived, route.min_deposit_amount)
    ? requiredMinReceived
    : route.min_deposit_amount
}

// A malformed host recipient is an error, never a fallback to the connected wallet.
export function resolveDepositRecipient(
  recipientAddress: string | undefined,
  initiaAddress: string,
): { recipient: string } | { error: string } {
  const candidate = recipientAddress || initiaAddress
  if (!candidate) return { error: "Connect a wallet to continue" }
  try {
    return { recipient: InitiaAddress(candidate).bech32.toLowerCase() }
  } catch {
    return recipientAddress
      ? { error: `The app provided an invalid recipient address: ${recipientAddress}` }
      : { error: "Could not resolve the receiving address" }
  }
}

// A pick holds only for the transfer it was made for: another amount or asset re-ranks the routes.
export const bridgeSelectionContext = (identity: BridgeRequestIdentity) =>
  [
    identity.srcChainId,
    identity.srcDenom,
    identity.dstChainId,
    identity.dstDenom,
    identity.amount,
  ].join("|")

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

  // An empty list is "not fetched yet"; clearing then would drop the pick on every keystroke.
  return { option: fallback, clearSelection: ranked.length > 0 }
}

export function isQuoteStale(dataUpdatedAt: number, now: number): boolean {
  if (!dataUpdatedAt) return true
  return now - dataUpdatedAt > BRIDGE_QUOTE_MAX_AGE
}

export function formatNetworkFee(gasCostUsd: string | undefined): string {
  if (!isDecimalString(gasCostUsd)) return "Shown in wallet"
  const value = BigNumber(gasCostUsd)
  return `$${value.toFixed(value.lt(0.01) && value.gt(0) ? 4 : 2)}`
}

type FeeQuote = {
  estimate: Pick<BridgeQuoteResponse["estimate"], "gas_cost_usd">
  transaction: Pick<BridgeQuoteResponse["transaction"], "value">
}

export function formatQuoteFees(
  quote: FeeQuote | undefined,
  ethPriceUsd: number | undefined,
): string {
  if (!quote) return "Shown in wallet"
  const gas = quote?.estimate.gas_cost_usd
  const formattedGas = isDecimalString(gas) ? formatNetworkFee(gas) : undefined
  const value = quote.transaction.value
  if (!isIntegerString(value)) {
    return formattedGas ? `${formattedGas} gas + protocol in wallet` : "Shown in wallet"
  }
  if (BigInt(value) === 0n) return formattedGas ?? "Gas shown in wallet"

  const validPrice = ethPriceUsd !== undefined && Number.isFinite(ethPriceUsd) && ethPriceUsd > 0
  if (!validPrice) {
    const protocol = `${formatProtocolFee(value)} protocol`
    return formattedGas ? `${formattedGas} gas + ${protocol}` : `${protocol} + gas in wallet`
  }

  const protocolUsd = BigNumber(value).shiftedBy(-18).times(ethPriceUsd)
  if (!isDecimalString(gas))
    return `${formatNetworkFee(protocolUsd.toFixed())} protocol + gas in wallet`
  return formatNetworkFee(BigNumber(gas).plus(protocolUsd).toFixed())
}

// Six decimals would print a fee under a millionth of an ETH as zero.
export function formatProtocolFee(wei: string): string {
  const value = BigNumber(wei).shiftedBy(-18)
  return value.lt(0.000001)
    ? "< 0.000001 ETH"
    : `${value.decimalPlaces(6, BigNumber.ROUND_UP).toFixed()} ETH`
}

// Past a minute an estimate reads in whole minutes, rounded up: seconds would claim precision it lacks.
export function formatEstimate(seconds: number) {
  return formatDuration(seconds < 60 ? seconds : Math.ceil(seconds / 60) * 60)
}

/** Every leg must be known: a partial sum would promise a time that leaves out a leg. */
export function combineEstimatedSeconds(parts: (number | null | undefined)[]): number | undefined {
  let total = 0
  for (const part of parts) {
    if (part === null || part === undefined) return undefined
    total += part
  }
  return total
}

export function deliverySeconds(
  quote: QuoteResponse | undefined,
  destination: DestinationNetwork | undefined,
): number | null | undefined {
  if (!quote) return undefined
  return quote.delivery?.estimated_seconds ?? destination?.processing_time_seconds
}

// The issued address is swept between deposits, so a transfer estimated against a nonzero
// balance (≈45k gas) can land on a fresh storage slot (≈65k) and revert out of gas.
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
      // Verbatim, including a nonzero protocol fee: rewriting it makes the call revert.
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

export function requiredNativeAmount(params: {
  value?: string
  gasLimit?: string
  maxFeePerGas?: string
}): string | undefined {
  const { value, gasLimit, maxFeePerGas } = params
  if (!isIntegerString(value)) return undefined
  if (!isIntegerString(gasLimit) || !isIntegerString(maxFeePerGas)) return value
  return (BigInt(value) + BigInt(gasLimit) * BigInt(maxFeePerGas)).toString()
}

// ethers attaches the hash when eth_sendTransaction succeeded but the follow-up read failed: the transfer is on chain.
/** A rejected or blocked prompt, or a node refusal before the mempool; anything else without a hash stays ambiguous. */
export function isProvablyNotSent(error: unknown, message: string): boolean {
  const text = message.toLowerCase()
  return (
    isUserRejection(error) ||
    message === POPUP_BLOCKED_MESSAGE ||
    text.includes("insufficient funds") ||
    text.includes("intrinsic gas too low")
  )
}

export const UNKNOWN_SEND_MESSAGE =
  "Your wallet didn't confirm whether this transfer was sent. Don't send it again. Open the progress view to check its status."

export const SESSION_IN_FLIGHT_MESSAGE =
  "A transfer for this deposit is already in progress. Open the progress view to follow it."

export const STORAGE_BLOCKED_MESSAGE =
  "This deposit could not be saved in your browser, so it cannot be sent safely. Free up storage or try another browser."

type PreflightStatus = "idle" | "loading" | "quoted" | "declined" | "error"

// A placeholder result is the previous amount's verdict and must not speak for this one. One missed
// refresh keeps this amount's last verdict; a second blocks the send.
export function derivePreflight(params: {
  amountIn: string
  hasError: boolean
  result?: QuoteResult
  isPlaceholderData: boolean
  /** From the last good read to the failed one. */
  failedAfter: number
}): { status: PreflightStatus; reason?: string } {
  const { amountIn, hasError, result, isPlaceholderData, failedAfter } = params
  if (!amountIn) return { status: "idle" }
  const hasResult = !!result && !isPlaceholderData
  if (hasError && !(hasResult && failedAfter < 2 * QUOTE_STALE_TIME)) return { status: "error" }
  if (!result || isPlaceholderData) return { status: "loading" }
  if (result.status === "declined") return { status: "declined", reason: result.reason }
  return { status: "quoted" }
}

type ReadinessLevel = "error" | "info"

export interface DepositReadiness {
  status: "loading" | "blocked" | "ready"
  message?: string
  level?: ReadinessLevel
}

export interface DepositReadinessInput {
  transport: "direct" | "lifi"
  unknownSend: boolean
  sessionInFlight: boolean
  storageBlocked: boolean
  recipientError?: string

  quantityEntered: boolean
  amount: string
  isAmountSettled: boolean
  meetsInputMinimum: boolean
  inputMinimumLabel: string

  balancesError: boolean
  tokenBalance?: string
  nativeBalance?: string
  requiredNative?: string
  /** The head block and sender nonce the send prompt records. */
  sourceChainLoaded: boolean
  /** Either read failed with nothing read yet; both retry on their interval. */
  sourceChainError: boolean

  optionsError?: string
  hasOptions: boolean
  hasEligibleOption: boolean
  quoteError?: string
  hasQuote: boolean
  meetsMinimum: boolean
  minimumLabel: string
  approvalChecking: boolean
  approvalError?: string

  depositAddressError?: string
  hasDepositAddress: boolean

  preflight: PreflightStatus
  preflightReason?: string
}

// The most consequential blocker wins: an ambiguous send must never be overwritten by a loading state.
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
  if (input.recipientError) return blocked(input.recipientError)

  if (!input.quantityEntered) return blocked("Enter amount", "info")
  // Zero, or dust that floors to zero base units, is never quoted.
  if (!gteInteger(input.amount, "1")) return blocked("Enter a valid amount", "info")
  if (!input.isAmountSettled) return loading("Updating amount...")
  if (!input.meetsInputMinimum) return blocked(`Enter at least ${input.inputMinimumLabel}`, "info")

  if (input.balancesError) return blocked("Failed to load balance")
  if (input.tokenBalance === undefined) return loading("Loading balance...")
  if (!gteInteger(input.tokenBalance, input.amount)) return blocked("Insufficient balance", "info")
  if (input.nativeBalance !== undefined) {
    const native = BigInt(input.nativeBalance)
    if (native === 0n) return blocked("Not enough ETH for gas")
    if (input.requiredNative && native < BigInt(input.requiredNative)) {
      return blocked("Not enough ETH for this route's fee and gas")
    }
  }
  if (!input.sourceChainLoaded) {
    return input.sourceChainError ? blocked("Couldn't reach the network. Retrying...") : loading()
  }

  if (input.transport === "lifi") {
    if (input.optionsError) return blocked(input.optionsError)
    if (!input.hasOptions) return loading("Finding routes...")
    if (!input.hasEligibleOption) {
      return blocked(
        `No route can bring at least ${input.minimumLabel} to Ethereum after fees. Try a larger amount.`,
      )
    }
    if (input.quoteError) return blocked(input.quoteError)
    if (!input.hasQuote) return loading("Fetching quote...")
    if (!input.meetsMinimum) {
      return blocked(
        `This route would deliver less than ${input.minimumLabel} to Ethereum. Try a larger amount or another route.`,
      )
    }
  } else {
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

  return { status: "ready" }
}
