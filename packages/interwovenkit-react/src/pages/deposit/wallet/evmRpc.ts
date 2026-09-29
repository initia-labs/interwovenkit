import type { JsonRpcPayload, JsonRpcResult, TransactionResponse } from "ethers"
import { FetchRequest, Interface, JsonRpcProvider } from "ethers"
import { useQuery } from "@tanstack/react-query"
import { depositQueryKeys } from "../data/api"
import { eqAddress } from "../data/parse"
import type { DepositSession } from "./depositSession"
import { depositApiRpcUrls } from "./depositSources"

export const SOURCE_READ_REFRESH_MS = 15_000

// One per chain for the tab's lifetime.
const pinnedProviders = new Map<string, JsonRpcProvider>()
const RPC_TIMEOUT_MS = 10_000

function rpcRequest(url: string): FetchRequest {
  const request = new FetchRequest(url)
  // A hung or rate-limited public endpoint must fail over, not spin for ethers' five-minute
  // default or its own backoff on a 429.
  request.timeout = RPC_TIMEOUT_MS
  request.setThrottleParams({ maxAttempts: 1 })
  return request
}

// Tries each URL in order when a request times out or gets a non-OK response. A JSON-RPC error in
// the body, such as a revert, is a real answer and never fails over. The node that answered last is
// tried first, so a session stays on one node while it's healthy.
export class FailoverRpcProvider extends JsonRpcProvider {
  readonly #urls: readonly string[]
  #active = 0

  constructor(urls: readonly string[], chainId: number) {
    super(rpcRequest(urls[0]), chainId, { staticNetwork: true })
    this.#urls = urls
  }

  override async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    let lastError: unknown
    for (let offset = 0; offset < this.#urls.length; offset++) {
      const index = (this.#active + offset) % this.#urls.length
      const request = rpcRequest(this.#urls[index])
      request.body = JSON.stringify(payload)
      request.setHeader("content-type", "application/json")
      try {
        const response = await request.send()
        response.assertOk()
        const body = response.bodyJson
        this.#active = index
        return Array.isArray(body) ? body : [body]
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
}

export function getPinnedProvider(chainId: string): JsonRpcProvider {
  const existing = pinnedProviders.get(chainId)
  if (existing) return existing
  const rpcUrls = depositApiRpcUrls(chainId)
  if (!rpcUrls?.length) throw new Error(`Chain ${chainId} has no pinned RPC`)
  const provider = new FailoverRpcProvider(rpcUrls, Number(chainId))
  pinnedProviders.set(chainId, provider)
  return provider
}

const ERC20 = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
])

// Lowercase skips ethers' checksum validation, which rejects a mixed-case address with a bad checksum.
const addressArg = (address: string) => address.toLowerCase()

// An empty response means no contract at that address; decoding it would read as zero.
export async function readErc20Uint(
  provider: JsonRpcProvider,
  token: string,
  fragment: "balanceOf" | "allowance",
  args: string[],
): Promise<string> {
  const data = ERC20.encodeFunctionData(fragment, args.map(addressArg))
  const result = await provider.call({ to: token, data })
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
export function encodeErc20Transfer(to: string, amount: string): string {
  return ERC20.encodeFunctionData("transfer", [addressArg(to), BigInt(amount)])
}

export function encodeErc20Approve(spender: string, amount: string): string {
  return ERC20.encodeFunctionData("approve", [addressArg(spender), BigInt(amount)])
}

const APPROVAL_POLL_MS = 2_000
// Once the approval is mined and a node has its nonce, the allowance catches up within a few blocks.
const APPROVAL_SETTLE_MS = 10_000
export const SHORT_APPROVAL_MESSAGE =
  "The approved amount is less than this deposit. Approve again without lowering the amount."

interface PendingApproval {
  hash: string
  /** The approval's own nonce: the deposit's baseline must come after it. */
  nonce: number
  owner: string
  token: string
  spender: string
  amount: string
}

interface ConfirmedApproval {
  allowance: string
  nonces: SenderNonces
}

// Resolves once one read shows the allowance covering the amount and the approval's nonce mined:
// a wallet speed-up gives the approval a new hash, and a node behind the receipt would still read
// the old allowance and nonce.
export async function waitForApproval(
  provider: JsonRpcProvider,
  { hash, nonce, owner, token, spender, amount }: PendingApproval,
  timeoutMs: number,
): Promise<ConfirmedApproval> {
  const deadline = Date.now() + timeoutMs
  let settledAt: number | undefined
  do {
    // A failed read is only "not yet"; the deadline bounds the wait.
    const [receipt, allowance, latest, pending] = await Promise.all([
      provider.getTransactionReceipt(hash).catch(() => null),
      readErc20Uint(provider, token, "allowance", [owner, spender]).catch(() => undefined),
      provider.getTransactionCount(owner, "latest").catch(() => undefined),
      provider.getTransactionCount(owner, "pending").catch(() => undefined),
    ])
    if (receipt && receipt.status !== 1) break
    // Both nonces become the deposit's baseline, so each must be a real read past the approval.
    if (
      allowance !== undefined &&
      BigInt(allowance) >= BigInt(amount) &&
      latest !== undefined &&
      pending !== undefined &&
      latest > nonce
    ) {
      return { allowance, nonces: { latest, pending: Math.max(latest, pending) } }
    }
    // A wallet that let the user lower the spending cap mined a smaller approval than needed. Only a
    // successful read that shows the shortfall counts; a failed one says nothing.
    if (receipt && allowance !== undefined && latest !== undefined && latest > nonce) {
      settledAt ??= Date.now()
      if (Date.now() - settledAt >= APPROVAL_SETTLE_MS) throw new Error(SHORT_APPROVAL_MESSAGE)
    }
    await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS))
  } while (Date.now() < deadline)
  throw new Error("The USDC approval did not go through")
}

export type SourceTxOutcome =
  | { status: "confirmed" | "reverted" }
  /**
   * `nextBlock` is where the next check resumes a replacement scan; `nonce` is the send's, when the
   * session had none and the transaction itself supplied it.
   */
  | { status: "pending"; nextBlock?: number; nonce?: number }
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
  // A hash recovered from a failed send has no nonce; the transaction has it while a node knows it.
  if (send.sourceNonce === undefined) {
    const nonce = (await provider.getTransaction(hash).catch(() => null))?.nonce
    if (nonce !== undefined) {
      const outcome = await checkSourceTransaction(
        provider,
        hash,
        { ...send, sourceNonce: nonce },
        resumeBlock,
      )
      return outcome.status === "pending" ? { ...outcome, nonce } : outcome
    }
  }
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
    // A failed or missing block keeps the progress so far for the next check to resume from.
    const block = await provider.getBlock(number, true).catch(() => null)
    if (!block) return { status: "pending", nextBlock: Math.max(cursor, number) }
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
    enabled: !!owner && !!depositApiRpcUrls(chainId),
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
    enabled: !!depositApiRpcUrls(chainId),
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
    enabled: !!sender && !!depositApiRpcUrls(chainId),
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => refetchInterval(query.state.data),
  })
}
