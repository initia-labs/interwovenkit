import { prepareWalletRequest, sendPreparedWalletRequest } from "./depositWalletRequest"

const sender = "0x1111111111111111111111111111111111111111"
const to = "0x2222222222222222222222222222222222222222"

describe("depositWalletRequest", () => {
  it("fully prepares a request before the click sends it", async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return [sender]
        if (method === "eth_chainId") return 42161
        if (method === "eth_estimateGas") return "0x5208"
        return "0xhash"
      }),
    }
    const prepared = await prepareWalletRequest({
      provider,
      sender,
      chainId: "42161",
      to,
      data: "0x1234",
      value: "16",
    })
    expect(prepared).toEqual({
      status: "ready",
      provider,
      transaction: {
        chainId: "0xa4b1",
        from: sender,
        to,
        data: "0x1234",
        value: "0x10",
        gas: "0x5208",
      },
    })
    if (prepared.status !== "ready") throw new Error("Expected a prepared request")
    const promise = sendPreparedWalletRequest(prepared)
    expect(provider.request).toHaveBeenLastCalledWith({
      method: "eth_sendTransaction",
      params: [prepared.transaction],
    })
    await expect(promise).resolves.toBe("0xhash")
  })

  it("stops at a wrong chain before estimating gas", async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === "eth_accounts" ? [sender] : "0x1",
      ),
    }
    await expect(
      prepareWalletRequest({ provider, sender, chainId: "42161", to, data: "0x", value: "0" }),
    ).resolves.toEqual({ status: "wrong_chain", provider })
    expect(provider.request).toHaveBeenCalledTimes(2)
  })

  it("uses a supplied gas limit without estimating it", async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === "eth_accounts" ? [sender] : "0xa4b1",
      ),
    }
    await expect(
      prepareWalletRequest({
        provider,
        sender,
        chainId: "42161",
        to,
        data: "0x1234",
        value: "0",
        gasLimit: "350000",
      }),
    ).resolves.toMatchObject({ status: "ready", transaction: { gas: "0x55730" } })
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_estimateGas" }),
    )
  })

  it("turns a synchronous send throw into a rejected promise", async () => {
    const error = new Error("popup blocked")
    const request = {
      status: "ready" as const,
      provider: {
        request: vi.fn(() => {
          throw error
        }),
      },
      transaction: { chainId: "0xa4b1", from: sender, to, data: "0x", value: "0x0" },
    }
    await expect(sendPreparedWalletRequest(request)).rejects.toBe(error)
  })
})
