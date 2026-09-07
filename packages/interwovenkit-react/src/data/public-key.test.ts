import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { LocalStorageKey } from "./constants"
import { loadPublicKey, recoverPublicKey, storePublicKey } from "./public-key"

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

describe("recoverPublicKey", () => {
  it("recovers the compressed public key from an EIP-191 signature", async () => {
    const wallet = ethers.Wallet.createRandom()
    const message = "Sign this message to identify your Initia account."
    const signature = await wallet.signMessage(message)

    const expected = Secp256k1.compressPubkey(fromHex(wallet.signingKey.publicKey.slice(2)))
    expect(recoverPublicKey(message, signature)).toEqual(expected)
  })
})

describe("public key storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns null when nothing is stored for the address", () => {
    expect(loadPublicKey("init1signer")).toBeNull()
  })

  it("round-trips the key per address", () => {
    const publicKey = new Uint8Array([2, ...Array.from({ length: 32 }, (_, i) => i)])
    storePublicKey("init1signer", publicKey)

    expect(loadPublicKey("init1signer")).toEqual(publicKey)
    expect(loadPublicKey("init1other")).toBeNull()
    expect(localStorage.getItem(`${LocalStorageKey.PUBLIC_KEY}:init1signer`)).toBe(toHex(publicKey))
  })
})
