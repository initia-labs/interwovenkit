import { makeSignDoc } from "@cosmjs/amino"
import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocalStorageKey } from "./constants"
import {
  OfflineSigner,
  resolveSignerAccountSequence,
  selectPrefetchedAccountSequence,
} from "./signer"

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
    clear: () => entries.clear(),
  }
}

describe("OfflineSigner", () => {
  const address = "init1signer"

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("signs with a single wallet request and caches the public key from the signature", async () => {
    const wallet = ethers.Wallet.createRandom()
    const signMessage = vi.fn((message: string) => wallet.signMessage(message))
    const signer = new OfflineSigner(address, signMessage, "https://rest.example")
    const signDoc = makeSignDoc([], { amount: [], gas: "200000" }, "chain-1", "", 1, 0)

    const { signature, signed } = await signer.signAmino(address, signDoc)

    const expectedPublicKey = Secp256k1.compressPubkey(
      fromHex(wallet.signingKey.publicKey.slice(2)),
    )
    expect(signed).toBe(signDoc)
    expect(signature.pub_key).toEqual({
      type: "initia/PubKeyEthSecp256k1",
      value: Buffer.from(expectedPublicKey).toString("base64"),
    })
    expect(fromBase64(signature.signature)).toHaveLength(64)
    expect(signMessage).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(`${LocalStorageKey.PUBLIC_KEY}:${address}`)).toBe(
      toHex(expectedPublicKey),
    )

    // A later account lookup reuses the cached key instead of asking the wallet again.
    const [account] = await signer.getAccounts()
    expect(account.pubkey).toEqual(expectedPublicKey)
    expect(signMessage).toHaveBeenCalledTimes(1)
  })

  it("rejects signing for a different address", async () => {
    const signer = new OfflineSigner(address, vi.fn(), "https://rest.example")
    const signDoc = makeSignDoc([], { amount: [], gas: "200000" }, "chain-1", "", 1, 0)

    await expect(signer.signAmino("init1other", signDoc)).rejects.toThrow(
      "Signer address does not match the provided address",
    )
  })
})

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

describe("selectPrefetchedAccountSequence", () => {
  it("drops the retained sequence after a failed refetch until a retry succeeds", () => {
    const initial = { data: { accountNumber: 1, sequence: 7 }, isError: false }
    expect(selectPrefetchedAccountSequence(initial)).toEqual({ accountNumber: 1, sequence: 7 })

    // TanStack Query keeps the previous data when a refetch fails
    const failedRefetch = { data: { accountNumber: 1, sequence: 7 }, isError: true }
    expect(selectPrefetchedAccountSequence(failedRefetch)).toBeUndefined()

    const retried = { data: { accountNumber: 1, sequence: 8 }, isError: false }
    expect(selectPrefetchedAccountSequence(retried)).toEqual({ accountNumber: 1, sequence: 8 })
  })

  it("returns undefined before the first lookup completes", () => {
    expect(selectPrefetchedAccountSequence({ data: undefined, isError: false })).toBeUndefined()
  })
})
