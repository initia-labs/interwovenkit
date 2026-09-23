import type { JsonRpcProvider } from "ethers"
import { getAddress, Interface, Signature, TransactionResponse } from "ethers"
import {
  encodeErc20Approve,
  encodeErc20Transfer,
  getPinnedProvider,
  readErc20Uint,
  readSourceBalances,
  waitForApproval,
  watchSourceTransaction,
} from "./evmRpc"
import { SENDER } from "./testing"

const BRIDGE = "0x2222222222222222222222222222222222222222"
const OTHER = "0x3333333333333333333333333333333333333333"
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
const HASH = `0x${"11".repeat(32)}`
const REPLACEMENT_HASH = `0x${"22".repeat(32)}`

const ERC20_READS = new Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
])

type EthCall = (tx: { to?: string; data?: string }) => string

/** Answers only the expected read on TOKEN; anything else looks like an empty contract. */
function answerTokenRead(fragment: "balanceOf" | "allowance", args: string[], value: bigint) {
  const expected = ERC20_READS.encodeFunctionData(fragment, args)
  return ({ to, data }: { to?: string; data?: string }) =>
    to === TOKEN && data === expected ? ERC20_READS.encodeFunctionResult(fragment, [value]) : "0x"
}

interface ReplacementFields {
  to: string
  data: string
  value: bigint
  chainId?: bigint
}

interface FakeProviderOptions {
  receipt?: { status: number }
  /** Mined in block 100 at the watched nonce. */
  replacement?: ReplacementFields
  rpcError?: Error
  balance?: bigint
  call?: EthCall
}

function createFakeProvider(options: FakeProviderOptions = {}): JsonRpcProvider {
  const { receipt, replacement, rpcError } = options
  const provider = {
    getTransaction: async () => null,
    getTransactionReceipt: async (hash: string) => {
      if (rpcError) throw rpcError
      if (hash === HASH && receipt) return { ...receipt, blockNumber: 100, hash }
      if (hash === REPLACEMENT_HASH && replacement) return { status: 1, blockNumber: 100, hash }
      return null
    },
    getBlockNumber: async () => 105,
    getTransactionCount: async () => (replacement ? 8 : 0),
    getBlock: async (blockNumber: number) =>
      replacement && blockNumber === 100 ? createBlock(buildReplacement(replacement)) : null,
    getBalance: async () => options.balance ?? 0n,
    call: async (tx: { to?: string; data?: string }) => options.call?.(tx) ?? "0x",
    on: () => provider,
    once: () => provider,
    off: () => provider,
  }
  return provider as unknown as JsonRpcProvider
}

function buildReplacement({ to, data, value, chainId = 8453n }: ReplacementFields) {
  return new TransactionResponse(
    {
      blockNumber: 100,
      blockHash: null,
      hash: REPLACEMENT_HASH,
      index: 0,
      type: 2,
      to: getAddress(to),
      from: getAddress(SENDER),
      nonce: 7,
      gasLimit: 21000n,
      gasPrice: 1n,
      maxPriorityFeePerGas: null,
      maxFeePerGas: null,
      maxFeePerBlobGas: null,
      data,
      value,
      chainId,
      signature: Signature.from(),
      accessList: null,
      blobVersionedHashes: null,
      authorizationList: null,
    },
    null as unknown as JsonRpcProvider,
  )
}

/** The three members ethers' replacement scan touches on a prefetched block. */
function createBlock(replacement: TransactionResponse) {
  return {
    length: 1,
    [Symbol.iterator]: function* () {
      yield replacement.hash
    },
    getTransaction: async () => replacement,
  }
}

const PARAMS = {
  hash: HASH,
  from: SENDER,
  nonce: 7,
  to: BRIDGE,
  data: "0xdeadbeef",
  value: "0",
  chainId: "8453",
  startBlock: 100,
  timeoutMs: 1000,
}

describe("getPinnedProvider", () => {
  it("reuses one provider per chain: ethers keeps a polling loop on each", () => {
    expect(getPinnedProvider("42161")).toBe(getPinnedProvider("42161"))
    expect(getPinnedProvider("42161")).not.toBe(getPinnedProvider("1"))
  })

  it("refuses a chain the Deposit API does not source from", () => {
    expect(() => getPinnedProvider("10")).toThrow(/has no pinned RPC/)
    expect(() => getPinnedProvider("")).toThrow(/has no pinned RPC/)
  })
})

describe("readSourceBalances", () => {
  it("reads the owner's token balance from the token contract and the native balance", async () => {
    const provider = createFakeProvider({
      call: answerTokenRead("balanceOf", [SENDER], 4_200_000n),
      balance: 12345n,
    })
    await expect(readSourceBalances(provider, { owner: SENDER, token: TOKEN })).resolves.toEqual({
      token: "4200000",
      native: "12345",
    })
  })

  it("throws rather than reading an empty response as a zero balance", async () => {
    await expect(
      readSourceBalances(createFakeProvider(), { owner: SENDER, token: TOKEN }),
    ).rejects.toThrow(/returned no data/)
  })
})

