import type { TransactionReceipt } from "ethers"
import {
  FetchRequest,
  getAddress,
  Interface,
  isError,
  JsonRpcProvider,
  Signature,
  TransactionResponse,
} from "ethers"
import { useQuery } from "@tanstack/react-query"
import { depositQueryKeys } from "../data/api"
import { eqAddress, isNonNegativeInteger } from "../data/parse"
import { depositApiRpcUrl } from "./depositSources"

export const SOURCE_READ_REFRESH_MS = 15_000

// One per chain for the tab's lifetime: ethers keeps a polling loop alive once `wait()` subscribed.
const pinnedProviders = new Map<string, JsonRpcProvider>()
const RPC_TIMEOUT_MS = 10_000

export function getPinnedProvider(chainId: string): JsonRpcProvider {
  const existing = pinnedProviders.get(chainId)
  if (existing) return existing
  const rpcUrl = depositApiRpcUrl(chainId)
  if (!rpcUrl) throw new Error(`Chain ${chainId} has no pinned RPC`)
  const request = new FetchRequest(rpcUrl)
  // A hung public endpoint must fail and retry, not spin for ethers' five-minute default.
  request.timeout = RPC_TIMEOUT_MS
  const provider = new JsonRpcProvider(request, Number(chainId), { staticNetwork: true })
  pinnedProviders.set(chainId, provider)
  return provider
}

const ERC20 = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
])

// An empty response means no contract at that address; decoding it would read as zero.
export async function readErc20Uint(
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

// ethers rejects a mixed-case address with a bad EIP-55 checksum; the API checks shape only.
const addressArg = (address: string) => address.toLowerCase()

export function encodeErc20Transfer(to: string, amount: string): string {
  return ERC20.encodeFunctionData("transfer", [addressArg(to), BigInt(amount)])
}

export function encodeErc20Approve(spender: string, amount: string): string {
  return ERC20.encodeFunctionData("approve", [addressArg(spender), BigInt(amount)])
}

// Only a successful receipt counts; the allowance re-read still decides whether another approval is needed.
export async function waitForApproval(
  provider: Pick<JsonRpcProvider, "waitForTransaction">,
  hash: string,
  timeoutMs: number,
): Promise<void> {
  const receipt = await provider.waitForTransaction(hash, 1, timeoutMs)
  if (receipt?.status !== 1) throw new Error("The USDC approval did not go through")
}

export type SourceTxOutcome =
  | { status: "confirmed" | "reverted" | "pending" }
  /** `hash` is the replacement's. */
  | { status: "replaced"; hash: string; reason: "repriced" | "cancelled" | "replaced" }

interface WatchSourceTransactionParams {
  hash: string
  from: string
  nonce: number
  to: string
  data: string
  value: string
  chainId: string
  startBlock: number
  timeoutMs: number
}

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

// ethers' own `reason` never checks the chain and compares `to`/`data` by exact string.
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
  return { status: receipt.status === 0 ? "reverted" : "confirmed" }
}

// `wait()` reads only hash, from, nonce, to, data, value and chain id; the rest is placeholder.
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
      // ethers compares these to checksummed addresses by exact string.
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

// Every ambiguous outcome is `pending`: no gap in the evidence proves a transfer was not broadcast.
export async function watchSourceTransaction(
  provider: JsonRpcProvider,
  params: WatchSourceTransactionParams,
): Promise<SourceTxOutcome> {
  const { hash, startBlock, nonce, timeoutMs } = params

  if (!isNonNegativeInteger(startBlock) || !isNonNegativeInteger(nonce)) {
    const receipt = await provider.getTransactionReceipt(hash)
    return receipt ? fromReceipt(receipt) : { status: "pending" }
  }

  // The persisted intent carries everything the scan compares, and survives a dropped transaction.
  const response = reconstructTransactionResponse(provider, params)

  try {
    const receipt = await response.replaceableTransaction(startBlock).wait(1, timeoutMs)
    return receipt ? fromReceipt(receipt) : { status: "pending" }
  } catch (error) {
    if (isError(error, "TRANSACTION_REPLACED")) {
      const replacement = error.replacement as TransactionResponse | undefined
      return {
        status: "replaced",
        hash: replacement?.hash ?? error.hash,
        reason: classifyReplacement(replacement, params),
      }
    }
    if (isError(error, "CALL_EXCEPTION") && error.receipt) return { status: "reverted" }
    if (isError(error, "TIMEOUT")) return { status: "pending" }
    throw error
  }
}

export function usePinnedSourceBalances(params: { chainId: string; owner: string; token: string }) {
  const { chainId, owner, token } = params
  return useQuery({
    queryKey: depositQueryKeys.sourceBalances(chainId, owner, token).queryKey,
    queryFn: () => readSourceBalances(getPinnedProvider(chainId), { owner, token }),
    enabled: !!owner && !!depositApiRpcUrl(chainId),
    staleTime: 10_000,
    refetchInterval: SOURCE_READ_REFRESH_MS,
  })
}

export function useSourceChainHead(chainId: string) {
  return useQuery({
    queryKey: depositQueryKeys.sourceHead(chainId).queryKey,
    queryFn: async () => {
      const provider = getPinnedProvider(chainId)
      const [block, feeData] = await Promise.all([
        provider.getBlockNumber(),
        // A missing fee only narrows the gate to the call's own value.
        provider.getFeeData().catch(() => undefined),
      ])
      const maxFeePerGas = feeData?.maxFeePerGas ?? feeData?.gasPrice
      return { block, maxFeePerGas: maxFeePerGas?.toString() }
    },
    staleTime: SOURCE_READ_REFRESH_MS,
    refetchInterval: SOURCE_READ_REFRESH_MS,
  })
}

export interface SenderNonces {
  latest: number
  pending: number
}

export function useSenderNonces(chainId: string, sender: string, refetchInterval: number) {
  return useQuery({
    queryKey: depositQueryKeys.senderNonces(chainId, sender).queryKey,
    queryFn: async (): Promise<SenderNonces> => {
      const provider = getPinnedProvider(chainId)
      const [latest, pending] = await Promise.all([
        provider.getTransactionCount(sender, "latest"),
        provider.getTransactionCount(sender, "pending"),
      ])
      return { latest, pending }
    },
    enabled: !!sender && !!depositApiRpcUrl(chainId),
    staleTime: 0,
    retry: false,
    refetchInterval,
  })
}
