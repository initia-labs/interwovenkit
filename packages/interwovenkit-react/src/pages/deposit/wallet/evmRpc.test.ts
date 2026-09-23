import type { JsonRpcProvider } from "ethers"
import { Interface } from "ethers"
import {
  checkSourceTransaction,
  encodeErc20Approve,
  encodeErc20Transfer,
  getPinnedProvider,
  readErc20Uint,
  readSourceBalances,
  waitForApproval,
} from "./evmRpc"
import { buildDepositSession, SENDER } from "./testing"

const BRIDGE = "0x2222222222222222222222222222222222222222"
const OTHER = "0x3333333333333333333333333333333333333333"
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
const HASH = `0x${"ab".repeat(32)}`
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

interface MinedFields {
  hash?: string
  from?: string
  to: string
  data: string
  value: bigint
  chainId?: bigint
}

interface FakeProviderOptions {
  receipt?: { status: number }
  /** Mined at the watched nonce (block 100 unless `minedBlock`), which moves the sender's nonce past it. */
  mined?: MinedFields
  minedBlock?: number
  /** The mined transaction's own receipt block; `null` for a receipt the node doesn't have yet. */
  minedReceiptBlock?: number | null
  head?: number
  rpcError?: Error
  balance?: bigint
  call?: EthCall
}

const checksummed = (hex: string) => `0x${hex.slice(2).toUpperCase()}`

const blockReads: number[] = []

function createFakeProvider(options: FakeProviderOptions = {}): JsonRpcProvider {
  const { receipt, mined, rpcError, minedBlock = 100, head = 105 } = options
  const minedReceiptBlock =
    options.minedReceiptBlock === undefined ? minedBlock : options.minedReceiptBlock
  blockReads.length = 0
  const minedTx = mined && {
    hash: REPLACEMENT_HASH,
    from: checksummed(SENDER),
    nonce: 7,
    chainId: 8453n,
    ...mined,
  }
  return {
    getTransactionReceipt: async (hash: string) => {
      if (rpcError) throw rpcError
      if (hash === HASH) return receipt ?? null
      return minedTx && hash === minedTx.hash && minedReceiptBlock !== null
        ? { status: 1, blockNumber: minedReceiptBlock }
        : null
    },
    getBlockNumber: async () => head,
    getTransactionCount: async () => (mined ? 8 : 7),
    getBlock: async (blockNumber: number) => {
      blockReads.push(blockNumber)
      return { prefetchedTransactions: blockNumber === minedBlock && minedTx ? [minedTx] : [] }
    },
    getBalance: async () => options.balance ?? 0n,
    call: async (tx: { to?: string; data?: string }) => options.call?.(tx) ?? "0x",
  } as unknown as JsonRpcProvider
}

const SEND = buildDepositSession({
  transaction: { chainId: "8453", to: BRIDGE, data: "0xdeadbeef", value: "0" },
  preSubmitBlock: 100,
  sourceNonce: 7,
})

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

describe("checkSourceTransaction", () => {
  const check = (provider: JsonRpcProvider, send = SEND) =>
    checkSourceTransaction(provider, HASH, send)
  const withoutScan = { ...SEND, preSubmitBlock: undefined, sourceNonce: undefined }

  it.each([
    ["confirmed", SEND, 1],
    ["reverted", SEND, 0],
    ["confirmed", withoutScan, 1],
    ["reverted", withoutScan, 0],
  ])("reports a %s receipt", async (status, send, receiptStatus) => {
    const provider = createFakeProvider({ receipt: { status: receiptStatus } })
    await expect(check(provider, send)).resolves.toEqual({ status })
  })

  it("stays pending without reading a block while nothing has taken the nonce", async () => {
    await expect(check(createFakeProvider())).resolves.toEqual({ status: "pending" })
    expect(blockReads).toEqual([])
  })

  it("scans from the pre-send block once another transaction has taken the nonce", async () => {
    const provider = createFakeProvider({
      mined: { from: OTHER, to: SENDER, data: "0x", value: 0n },
    })
    await expect(check(provider)).resolves.toEqual({ status: "pending", nextBlock: 106 })
    expect(blockReads).toEqual([100, 101, 102, 103, 104, 105])
  })

  it("scans a bounded range per check and resumes where the last one stopped", async () => {
    const options = {
      mined: { to: SENDER, data: "0x", value: 0n },
      minedBlock: 130,
      head: 400,
    }
    await expect(check(createFakeProvider(options))).resolves.toEqual({
      status: "pending",
      nextBlock: 125,
    })
    expect(blockReads).toEqual(Array.from({ length: 25 }, (_, index) => 100 + index))
    await expect(
      checkSourceTransaction(createFakeProvider(options), HASH, SEND, 125),
    ).resolves.toMatchObject({ status: "replaced", reason: "cancelled" })
    expect(blockReads[0]).toBe(125)
  })

  it.each([
    ["the node has no receipt for it yet", null],
    ["its receipt is from another block after a reorg", 101],
  ])("stays pending on a replacement when %s", async (_, minedReceiptBlock) => {
    const provider = createFakeProvider({
      mined: { to: SENDER, data: "0x", value: 0n },
      minedReceiptBlock,
    })
    await expect(check(provider)).resolves.toEqual({ status: "pending", nextBlock: 100 })
  })

  it.each([
    ["no start block", { preSubmitBlock: undefined }],
    ["no nonce from the wallet", { sourceNonce: undefined }],
  ])("stays pending with %s instead of assuming cancellation", async (_, missing) => {
    const provider = createFakeProvider({ mined: { to: SENDER, data: "0x", value: 0n } })
    await expect(check(provider, { ...SEND, ...missing })).resolves.toEqual({ status: "pending" })
  })

  it("stays pending when our own transaction took the nonce ahead of its receipt", async () => {
    const provider = createFakeProvider({
      mined: { hash: checksummed(HASH), to: SENDER, data: "0x", value: 0n },
    })
    await expect(check(provider)).resolves.toEqual({ status: "pending", nextBlock: 100 })
  })

  it("stays pending when the transaction at the nonce is outside the scanned blocks", async () => {
    const provider = createFakeProvider({ mined: { to: SENDER, data: "0x", value: 0n } })
    await expect(check(provider, { ...SEND, preSubmitBlock: 101 })).resolves.toEqual({
      status: "pending",
      nextBlock: 106,
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
  ])("classifies a replacement with %s", async (_, mined, reason) => {
    await expect(check(createFakeProvider({ mined }))).resolves.toEqual({
      status: "replaced",
      hash: REPLACEMENT_HASH,
      reason,
    })
  })

  it("rethrows an RPC error", async () => {
    const rpcError = new Error("rate limited")
    await expect(check(createFakeProvider({ rpcError }))).rejects.toBe(rpcError)
  })
})
