import type { Hex } from "viem"
import { decodeFunctionData, keccak256, parseAbi, parseTransaction } from "viem"

/* Source-chain EVM RPC fake.
 *
 * Both the in-memory test wallet (`createTestWalletConnector` → viem → `fetch`)
 * and the widget's pinned reads (`wallet/evmRpc.ts` → ethers `JsonRpcProvider`)
 * talk to the same three publicnode URLs, so intercepting those three URLs is
 * enough to guarantee that nothing this suite does can reach a real node — and
 * in particular that `eth_sendRawTransaction` never leaves the browser.
 *
 * ethers batches JSON-RPC calls, so a request body may be an array. */

/**
 * Host → chain id for every EVM RPC endpoint this flow can reach.
 *
 * Two independent sources decide these: the in-memory test wallet's built-in
 * CORS-safe defaults (publicnode), and the widget's own pinned reads, which
 * prefer the Deposit API catalog's receipt-capable endpoint
 * (`DepositApiSource.rpcUrl`) over the Router registry entry. Both are listed so
 * one chain's state is shared no matter which endpoint asked.
 *
 * Any EVM RPC call to a host missing from this map is treated as an escape and
 * fails the test, so a future endpoint change surfaces instead of quietly
 * reaching a real node.
 */
export const RPC_HOSTS: Record<string, number> = {
  "ethereum-rpc.publicnode.com": 1,
  "base-rpc.publicnode.com": 8453,
  "arbitrum-one-rpc.publicnode.com": 42161,
  "mainnet.base.org": 8453,
  "arb1.arbitrum.io": 42161,
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
])

export interface SentTransaction {
  chainId: number
  /** Raw signed payload as broadcast. */
  raw: Hex
  hash: Hex
  to: string
  value: string
  data: string
  nonce: number
}

export interface ChainState {
  /** Head block at t0; the mock advances it with the wall clock so ethers' block
   * poller (and therefore its replacement scan) keeps making progress. */
  blockNumber: number
  /** Native balance in wei, decimal string. */
  native: string
  /** token (lowercase) → base-unit balance. */
  tokenBalances: Record<string, string>
  /** `${token}:${spender}` (lowercase) → base-unit allowance. */
  allowances: Record<string, string>
  /** Next nonce for the sender; incremented on every accepted broadcast. */
  nonce: number
  /** Receipt reads that answer `null` before the transaction is reported mined. */
  receiptPendingReads: number
  /** 1 = success, 0 = reverted. */
  receiptStatus: 0 | 1
  /** When set, `eth_sendRawTransaction` answers with this JSON-RPC error. */
  sendError?: { code: number; message: string }
  /** An accepted `approve(spender, amount)` raises the tracked allowance. */
  approvalsRaiseAllowance: boolean
}

export interface RpcMock {
  /** Per-chain state; mutate before (or during) a test to script a scenario. */
  chains: Record<number, ChainState>
  /** Every `eth_sendRawTransaction` the browser attempted, in order. */
  sent: SentTransaction[]
  /** Every JSON-RPC method seen, per chain. */
  methods: { chainId: number; method: string }[]
  /** Decoded `eth_call` reads, for debugging a balance/allowance miss. */
  reads: { chainId: number; to: string; fn: string; result: string }[]
  state(chainId: number): ChainState
  /** Answers one JSON-RPC body (single or ethers-batched). */
  handle(chainId: number, payload: unknown): unknown
}

const HUGE_NATIVE = "1000000000000000000" // 1 ETH, enough for the gas gate

function defaultChainState(): ChainState {
  return {
    blockNumber: 21_000_000,
    native: HUGE_NATIVE,
    tokenBalances: {},
    allowances: {},
    nonce: 7,
    receiptPendingReads: 0,
    receiptStatus: 1,
    approvalsRaiseAllowance: true,
  }
}

