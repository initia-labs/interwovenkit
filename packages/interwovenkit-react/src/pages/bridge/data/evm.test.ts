import { ethers } from "ethers"
import { createErc20ApproveTx, sendUncheckedEvmTransaction } from "./evm"

describe("createErc20ApproveTx", () => {
  it("encodes ERC-20 approve calldata", () => {
    const tx = createErc20ApproveTx({
      tokenContract: "0x0000000000000000000000000000000000000001",
      spender: "0x0000000000000000000000000000000000000002",
      amount: "123",
    })

    expect(tx.to).toBe("0x0000000000000000000000000000000000000001")

    const parsed = new ethers.Interface([
      "function approve(address spender, uint256 amount) external returns (bool)",
    ]).parseTransaction({ data: tx.data as string })

    expect(parsed?.name).toBe("approve")
    expect(parsed?.args[0]).toBe("0x0000000000000000000000000000000000000002")
    expect(parsed?.args[1]).toBe(123n)
  })
})

describe("sendUncheckedEvmTransaction", () => {
  it("falls back to waiting by hash with a confirmation timeout", async () => {
    const receipt = { status: 1 }
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockResolvedValue(null),
      waitForTransaction: vi.fn().mockResolvedValue(receipt),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith(tx)
    expect(provider.getBlockNumber).toHaveBeenCalledTimes(1)
    expect(provider.getTransaction).toHaveBeenCalledWith("0xabc")
    await expect(result.wait).resolves.toBe(receipt)
    expect(provider.waitForTransaction).toHaveBeenCalledWith("0xabc", 1, 30000)
    expect(result.txHash).toBe("0xabc")
  })

  it("falls back to waiting by hash when getTransaction rejects", async () => {
    const receipt = { status: 1 }
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockRejectedValue(new Error("invalid value for value.nonce")),
      waitForTransaction: vi.fn().mockResolvedValue(receipt),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith(tx)
    expect(provider.getTransaction).toHaveBeenCalledWith("0xabc")
    await expect(result.wait).resolves.toBe(receipt)
    expect(provider.waitForTransaction).toHaveBeenCalledWith("0xabc", 1, 30000)
    expect(result.txHash).toBe("0xabc")
  })

  it("rethrows unrelated getTransaction errors", async () => {
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockRejectedValue(new Error("rpc unavailable")),
      waitForTransaction: vi.fn(),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    await expect(result.wait).rejects.toThrow("rpc unavailable")
    expect(provider.waitForTransaction).not.toHaveBeenCalled()
  })

  it("uses a replaceable transaction wait when the transaction response is available", async () => {
    const receipt = { status: 1 }
    const wait = vi.fn().mockResolvedValue(receipt)
    const replaceableTransaction = vi.fn().mockReturnValue({ wait })
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockResolvedValue({ replaceableTransaction }),
      waitForTransaction: vi.fn(),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    await expect(result.wait).resolves.toBe(receipt)
    expect(replaceableTransaction).toHaveBeenCalledWith(123)
    expect(wait).toHaveBeenCalledWith(1, 30000)
    expect(provider.waitForTransaction).not.toHaveBeenCalled()
  })

  it("throws CALL_EXCEPTION when transaction reverts", async () => {
    const receipt = { status: 0 }
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockResolvedValue(null),
      waitForTransaction: vi.fn().mockResolvedValue(receipt),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    expect(result.txHash).toBe("0xabc")
    await expect(result.wait).rejects.toMatchObject({
      message: "transaction execution reverted",
      code: "CALL_EXCEPTION",
      receipt,
    })
  })

  it("throws a timeout error when confirmation does not arrive in time", async () => {
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(123),
      getTransaction: vi.fn().mockResolvedValue(null),
      waitForTransaction: vi.fn().mockResolvedValue(null),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    await expect(result.wait).rejects.toMatchObject({
      message: "Transaction confirmation timed out",
      code: "TIMEOUT",
      transactionHash: "0xabc",
    })
  })
})
