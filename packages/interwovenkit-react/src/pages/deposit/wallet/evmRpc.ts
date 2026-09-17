import type { TransactionReceipt } from "ethers"
import {
  getAddress,
  Interface,
  isError,
  JsonRpcProvider,
  Signature,
  TransactionResponse,
} from "ethers"
import { useQuery } from "@tanstack/react-query"
import { depositQueryKeys } from "../data/api"
import { eqAddress } from "../data/parse"
import { depositApiRpcUrl } from "./depositSources"

// One provider per source chain for the tab's lifetime. ethers keeps a polling loop alive once
// `wait()` subscribed to blocks, so a per-mount provider would need tearing down — and
// StrictMode's mount → cleanup → mount would leave a destroyed one behind, rejecting every read.
const pinnedProviders = new Map<string, JsonRpcProvider>()

/**
 * Pinned to one source chain: the wallet's provider follows whatever network the user switches
 * to, so a receipt read through it can come from the wrong chain while a transfer is in flight.
 * `staticNetwork` stops ethers from silently re-detecting and reintroducing that drift.
 *
 * Only Deposit API sources are readable here, and every one of them carries its own endpoint
 * (`DepositApiSource.rpcUrl`) — never the Router registry, whose Base and Arbitrum entries
 * refuse `eth_getTransactionReceipt`.
 */
export function getPinnedProvider(chainId: string): JsonRpcProvider {
  const provider = findPinnedProvider(chainId)
  if (!provider) throw new Error(`Chain ${chainId} is not a Deposit API source`)
  return provider
}

/** Null for a chain outside the catalog: a stored record may name a source that was since delisted. */
export function findPinnedProvider(chainId: string): JsonRpcProvider | null {
  const existing = pinnedProviders.get(chainId)
  if (existing) return existing
  const rpcUrl = depositApiRpcUrl(chainId)
  if (!rpcUrl) return null
  const provider = new JsonRpcProvider(rpcUrl, Number(chainId), { staticNetwork: true })
  pinnedProviders.set(chainId, provider)
  return provider
}

const ERC20 = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
])

// An empty response means the address holds no contract (wrong chain, wrong token). Decoding it
// would yield zero, which reads as "approval needed" or "insufficient funds" — guesses about money.
async function readErc20Uint(
  provider: JsonRpcProvider,
  token: string,
  fragment: "balanceOf" | "allowance",
  args: string[],
): Promise<string> {
  const result = await provider.call({ to: token, data: ERC20.encodeFunctionData(fragment, args) })
  if (!result || result === "0x") {
    throw new Error(`ERC-20 ${fragment} returned no data for ${token}`)
  }
  const [value] = ERC20.decodeFunctionResult(fragment, result)
  return (value as bigint).toString()
}

/** Token and native balances in base units. Decimal strings, never JavaScript numbers. */
interface SourceBalances {
  token: string
  native: string
}

export async function readSourceBalances(
  provider: JsonRpcProvider,
  params: { owner: string; token: string },
): Promise<SourceBalances> {
  const { owner, token } = params
  const [tokenBalance, nativeBalance] = await Promise.all([
    readErc20Uint(provider, token, "balanceOf", [owner]),
    provider.getBalance(owner),
  ])
  return { token: tokenBalance, native: nativeBalance.toString() }
}

export async function readAllowance(
  provider: JsonRpcProvider,
  params: { owner: string; token: string; spender: string },
): Promise<string> {
  const { owner, token, spender } = params
  return readErc20Uint(provider, token, "allowance", [owner, spender])
}

// ethers rejects a mixed-case address whose EIP-55 checksum does not match, but accepts
// all-lowercase. The API validates issued addresses by shape only, so lowercase before encoding.
const addressArg = (address: string) => address.toLowerCase()

/** `transfer(to, amount)` calldata; a non-integer `amount` throws rather than truncating. */
export function encodeErc20Transfer(to: string, amount: string): string {
  return ERC20.encodeFunctionData("transfer", [addressArg(to), BigInt(amount)])
}

export function encodeErc20Approve(spender: string, amount: string): string {
  return ERC20.encodeFunctionData("approve", [addressArg(spender), BigInt(amount)])
}

export async function readMaxFeePerGas(provider: JsonRpcProvider): Promise<string | undefined> {
  const { maxFeePerGas, gasPrice } = await provider.getFeeData()
  return (maxFeePerGas ?? gasPrice)?.toString()
}

export type SourceTxOutcome =
  | { status: "confirmed"; hash: string; blockNumber: number }
  | {
      status: "replaced"
      /** The replacement's hash. */
      hash: string
      originalHash: string
      reason: "repriced" | "cancelled" | "replaced"
    }
  | { status: "reverted"; hash: string }
  /** The watch window elapsed without a decision. Not a failure: the caller keeps waiting. */
  | { status: "pending" }

interface WatchSourceTransactionParams {
  hash: string
  from: string
  nonce: number
  to: string
  data: string
  value: string
  chainId: string
  /** Source-pinned block captured before the prompt. */
  startBlock: number
  timeoutMs: number
}

// ethers reports `to` as null for a contract creation, and an absent address must never
// compare equal to another absent one.
function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && eqAddress(a, b)
}

