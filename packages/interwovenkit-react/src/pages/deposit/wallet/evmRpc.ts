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

/** The source chain has no usable RPC in the Router registry, so no pinned read is possible. A capability gap — never evidence about a transaction. */
export class PinnedRpcUnavailableError extends Error {}

/**
 * A provider pinned to one source chain, built from the Router registry entry
 * rather than the wallet's BrowserProvider. The wallet's provider follows
 * whatever network the user switches to, so a receipt read through it can come
 * from the wrong chain — or fail — while a transfer is in flight.
 *
 * `staticNetwork: true` with an explicit chain id stops ethers from re-detecting
 * the network on every call: the pin is the point, and a silent re-detect would
 * reintroduce exactly the drift we are avoiding.
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

/**
 * One `eth_call` decoded to a base-unit decimal string. An empty response means
 * the address holds no contract (wrong chain, wrong token) — decoding it would
 * silently yield zero, and a zero allowance reads as "approval needed" while a
 * zero balance reads as "insufficient funds". Both are guesses about money, so
 * this throws instead.
 */
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

/** Token balance and native (gas) balance for one owner, both read through the pinned provider. */
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

/** Current ERC-20 allowance in base units. */
export async function readAllowance(
  provider: JsonRpcProvider,
  params: { owner: string; token: string; spender: string },
): Promise<string> {
  const { owner, token, spender } = params
  return readErc20Uint(provider, token, "allowance", [owner, spender])
}

// ethers rejects a mixed-case address whose EIP-55 checksum does not match, but
// accepts all-lowercase. The API validates issued addresses by shape only, so
// lowercase before encoding: the bytes are identical, and a bad checksum must
// surface as a readiness problem, not a throw during render.
const addressArg = (address: string) => address.toLowerCase()

/** `transfer(to, amount)` calldata. `amount` is base units; a non-integer input throws rather than truncating. */
export function encodeErc20Transfer(to: string, amount: string): string {
  return ERC20.encodeFunctionData("transfer", [addressArg(to), BigInt(amount)])
}

/** `approve(spender, amount)` calldata. */
export function encodeErc20Approve(spender: string, amount: string): string {
  return ERC20.encodeFunctionData("approve", [addressArg(spender), BigInt(amount)])
}

/** The pinned head block. Captured before each wallet prompt as the lower bound for replacement scanning. */
export async function readBlockNumber(provider: JsonRpcProvider): Promise<number> {
  return provider.getBlockNumber()
}

/** The chain's current max fee per gas as a base-unit string, or undefined when the node reports none. */
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

/**
 * Is the mined replacement the same intent, only repriced? Compared against what
 * we persisted before signing, not against anything the replacement asserts
 * about itself. ethers computes its own `reason`, but it never checks the chain
 * and compares `to`/`data` by exact string, so a repriced transaction is only
 * adopted here after this check passes.
 *
 * `chainId` is checked only when the node reported one: some backends omit it on
 * legacy transactions and ethers then leaves it null. The provider is pinned to
 * the source chain and the scan walks that chain's blocks, so a missing field is
 * not a chain mismatch.
 */
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

/**
 * Rebuilds the response we lost so ethers' own replacement scan can still run.
 * `wait()` only needs hash, from, nonce, to, data, value and chain id — the
 * fields we persisted before signing — plus a start block. Everything else is a
 * placeholder, including the signature: it is never verified, only carried.
 */
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
      // Checksummed: ethers compares the scanned block's `from` to this one by
      // exact string, and formatted responses are always checksummed.
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

/**
 * Watches one source transaction on the pinned provider until it is decided or
 * the window elapses.
 *
 * Replacement detection is ethers' own: `replaceableTransaction(startBlock)`
 * arms the nonce-advance check inside `wait()`, which scans from that block for
 * the sender's nonce and throws `TRANSACTION_REPLACED` when another transaction
 * took it. Plain receipt polling cannot see that, which is why the start block
 * is captured before every prompt.
 *
 * Every ambiguous outcome resolves to `pending`. A timeout, a missing start
 * block and a missing nonce are all gaps in our evidence, and none of them
 * proves a transfer was not broadcast — `cancelled` is reported only for a mined
 * cancellation that replaced this exact nonce.
 */
export async function watchSourceTransaction(
  provider: JsonRpcProvider,
  params: WatchSourceTransactionParams,
): Promise<SourceTxOutcome> {
  const { hash, startBlock, nonce, timeoutMs } = params

  if (!isBlockNumber(startBlock) || !isBlockNumber(nonce)) {
    const receipt = await provider.getTransactionReceipt(hash)
    return receipt ? fromReceipt(receipt) : { status: "pending" }
  }

  // A mined transaction comes back fully populated; a dropped one does not come
  // back at all, and then the persisted intent is the only thing left to scan
  // with.
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

/**
 * One pinned provider per source chain, kept across renders so sequential reads
 * reuse the same connection. The Deposit API catalog's receipt-capable endpoint
 * wins over the Router entry (see DepositApiSource.rpcUrl). Returns null for any
 * failure — no RPC, a chain the Router does not list — because that is a
 * capability gap the caller renders as "cannot verify", never a reason to unmount
 * a screen that reports on funds in flight.
 */
export function useSourceChainProvider(chainId: string): JsonRpcProvider | null {
  const findSkipChain = useFindSkipChain()
  const provider = useMemo(() => {
    if (!chainId) return null
    // A supported source chain needs no registry read: its endpoint is in the
    // catalog, so tracking a transfer in flight does not depend on the Router.
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

  // ethers keeps a polling loop alive once `wait()` subscribed to blocks;
  // release it when the chain changes or the screen goes away.
  useEffect(() => () => provider?.destroy(), [provider])
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
