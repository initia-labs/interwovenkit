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
  it("returns the tx hash and waits for confirmation by hash", async () => {
    const receipt = { status: 1 }
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
      waitForTransaction: vi.fn().mockResolvedValue(receipt),
    }
    const tx = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }

    const result = await sendUncheckedEvmTransaction(signer as never, provider as never, tx)

    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith(tx)
    expect(provider.waitForTransaction).toHaveBeenCalledWith("0xabc")
    await expect(result.wait).resolves.toBe(receipt)
    expect(result.txHash).toBe("0xabc")
  })

  it("throws CALL_EXCEPTION when transaction reverts", async () => {
    const receipt = { status: 0 }
    const signer = {
      sendUncheckedTransaction: vi.fn().mockResolvedValue("0xabc"),
    }
    const provider = {
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
})