const hex = (value: bigint | number) => `0x${BigInt(value).toString(16)}`
const word = (value: bigint | string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`
const pseudoHash = (seed: string) => keccak256(Buffer.from(seed, "utf8") as unknown as Uint8Array)

interface RpcCall {
  jsonrpc?: string
  id?: number | string
  method: string
  params?: unknown[]
}

export function createRpcMock(sender: string): RpcMock {
  const startedAt = Date.now()
  const mock: RpcMock = {
    chains: { 1: defaultChainState(), 8453: defaultChainState(), 42161: defaultChainState() },
    sent: [],
    methods: [],
    reads: [],
    state: (chainId) => (mock.chains[chainId] ??= defaultChainState()),
    handle: (chainId, payload) =>
      Array.isArray(payload)
        ? payload.map((entry) => respond(chainId, entry as RpcCall))
        : respond(chainId, payload as RpcCall),
  }

  // Transactions the fake node has "seen", keyed by hash.
  const mined = new Map<string, { chainId: number; tx: SentTransaction; reads: number }>()

  const head = (chainId: number) =>
    mock.state(chainId).blockNumber + Math.floor((Date.now() - startedAt) / 2000)

  function block(chainId: number, number: number) {
    return {
      hash: pseudoHash(`block:${chainId}:${number}`),
      parentHash: pseudoHash(`block:${chainId}:${number - 1}`),
      number: hex(number),
      timestamp: hex(Math.floor(startedAt / 1000) + number),
      nonce: "0x0000000000000000",
      difficulty: "0x0",
      gasLimit: "0x1c9c380",
      gasUsed: "0x5208",
      miner: "0x0000000000000000000000000000000000000000",
      extraData: "0x",
      baseFeePerGas: "0x3b9aca00",
      stateRoot: pseudoHash(`state:${chainId}:${number}`),
      receiptsRoot: pseudoHash(`receipts:${chainId}:${number}`),
      transactionsRoot: pseudoHash(`txs:${chainId}:${number}`),
      sha3Uncles: pseudoHash("uncles"),
      logsBloom: `0x${"0".repeat(512)}`,
      size: "0x220",
      totalDifficulty: "0x0",
      uncles: [],
      transactions: [],
    }
  }

  function transactionResponse(chainId: number, entry: { tx: SentTransaction }, isMined: boolean) {
    const { tx } = entry
    const number = head(chainId)
    return {
      hash: tx.hash,
      type: "0x2",
      blockHash: isMined ? pseudoHash(`block:${chainId}:${number}`) : null,
      blockNumber: isMined ? hex(number) : null,
      transactionIndex: isMined ? "0x0" : null,
      from: sender,
      to: tx.to,
      gas: "0x186a0",
      gasPrice: "0x3b9aca00",
      maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0x3b9aca00",
      value: hex(BigInt(tx.value)),
      nonce: hex(tx.nonce),
      input: tx.data,
      chainId: hex(chainId),
      accessList: [],
      // Structurally valid signature: ethers only carries it, never verifies it.
      v: "0x1b",
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      yParity: "0x0",
    }
  }

  function receipt(chainId: number, entry: { tx: SentTransaction }) {
    const { tx } = entry
    const number = head(chainId)
    return {
      transactionHash: tx.hash,
      transactionIndex: "0x0",
      blockHash: pseudoHash(`block:${chainId}:${number}`),
      blockNumber: hex(number),
      from: sender,
      to: tx.to,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: [],
      logsBloom: `0x${"0".repeat(512)}`,
      status: hex(mock.state(chainId).receiptStatus),
      type: "0x2",
      root: null,
    }
  }

  function call(chainId: number, params: unknown[]): string {
    const [request] = params as [{ to?: string; data?: string }]
    const state = mock.state(chainId)
    const to = (request.to ?? "").toLowerCase()
    if (!request.data) return "0x"
    let decoded: { functionName: string; args: readonly unknown[] | undefined }
    try {
      decoded = decodeFunctionData({ abi: ERC20_ABI, data: request.data as Hex })
    } catch {
      return "0x"
    }
    if (decoded.functionName === "balanceOf") {
      const result = state.tokenBalances[to] ?? "0"
      mock.reads.push({ chainId, to, fn: "balanceOf", result })
      return word(result)
    }
    if (decoded.functionName === "allowance") {
      const [, spender] = decoded.args as [string, string]
      const result = state.allowances[`${to}:${spender.toLowerCase()}`] ?? "0"
      mock.reads.push({ chainId, to, fn: `allowance:${spender.toLowerCase()}`, result })
      return word(result)
    }
    return "0x"
  }

  function sendRawTransaction(chainId: number, params: unknown[]): string {
    const state = mock.state(chainId)
    if (state.sendError) {
      const error = state.sendError
      throw Object.assign(new Error(error.message), { rpcError: error })
    }
    const raw = (params as [Hex])[0]
    const parsed = parseTransaction(raw)
    const hash = keccak256(raw)
    const entry: SentTransaction = {
      chainId,
      raw,
      hash,
      to: parsed.to ?? "",
      value: (parsed.value ?? 0n).toString(),
      data: parsed.data ?? "0x",
      nonce: parsed.nonce ?? state.nonce,
    }
    mock.sent.push(entry)
    mined.set(hash.toLowerCase(), { chainId, tx: entry, reads: 0 })
    state.nonce = entry.nonce + 1

    // An accepted approval raises the allowance the next read observes, the way
    // a real chain would once the approval is mined.
    if (state.approvalsRaiseAllowance && entry.data.startsWith("0x095ea7b3")) {
      try {
        const decoded = decodeFunctionData({ abi: ERC20_ABI, data: entry.data as Hex })
        if (decoded.functionName === "approve") {
          const [spender, amount] = decoded.args as [string, bigint]
          state.allowances[`${entry.to.toLowerCase()}:${spender.toLowerCase()}`] = amount.toString()
        }
      } catch {
        // A malformed approval is the test's problem, not the node's.
      }
    }
    return hash
  }

  function handle(chainId: number, request: RpcCall): unknown {
    const state = mock.state(chainId)
    const params = request.params ?? []
    mock.methods.push({ chainId, method: request.method })

    switch (request.method) {
      case "eth_chainId":
        return hex(chainId)
      case "net_version":
        return String(chainId)
      case "eth_blockNumber":
        return hex(head(chainId))
      case "eth_getBlockByNumber": {
        const [tag] = params as [string]
        const number =
          typeof tag === "string" && tag.startsWith("0x") ? Number(BigInt(tag)) : head(chainId)
        return block(chainId, number)
      }
      case "eth_getBlockByHash":
        return block(chainId, head(chainId))
      case "eth_getBalance":
        return hex(BigInt(state.native))
      case "eth_getCode":
        return "0x60806040"
      case "eth_call":
        return call(chainId, params)
      case "eth_estimateGas":
        return "0x186a0"
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x3b9aca00"
      case "eth_feeHistory":
        return {
          oldestBlock: hex(head(chainId)),
          baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
          gasUsedRatio: [0.5],
          reward: [["0x3b9aca00"]],
        }
      case "eth_getTransactionCount":
        return hex(state.nonce)
      case "eth_sendRawTransaction":
        return sendRawTransaction(chainId, params)
      case "eth_getTransactionByHash": {
        const [hash] = params as [string]
        const entry = mined.get(hash.toLowerCase())
        if (!entry) return null
        return transactionResponse(chainId, entry, entry.reads >= state.receiptPendingReads)
      }
      case "eth_getTransactionReceipt": {
        const [hash] = params as [string]
        const entry = mined.get(hash.toLowerCase())
        if (!entry) return null
        if (entry.reads < state.receiptPendingReads) {
          entry.reads += 1
          return null
        }
        return receipt(chainId, entry)
      }
      case "eth_accounts":
        return []
      case "eth_syncing":
        return false
      default:
        throw Object.assign(new Error(`unmocked method ${request.method}`), {
          rpcError: { code: -32601, message: `unmocked method ${request.method}` },
        })
    }
  }

  function respond(chainId: number, request: RpcCall) {
    try {
      return { jsonrpc: "2.0", id: request.id ?? 1, result: handle(chainId, request) }
    } catch (error) {
      const rpcError = (error as { rpcError?: { code: number; message: string } }).rpcError
      return {
        jsonrpc: "2.0",
        id: request.id ?? 1,
        error: rpcError ?? { code: -32000, message: String(error) },
      }
    }
  }

  return mock
}

/** Decodes an ERC-20 `transfer(to, amount)` broadcast, for the calldata assertions. */
export function decodeErc20Transfer(sent: SentTransaction) {
  const decoded = decodeFunctionData({ abi: ERC20_ABI, data: sent.data as Hex })
  if (decoded.functionName !== "transfer")
    throw new Error(`not a transfer: ${decoded.functionName}`)
  const [to, amount] = decoded.args as [string, bigint]
  return { to, amount }
}

/** Decodes an ERC-20 `approve(spender, amount)` broadcast. */
export function decodeErc20Approve(sent: SentTransaction) {
  const decoded = decodeFunctionData({ abi: ERC20_ABI, data: sent.data as Hex })
  if (decoded.functionName !== "approve") throw new Error(`not an approve: ${decoded.functionName}`)
  const [spender, amount] = decoded.args as [string, bigint]
  return { spender, amount }
}
