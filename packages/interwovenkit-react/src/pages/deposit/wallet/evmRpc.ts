import type { TransactionResponse } from "ethers"
import { FetchRequest, Interface, JsonRpcProvider } from "ethers"
import { useQuery } from "@tanstack/react-query"
import { depositQueryKeys } from "../data/api"
import { eqAddress } from "../data/parse"
import type { DepositSession } from "./depositSession"
import { depositApiRpcUrl } from "./depositSources"

export const SOURCE_READ_REFRESH_MS = 15_000

// One per chain for the tab's lifetime: ethers keeps a polling loop alive once `waitForTransaction` subscribed.
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
  | { status: "confirmed" | "reverted" }
  /** `nextBlock` is where the next check resumes a replacement scan. */
  | { status: "pending"; nextBlock?: number }
  /** `hash` is the replacement's. */
  | { status: "replaced"; hash: string; reason: "repriced" | "cancelled" | "replaced" }

type WatchedSend = Pick<DepositSession, "source" | "transaction" | "preSubmitBlock" | "sourceNonce">

const sameAddress = (a: string | null, b: string | null) => !!a && !!b && eqAddress(a, b)

function classifyReplacement(replacement: TransactionResponse, send: WatchedSend) {
  const { to, data, value, chainId } = send.transaction
  const isRepriced =
    sameAddress(replacement.to, to) &&
    replacement.data.toLowerCase() === data.toLowerCase() &&
    replacement.value.toString() === value &&
    (!replacement.chainId || replacement.chainId.toString() === chainId)
  if (isRepriced) return "repriced"
  const isCancelled =
    replacement.data === "0x" &&
    sameAddress(replacement.to, replacement.from) &&
    replacement.value === 0n
  return isCancelled ? "cancelled" : "replaced"
}

const SCAN_BLOCKS_PER_CHECK = 25
// Re-read behind the cursor, so a reorg that moves the replacement lower is still found.
const REORG_OVERLAP_BLOCKS = 3

// Every gap in the evidence is `pending`: only a mined transaction at our nonce, with its own
// receipt from that block, proves a replacement.
export async function checkSourceTransaction(
  provider: JsonRpcProvider,
  hash: string,
  send: WatchedSend,
  resumeBlock?: number,
): Promise<SourceTxOutcome> {
  const { sourceNonce: nonce, preSubmitBlock: startBlock } = send
  const { sender } = send.source
  const [receipt, mined] = await Promise.all([
    provider.getTransactionReceipt(hash),
    nonce === undefined ? undefined : provider.getTransactionCount(sender, "latest"),
  ])
  if (receipt) return { status: receipt.status === 0 ? "reverted" : "confirmed" }
  if (nonce === undefined || startBlock === undefined || mined === undefined || mined <= nonce) {
    return { status: "pending" }
  }

  const head = await provider.getBlockNumber()
  const cursor = Math.max(startBlock, resumeBlock ?? startBlock)
  const first = Math.max(startBlock, cursor - REORG_OVERLAP_BLOCKS)
  const last = Math.min(head, first + SCAN_BLOCKS_PER_CHECK - 1)
  for (let number = first; number <= last; number++) {
    const block = await provider.getBlock(number, true)
    if (!block) return { status: "pending", nextBlock: number }
    const taken = block.prefetchedTransactions.find(
      (tx) => sameAddress(tx.from, sender) && tx.nonce === nonce,
    )
    if (!taken) continue
    // Our own transaction with a lagging receipt.
    if (taken.hash.toLowerCase() === hash.toLowerCase())
      return { status: "pending", nextBlock: number }
    const replacement = await provider.getTransactionReceipt(taken.hash)
    if (replacement?.blockNumber !== number) return { status: "pending", nextBlock: number }
    return { status: "replaced", hash: taken.hash, reason: classifyReplacement(taken, send) }
  }
  // Never backwards: a lagging node's lower head must not undo progress.
  return { status: "pending", nextBlock: Math.max(cursor, last + 1) }
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

export function useSenderNonces(
  chainId: string,
  sender: string,
  refetchInterval: (nonces?: SenderNonces) => number | false,
) {
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
    refetchInterval: (query) => refetchInterval(query.state.data),
  })
}
