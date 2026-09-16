import type { TransactionReceipt } from "ethers"
import {
  getAddress,
  Interface,
  isError,
  JsonRpcProvider,
  Signature,
  TransactionResponse,
} from "ethers"
import { useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { RouterChainJson } from "@/pages/bridge/data/chains"
import { useFindSkipChain } from "@/pages/bridge/data/chains"
import { depositQueryKeys } from "../data/api"
import { depositApiRpcUrl } from "./depositSources"

// `ChainTypeJson` is a type-only enum from the Router client; the wire value is the string.
const EVM_CHAIN_TYPE = "evm" as RouterChainJson["chain_type"]

/** No usable RPC for the source chain: a capability gap, never evidence about a transaction. */
export class PinnedRpcUnavailableError extends Error {}

/**
 * Pinned to one source chain: the wallet's provider follows whatever network the user switches
 * to, so a receipt read through it can come from the wrong chain while a transfer is in flight.
 * `staticNetwork` stops ethers from silently re-detecting and reintroducing that drift.
 */
export function createPinnedProvider(
  chain: Pick<RouterChainJson, "chain_id" | "rpc" | "chain_type">,
): JsonRpcProvider {
  const { chain_id, rpc, chain_type } = chain
  if (chain_type !== "evm") {
    throw new PinnedRpcUnavailableError(`Chain ${chain_id} is not an EVM chain`)
  }
  if (!rpc) {
    throw new PinnedRpcUnavailableError(`Chain ${chain_id} has no RPC endpoint`)
  }
  const chainId = Number(chain_id)
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new PinnedRpcUnavailableError(`Chain id is not an EVM chain id: ${chain_id}`)
  }
  return new JsonRpcProvider(rpc, chainId, { staticNetwork: true })
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
export interface SourceBalances {
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

/** The pinned head block. Captured before each wallet prompt as the lower bound for replacement scanning. */
export async function readBlockNumber(provider: JsonRpcProvider): Promise<number> {
  return provider.getBlockNumber()
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

export interface WatchSourceTransactionParams {
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

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
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

// One pinned provider per source chain. The Deposit API catalog's receipt-capable endpoint wins
// over the Router entry (see DepositApiSource.rpcUrl). Null means "cannot verify" — a capability
// gap, never a reason to unmount a screen that reports on funds in flight.
export function useSourceChainProvider(chainId: string): JsonRpcProvider | null {
  const findSkipChain = useFindSkipChain()
  const provider = useMemo(() => {
    if (!chainId) return null
    const rpc = depositApiRpcUrl(chainId)
    if (rpc) return createPinnedProvider({ chain_id: chainId, chain_type: EVM_CHAIN_TYPE, rpc })
    try {
      return createPinnedProvider(findSkipChain(chainId))
    } catch {
      return null
    }
    // findSkipChain is a fresh closure every render; the chain id is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId])

  // ethers keeps a polling loop alive once `wait()` subscribed to blocks. Drop the listeners
  // rather than `destroy()`: StrictMode's mount → cleanup → mount would otherwise leave a
  // permanently dead provider whose every read rejects before reaching the network.
  useEffect(() => () => void provider?.removeAllListeners(), [provider])
  return provider
}

/** Token and native balances from the source chain itself, not from the aggregated balance service. */
export function usePinnedSourceBalances(params: {
  chainId: string
  owner: string
  token: string
  enabled: boolean
}) {
  const { chainId, owner, token, enabled } = params
  const provider = useSourceChainProvider(chainId)
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the provider is derived from chainId, already in the key
    queryKey: depositQueryKeys.sourceBalances(chainId, owner, token).queryKey,
    queryFn: () => readSourceBalances(provider!, { owner, token }),
    enabled: enabled && !!provider && !!owner && !!token,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}
