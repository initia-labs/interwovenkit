import type { JsonRpcProvider } from "ethers"
import { getAddress, Signature, TransactionResponse } from "ethers"
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

const UINT_4200000 = "0x0000000000000000000000000000000000000000000000000000000000401640"
const UINT_7 = "0x0000000000000000000000000000000000000000000000000000000000000007"

interface FakeProviderOptions {
  transaction?: TransactionResponse | null
  receipts?: Record<string, unknown>
  blockNumber?: number
  transactionCount?: number
  blocks?: Record<number, unknown>
  balance?: bigint
  call?: (tx: { to?: string; data?: string }) => string
}

function createFakeProvider(options: FakeProviderOptions = {}) {
  const calls = { getTransaction: 0, getTransactionReceipt: 0 }
  const provider = {
    getTransaction: async () => {
      calls.getTransaction += 1
      return options.transaction ?? null
    },
    getTransactionReceipt: async (hash: string) => {
      calls.getTransactionReceipt += 1
      return options.receipts?.[hash] ?? null
    },
    getBlockNumber: async () => options.blockNumber ?? 0,
    getTransactionCount: async () => options.transactionCount ?? 0,
    getBlock: async (blockNumber: number) => options.blocks?.[blockNumber] ?? null,
    getBalance: async () => options.balance ?? 0n,
    call: async (tx: { to?: string; data?: string }) => options.call?.(tx) ?? "0x",
    on: () => provider,
    once: () => provider,
    off: () => provider,
  }
  return { provider: provider as unknown as JsonRpcProvider, calls }
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

function buildResponse(
  provider: JsonRpcProvider,
  overrides: { hash: string; to: string; data: string; value: bigint; chainId?: bigint },
) {
  return new TransactionResponse(
    {
      blockNumber: 100,
      blockHash: null,
      hash: overrides.hash,
      index: 0,
      type: 2,
      to: getAddress(overrides.to),
      from: getAddress(SENDER),
      nonce: 7,
      gasLimit: 21000n,
      gasPrice: 1n,
      maxPriorityFeePerGas: null,
      maxFeePerGas: null,
      maxFeePerBlobGas: null,
      data: overrides.data,
      value: overrides.value,
      chainId: overrides.chainId ?? 8453n,
      signature: Signature.from(),
      accessList: null,
      blobVersionedHashes: null,
      authorizationList: null,
    },
    provider,
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

describe("getPinnedProvider", () => {
  it("pins the provider to the source chain's own endpoint and chain id", () => {
    const provider = getPinnedProvider("8453")
    expect(provider._network.chainId).toBe(8453n)
  })

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
  it("returns token and native balances as base-unit decimal strings", async () => {
    const { provider } = createFakeProvider({ call: () => UINT_4200000, balance: 12345n })
    await expect(readSourceBalances(provider, { owner: SENDER, token: TOKEN })).resolves.toEqual({
      token: "4200000",
      native: "12345",
    })
  })

  it("throws rather than reading an empty response as a zero balance", async () => {
    const { provider } = createFakeProvider({ call: () => "0x" })
    await expect(readSourceBalances(provider, { owner: SENDER, token: TOKEN })).rejects.toThrow(
      /returned no data/,
    )
  })
})

describe("readErc20Uint", () => {
  it("returns the allowance as a base-unit decimal string", async () => {
    const { provider } = createFakeProvider({ call: () => UINT_7 })
    await expect(readErc20Uint(provider, TOKEN, "allowance", [SENDER, BRIDGE])).resolves.toBe("7")
  })
})

describe("encodeErc20Transfer", () => {
  it("accepts a mixed-case address with a wrong EIP-55 checksum (bytes are identical)", () => {
    const wrongChecksum = "0x9f1B4b1F2C3d4E5f60718293A4B5c6D7E8F90123"
    expect(encodeErc20Transfer(wrongChecksum, "1")).toBe(
      encodeErc20Transfer(wrongChecksum.toLowerCase(), "1"),
    )
  })

  it("encodes transfer calldata", () => {
    expect(encodeErc20Transfer(SENDER, "1500000")).toBe(
      "0xa9059cbb0000000000000000000000004e3d1f2a6b5c8d9e0f1a2b3c4d5e6f7a8b9c0d1e000000000000000000000000000000000000000000000000000000000016e360",
    )
  })

  it("throws on an amount that is not base units", () => {
    expect(() => encodeErc20Transfer(SENDER, "1.5")).toThrow()
  })
})

describe("encodeErc20Approve", () => {
  it("encodes approve calldata", () => {
    expect(encodeErc20Approve("0x1111111111111111111111111111111111111111", "2500000")).toBe(
      "0x095ea7b3000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000002625a0",
    )
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
  it("reports a confirmed receipt", async () => {
    const { provider } = createFakeProvider({
      receipts: { [HASH]: { status: 1, blockNumber: 105, hash: HASH } },
    })
    await expect(watchSourceTransaction(provider, PARAMS)).resolves.toEqual({
      status: "confirmed",
    })
  })

  it("reports a reverted receipt", async () => {
    const { provider } = createFakeProvider({
      receipts: { [HASH]: { status: 0, blockNumber: 105, hash: HASH } },
    })
    await expect(watchSourceTransaction(provider, PARAMS)).resolves.toEqual({
      status: "reverted",
    })
  })

  it("stays pending when the watch window elapses", async () => {
    const { provider } = createFakeProvider({ blockNumber: 100, transactionCount: 7 })
    await expect(watchSourceTransaction(provider, { ...PARAMS, timeoutMs: 20 })).resolves.toEqual({
      status: "pending",
    })
  })

  it("adopts a replacement with an identical payload as repriced", async () => {
    const { provider } = createFakeProvider({
      blockNumber: 105,
      transactionCount: 8,
      receipts: { [REPLACEMENT_HASH]: { status: 1, blockNumber: 100, hash: REPLACEMENT_HASH } },
    })
    const replacement = buildResponse(provider, {
      hash: REPLACEMENT_HASH,
      to: BRIDGE,
      data: "0xdeadbeef",
      value: 0n,
    })
    const { provider: pinned } = createFakeProvider({
      blockNumber: 105,
      transactionCount: 8,
      blocks: { 100: createBlock(replacement) },
      receipts: { [REPLACEMENT_HASH]: { status: 1, blockNumber: 100, hash: REPLACEMENT_HASH } },
    })
    await expect(watchSourceTransaction(pinned, PARAMS)).resolves.toEqual({
      status: "replaced",
      hash: REPLACEMENT_HASH,
      reason: "repriced",
    })
  })

  it("calls a mined self-send at the same nonce a cancellation", async () => {
    const { provider } = createFakeProvider()
    const replacement = buildResponse(provider, {
      hash: REPLACEMENT_HASH,
      to: SENDER,
      data: "0x",
      value: 0n,
    })
    const { provider: pinned } = createFakeProvider({
      blockNumber: 105,
      transactionCount: 8,
      blocks: { 100: createBlock(replacement) },
      receipts: { [REPLACEMENT_HASH]: { status: 1, blockNumber: 100, hash: REPLACEMENT_HASH } },
    })
    await expect(watchSourceTransaction(pinned, PARAMS)).resolves.toEqual({
      status: "replaced",
      hash: REPLACEMENT_HASH,
      reason: "cancelled",
    })
  })

  it("does not call a different payload a cancellation", async () => {
    const { provider } = createFakeProvider()
    const replacement = buildResponse(provider, {
      hash: REPLACEMENT_HASH,
      to: OTHER,
      data: "0xfeedface",
      value: 0n,
    })
    const { provider: pinned } = createFakeProvider({
      blockNumber: 105,
      transactionCount: 8,
      blocks: { 100: createBlock(replacement) },
      receipts: { [REPLACEMENT_HASH]: { status: 1, blockNumber: 100, hash: REPLACEMENT_HASH } },
    })
    await expect(watchSourceTransaction(pinned, PARAMS)).resolves.toEqual({
      status: "replaced",
      hash: REPLACEMENT_HASH,
      reason: "replaced",
    })
  })

  // ethers' own `reason` never checks the chain, so trusting it would read a payload-identical replacement from another chain as "repriced".
  it("does not adopt a payload-identical replacement from another chain", async () => {
    const { provider } = createFakeProvider()
    const replacement = buildResponse(provider, {
      hash: REPLACEMENT_HASH,
      to: BRIDGE,
      data: "0xdeadbeef",
      value: 0n,
      chainId: 1n,
    })
    const { provider: pinned } = createFakeProvider({
      blockNumber: 105,
      transactionCount: 8,
      blocks: { 100: createBlock(replacement) },
      receipts: { [REPLACEMENT_HASH]: { status: 1, blockNumber: 100, hash: REPLACEMENT_HASH } },
    })
    await expect(watchSourceTransaction(pinned, PARAMS)).resolves.toMatchObject({
      status: "replaced",
      reason: "replaced",
    })
  })

  it("stays pending without a start block instead of assuming cancellation", async () => {
    const { provider, calls } = createFakeProvider()
    await expect(watchSourceTransaction(provider, { ...PARAMS, startBlock: -1 })).resolves.toEqual({
      status: "pending",
    })
    expect(calls.getTransaction).toBe(0)
  })

  it("stays pending when the wallet never reported a nonce", async () => {
    const { provider } = createFakeProvider()
    await expect(
      watchSourceTransaction(provider, { ...PARAMS, nonce: Number.NaN }),
    ).resolves.toEqual({ status: "pending" })
  })

  it("still reports a receipt found without a start block", async () => {
    const { provider } = createFakeProvider({
      receipts: { [HASH]: { status: 1, blockNumber: 105, hash: HASH } },
    })
    await expect(watchSourceTransaction(provider, { ...PARAMS, startBlock: -1 })).resolves.toEqual({
      status: "confirmed",
    })
  })
})
