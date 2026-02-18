import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { Wallet } from "ethers"
import { describe, expect, it } from "vitest"
import {
  cacheRecoveredPublicKeyFromMessageSignature,
  getPublicKeyStorageKey,
  readPublicKeyFromStorage,
  recoverCompressedPublicKeyFromMessageSignature,
  writePublicKeyToStorage,
} from "./publicKey"

describe("public key storage", () => {
  const address = "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgkcpfs"

  const createStorage = () => {
    const data = new Map<string, string>()

    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    }
  }

  it("uses the expected localStorage key format", () => {
    expect(getPublicKeyStorageKey(address)).toBe(`interwovenkit:public-key:${address}`)
  })

  it("writes and reads compressed public keys", () => {
    const storage = createStorage()
    const publicKey = new Uint8Array([1, 2, 3, 4])

    writePublicKeyToStorage(storage, address, publicKey)

    expect(readPublicKeyFromStorage(storage, address)).toEqual(publicKey)
  })

  it("returns null when stored key is invalid hex", () => {
    const storage = createStorage()
    storage.setItem(getPublicKeyStorageKey(address), "not-a-hex")

    expect(readPublicKeyFromStorage(storage, address)).toBeNull()
  })
})

describe("recoverCompressedPublicKeyFromMessageSignature", () => {
  const privateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  const message = "Enable Auto-Sign for InterwovenKit"

  it("recovers the compressed public key from an EIP-191 signature", async () => {
    const wallet = new Wallet(privateKey)
    const signature = await wallet.signMessage(message)
    const recoveredPublicKey = recoverCompressedPublicKeyFromMessageSignature(message, signature)

    const uncompressedPublicKey = wallet.signingKey.publicKey
    const expectedPublicKey = Secp256k1.compressPubkey(
      fromHex(uncompressedPublicKey.replace("0x", "")),
    )

    expect(toHex(recoveredPublicKey)).toBe(toHex(expectedPublicKey))
  })

  it("caches recovered public key in storage", async () => {
    const wallet = new Wallet(privateKey)
    const signature = await wallet.signMessage(message)
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    }

    const cached = cacheRecoveredPublicKeyFromMessageSignature({
      address: "init1cached",
      message,
      signature,
      storage,
    })

    expect(cached).toBe(true)
    expect(readPublicKeyFromStorage(storage, "init1cached")).toEqual(
      recoverCompressedPublicKeyFromMessageSignature(message, signature),
    )
  })

  it("returns false and does not throw for invalid signatures", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    }

    const cached = cacheRecoveredPublicKeyFromMessageSignature({
      address: "init1cached",
      message,
      signature: "0x1234",
      storage,
    })

    expect(cached).toBe(false)
    expect(readPublicKeyFromStorage(storage, "init1cached")).toBeNull()
  })
})
