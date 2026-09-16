import type { JsonRpcProvider } from "ethers"
import { getAddress, Signature, TransactionResponse } from "ethers"
import type { RouterChainJson } from "@/pages/bridge/data/chains"
import {
  createPinnedProvider,
  encodeErc20Approve,
  encodeErc20Transfer,
  PinnedRpcUnavailableError,
  readAllowance,
  readBlockNumber,
  readSourceBalances,
  watchSourceTransaction,
} from "./evmRpc"

// The Router chain type is a runtime enum in @skip-go/client; casting the literal keeps the whole client out of a unit test.
const chainType = (value: string) => value as RouterChainJson["chain_type"]

const SENDER = "0x4e3d1f2a6b5c8d9e0f1a2b3c4d5e6f7a8b9c0d1e"
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

describe("createPinnedProvider", () => {
  it("pins the provider to the chain id from the registry entry", () => {
    const provider = createPinnedProvider({
      chain_id: "8453",
      rpc: "https://base.example/rpc",
      chain_type: chainType("evm"),
    })
    expect(provider._network.chainId).toBe(8453n)
    provider.destroy()
  })

  it("refuses a chain with no RPC endpoint", () => {
    expect(() =>
      createPinnedProvider({ chain_id: "8453", rpc: "", chain_type: chainType("evm") }),
    ).toThrow(PinnedRpcUnavailableError)
  })

  it("refuses a non-EVM chain", () => {
    expect(() =>
      createPinnedProvider({
        chain_id: "interwoven-1",
        rpc: "https://rpc",
        chain_type: chainType("cosmos"),
      }),
    ).toThrow(PinnedRpcUnavailableError)
  })

  it("refuses a chain id that is not an EVM chain id", () => {
    expect(() =>
      createPinnedProvider({
        chain_id: "interwoven-1",
        rpc: "https://rpc",
        chain_type: chainType("evm"),
      }),
    ).toThrow(PinnedRpcUnavailableError)
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

describe("readAllowance", () => {
  it("returns the allowance as a base-unit decimal string", async () => {
    const { provider } = createFakeProvider({ call: () => UINT_7 })
    await expect(
      readAllowance(provider, { owner: SENDER, token: TOKEN, spender: BRIDGE }),
    ).resolves.toBe("7")
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

describe("readBlockNumber", () => {
  it("reads the pinned head block", async () => {
    const { provider } = createFakeProvider({ blockNumber: 100 })
    await expect(readBlockNumber(provider)).resolves.toBe(100)
  })
})

describe("watchSourceTransaction", () => {
  it("reports a confirmed receipt", async () => {
    const { provider } = createFakeProvider({
      receipts: { [HASH]: { status: 1, blockNumber: 105, hash: HASH } },
    })
    await expect(watchSourceTransaction(provider, PARAMS)).resolves.toEqual({
      status: "confirmed",
      hash: HASH,
      blockNumber: 105,
    })
  })

  it("reports a reverted receipt", async () => {
    const { provider } = createFakeProvider({
      receipts: { [HASH]: { status: 0, blockNumber: 105, hash: HASH } },
    })
    await expect(watchSourceTransaction(provider, PARAMS)).resolves.toEqual({
      status: "reverted",
      hash: HASH,
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
      originalHash: HASH,
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
      originalHash: HASH,
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
      originalHash: HASH,
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
      hash: HASH,
      blockNumber: 105,
    })
  })
})