function toBigIntOrNull(value: string): bigint | null {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

// ethers computes its own `reason` but never checks the chain and compares `to`/`data` by exact
// string, so a repriced transaction is only adopted after this check against what we persisted
// before signing. `chainId` is compared only when the node reported one: some backends omit it
// on legacy transactions, and the provider is already pinned to the source chain.
function isEquivalentPayload(
  replacement: TransactionResponse,
  params: WatchSourceTransactionParams,
): boolean {
  if (!sameAddress(replacement.from, params.from)) return false
  if (!sameAddress(replacement.to, params.to)) return false
  if (replacement.data.toLowerCase() !== params.data.toLowerCase()) return false
  if (replacement.value !== toBigIntOrNull(params.value)) return false
  const expectedChainId = toBigIntOrNull(params.chainId)
  if (replacement.chainId && expectedChainId !== null && replacement.chainId !== expectedChainId) {
    return false
  }
  return true
}

/** A self-send of zero value with no calldata: the wallet's "cancel" transaction, mined at our nonce. */
function isSelfCancellation(replacement: TransactionResponse): boolean {
  return (
    replacement.data === "0x" &&
    sameAddress(replacement.to, replacement.from) &&
    replacement.value === 0n
  )
}

function classifyReplacement(
  replacement: TransactionResponse | undefined,
  params: WatchSourceTransactionParams,
): "repriced" | "cancelled" | "replaced" {
  if (!replacement) return "replaced"
  if (isEquivalentPayload(replacement, params)) return "repriced"
  if (isSelfCancellation(replacement)) return "cancelled"
  return "replaced"
}

function fromReceipt(receipt: TransactionReceipt): SourceTxOutcome {
  if (receipt.status === 0) return { status: "reverted", hash: receipt.hash }
  return { status: "confirmed", hash: receipt.hash, blockNumber: receipt.blockNumber }
}

const isBlockNumber = (value: number) => Number.isInteger(value) && value >= 0

// Rebuilds the response we lost so ethers' replacement scan can still run: `wait()` reads only
// hash, from, nonce, to, data, value and chain id, plus a start block. The rest is placeholder.
function reconstructTransactionResponse(
  provider: JsonRpcProvider,
  params: WatchSourceTransactionParams,
): TransactionResponse {
  return new TransactionResponse(
    {
      blockNumber: null,
      blockHash: null,
      hash: params.hash,
      index: 0,
      type: 0,
      // ethers compares the scanned block's addresses to these by exact string, and formatted responses are checksummed.
      to: getAddress(params.to.toLowerCase()),
      from: getAddress(params.from.toLowerCase()),
      nonce: params.nonce,
      gasLimit: 0n,
      gasPrice: 0n,
      maxPriorityFeePerGas: null,
      maxFeePerGas: null,
      maxFeePerBlobGas: null,
      data: params.data,
      value: BigInt(params.value),
      chainId: BigInt(params.chainId),
      signature: Signature.from(),
      accessList: null,
      blobVersionedHashes: null,
      authorizationList: null,
    },
    provider,
  )
}

// Replacement detection is ethers' own: `replaceableTransaction(startBlock)` arms the
// nonce-advance check inside `wait()`, which plain receipt polling cannot see.
// Every ambiguous outcome resolves to `pending` — no gap in our evidence proves a transfer was
// not broadcast, and `cancelled` is reported only for a mined cancellation at this exact nonce.
export async function watchSourceTransaction(
  provider: JsonRpcProvider,
  params: WatchSourceTransactionParams,
): Promise<SourceTxOutcome> {
  const { hash, startBlock, nonce, timeoutMs } = params

  if (!isBlockNumber(startBlock) || !isBlockNumber(nonce)) {
    const receipt = await provider.getTransactionReceipt(hash)
    return receipt ? fromReceipt(receipt) : { status: "pending" }
  }

  // A dropped transaction does not come back at all; then the persisted intent is the only thing left to scan with.
  const known = await provider.getTransaction(hash)
  const response = known ?? reconstructTransactionResponse(provider, params)

  try {
    const receipt = await response.replaceableTransaction(startBlock).wait(1, timeoutMs)
    return receipt ? fromReceipt(receipt) : { status: "pending" }
  } catch (error) {
    if (isError(error, "TRANSACTION_REPLACED")) {
      const replacement = error.replacement as TransactionResponse | undefined
      return {
        status: "replaced",
        hash: replacement?.hash ?? error.hash,
        originalHash: hash,
        reason: classifyReplacement(replacement, params),
      }
    }
    // ethers turns a status-0 receipt into CALL_EXCEPTION and carries the receipt.
    if (isError(error, "CALL_EXCEPTION") && error.receipt) {
      return { status: "reverted", hash: error.receipt.hash }
    }
    if (isError(error, "TIMEOUT")) return { status: "pending" }
    throw error
  }
}

// A plain lookup, stable across renders without memoization and with nothing to clean up.
export function useSourceChainProvider(chainId: string): JsonRpcProvider {
  return getPinnedProvider(chainId)
}

/** Token and native balances from the source chain itself, not from the aggregated balance service. */
export function usePinnedSourceBalances(params: {
  chainId: string
  owner: string
  token: string
  enabled: boolean
}) {
  const { chainId, owner, token, enabled } = params
  // Callers disable this by passing an empty chain id, so the provider is resolved inside the
  // query function rather than during render, where an unknown chain would throw.
  return useQuery({
    queryKey: depositQueryKeys.sourceBalances(chainId, owner, token).queryKey,
    queryFn: () => readSourceBalances(getPinnedProvider(chainId), { owner, token }),
    enabled: enabled && !!depositApiRpcUrl(chainId) && !!owner && !!token,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}
