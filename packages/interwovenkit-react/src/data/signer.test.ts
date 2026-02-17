import { describe, expect, it, vi } from "vitest"
import { resolveSignerAccountSequence } from "./signer"

describe("resolveSignerAccountSequence", () => {
  it("returns fetched account number and sequence with increment", async () => {
    const getSequence = vi.fn().mockResolvedValue({ accountNumber: 7, sequence: 3 })

    const result = await resolveSignerAccountSequence({
      getSequence,
      signerAddress: "init1signer",
      incrementSequence: 2,
      allowMissingAccount: false,
    })

    expect(result).toEqual({ accountNumber: 7, sequence: 5 })
    expect(getSequence).toHaveBeenCalledWith("init1signer")
  })

  it("uses zero defaults when derived signer account does not exist", async () => {
    const signerAddress = "init1derived"
    const getSequence = vi
      .fn()
      .mockRejectedValue(
        new Error(`Account '${signerAddress}' does not exist on chain. Send some tokens there.`),
      )

    const result = await resolveSignerAccountSequence({
      getSequence,
      signerAddress,
      incrementSequence: 0,
      allowMissingAccount: true,
    })

    expect(result).toEqual({ accountNumber: 0, sequence: 0 })
  })

  it("applies increment when account is missing and fallback is enabled", async () => {
    const signerAddress = "init1derived"
    const getSequence = vi
      .fn()
      .mockRejectedValue(
        new Error(`Account '${signerAddress}' does not exist on chain. Send some tokens there.`),
      )

    const result = await resolveSignerAccountSequence({
      getSequence,
      signerAddress,
      incrementSequence: 3,
      allowMissingAccount: true,
    })

    expect(result).toEqual({ accountNumber: 0, sequence: 3 })
  })

  it("rethrows missing-account error when fallback is disabled", async () => {
    const signerAddress = "init1derived"
    const error = new Error(`Account '${signerAddress}' does not exist on chain.`)
    const getSequence = vi.fn().mockRejectedValue(error)

    await expect(
      resolveSignerAccountSequence({
        getSequence,
        signerAddress,
        incrementSequence: 0,
        allowMissingAccount: false,
      }),
    ).rejects.toThrow(error)
  })

  it("rethrows non-matching errors even when fallback is enabled", async () => {
    const signerAddress = "init1derived"
    const error = new Error("rpc timeout")
    const getSequence = vi.fn().mockRejectedValue(error)

    await expect(
      resolveSignerAccountSequence({
        getSequence,
        signerAddress,
        incrementSequence: 0,
        allowMissingAccount: true,
      }),
    ).rejects.toThrow(error)
  })
})