describe("readErc20Uint", () => {
  it("reads the owner's allowance for the spender", async () => {
    const provider = createFakeProvider({
      call: answerTokenRead("allowance", [SENDER, BRIDGE], 7n),
    })
    await expect(readErc20Uint(provider, TOKEN, "allowance", [SENDER, BRIDGE])).resolves.toBe("7")
  })
})

describe("ERC-20 calldata", () => {
  const wrongChecksum = "0x9f1B4b1F2C3d4E5f60718293A4B5c6D7E8F90123"

  it.each([
    ["transfer", encodeErc20Transfer, "0xa9059cbb"],
    ["approve", encodeErc20Approve, "0x095ea7b3"],
  ])("%s accepts a mixed-case address with a wrong EIP-55 checksum", (_, encode, selector) => {
    const data = encode(wrongChecksum, "1")
    expect(data).toBe(encode(wrongChecksum.toLowerCase(), "1"))
    expect(data.slice(0, 10)).toBe(selector)
  })
})

describe("waitForApproval", () => {
  const withReceipt = (receipt: { status: number } | null) =>
    ({ waitForTransaction: async () => receipt }) as unknown as JsonRpcProvider

  it("resolves only on a successful receipt", async () => {
    await expect(waitForApproval(withReceipt({ status: 1 }), HASH, 10)).resolves.toBeUndefined()
  })

  it("throws on a reverted or missing receipt so the footer shows it", async () => {
    await expect(waitForApproval(withReceipt({ status: 0 }), HASH, 10)).rejects.toThrow()
    await expect(waitForApproval(withReceipt(null), HASH, 10)).rejects.toThrow()
  })
})

describe("watchSourceTransaction", () => {
  it.each([
    ["confirmed", 100, 1],
    ["reverted", 100, 0],
    ["confirmed", -1, 1],
    ["reverted", -1, 0],
  ])("reports a %s receipt (start block %s)", async (status, startBlock, receiptStatus) => {
    const provider = createFakeProvider({ receipt: { status: receiptStatus } })
    await expect(watchSourceTransaction(provider, { ...PARAMS, startBlock })).resolves.toEqual({
      status,
    })
  })

  it("stays pending when the watch window elapses", async () => {
    await expect(
      watchSourceTransaction(createFakeProvider(), { ...PARAMS, timeoutMs: 20 }),
    ).resolves.toEqual({ status: "pending" })
  })

  it.each([
    ["no start block", { startBlock: -1 }],
    ["no nonce from the wallet", { nonce: Number.NaN }],
  ])("stays pending with %s instead of assuming cancellation", async (_, missing) => {
    const provider = createFakeProvider({
      replacement: { to: SENDER, data: "0x", value: 0n },
    })
    await expect(watchSourceTransaction(provider, { ...PARAMS, ...missing })).resolves.toEqual({
      status: "pending",
    })
  })

  it.each([
    ["an identical payload", { to: BRIDGE, data: "0xdeadbeef", value: 0n }, "repriced"],
    ["a payload differing only in case", { to: BRIDGE, data: "0xDEADBEEF", value: 0n }, "repriced"],
    ["a self-send of nothing", { to: SENDER, data: "0x", value: 0n }, "cancelled"],
    ["a different payload", { to: OTHER, data: "0xfeedface", value: 0n }, "replaced"],
    [
      "the same payload with a different value",
      { to: BRIDGE, data: "0xdeadbeef", value: 1n },
      "replaced",
    ],
    [
      "the same payload on another chain",
      { to: BRIDGE, data: "0xdeadbeef", value: 0n, chainId: 1n },
      "replaced",
    ],
  ])("classifies a replacement with %s", async (_, replacement, reason) => {
    const provider = createFakeProvider({ replacement })
    await expect(watchSourceTransaction(provider, PARAMS)).resolves.toEqual({
      status: "replaced",
      hash: REPLACEMENT_HASH,
      reason,
    })
  })

  it("reports the error's hash when ethers omits the replacement", async () => {
    const rpcError = Object.assign(new Error("transaction was replaced"), {
      code: "TRANSACTION_REPLACED",
      hash: REPLACEMENT_HASH,
    })
    await expect(watchSourceTransaction(createFakeProvider({ rpcError }), PARAMS)).resolves.toEqual(
      { status: "replaced", hash: REPLACEMENT_HASH, reason: "replaced" },
    )
  })

  it("rethrows an unrelated RPC error", async () => {
    const rpcError = new Error("rate limited")
    await expect(watchSourceTransaction(createFakeProvider({ rpcError }), PARAMS)).rejects.toBe(
      rpcError,
    )
  })
})
