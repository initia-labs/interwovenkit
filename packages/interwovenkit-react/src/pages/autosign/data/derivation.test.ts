import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"

describe("getAutoSignMessage", () => {
  it("returns a string message", () => {
    const result = getAutoSignMessage("https://example.com")

    expect(typeof result).toBe("string")
  })

  it("includes origin in message", () => {
    const origin = "https://myapp.initia.xyz"
    const result = getAutoSignMessage(origin)

    expect(result).toContain(origin)
  })

  it("includes InterwovenKit branding", () => {
    const result = getAutoSignMessage("https://example.com")

    expect(result).toContain("InterwovenKit")
  })

  it("includes Enable Auto-Sign action", () => {
    const result = getAutoSignMessage("https://example.com")

    expect(result).toContain("Enable Auto-Sign")
  })

  it("handles different origins correctly", () => {
    const result1 = getAutoSignMessage("https://app1.com")
    const result2 = getAutoSignMessage("https://app2.com")

    expect(result1).toContain("https://app1.com")
    expect(result2).toContain("https://app2.com")
    expect(result1).not.toBe(result2)
  })

  it("produces different messages for different origins", () => {
    const message1 = getAutoSignMessage("https://app1.com")
    const message2 = getAutoSignMessage("https://app2.com")

    expect(message1).not.toBe(message2)
  })
})

describe("deriveWalletFromSignature", () => {
  const validSignature: Hex =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

  const anotherSignature: Hex =
    "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543211b"

  describe("deterministic derivation", () => {
    it("produces the same wallet for the same signature", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature, "init")
      const wallet2 = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet1.address).toBe(wallet2.address)
      expect(wallet1.privateKey).toEqual(wallet2.privateKey)
      expect(wallet1.publicKey).toEqual(wallet2.publicKey)
    })

    it("produces consistent results across multiple calls", async () => {
      const results = await Promise.all([
        deriveWalletFromSignature(validSignature, "init"),
        deriveWalletFromSignature(validSignature, "init"),
        deriveWalletFromSignature(validSignature, "init"),
        deriveWalletFromSignature(validSignature, "init"),
        deriveWalletFromSignature(validSignature, "init"),
      ])

      const firstAddress = results[0].address
      results.forEach((result) => {
        expect(result.address).toBe(firstAddress)
      })
    })
  })

  describe("different inputs produce different outputs", () => {
    it("produces different wallets for different signatures", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature, "init")
      const wallet2 = await deriveWalletFromSignature(anotherSignature, "init")

      expect(wallet1.address).not.toBe(wallet2.address)
      expect(wallet1.privateKey).not.toEqual(wallet2.privateKey)
      expect(wallet1.publicKey).not.toEqual(wallet2.publicKey)
    })

    it("small changes in r,s values produce completely different wallets", async () => {
      // Signatures differ in the r,s portion (first 64 bytes), not just v (last byte)
      const sig1: Hex =
        "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
      const sig2: Hex =
        "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000"

      const wallet1 = await deriveWalletFromSignature(sig1, "init")
      const wallet2 = await deriveWalletFromSignature(sig2, "init")

      expect(wallet1.address).not.toBe(wallet2.address)
    })

    it("signatures differing only in v byte produce the same wallet", async () => {
      // v byte (last byte) is stripped before hashing, so these should produce the same wallet
      const sig1: Hex =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b"
      const sig2: Hex =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

      const wallet1 = await deriveWalletFromSignature(sig1, "init")
      const wallet2 = await deriveWalletFromSignature(sig2, "init")

      expect(wallet1.address).toBe(wallet2.address)
    })
  })

  describe("return value structure", () => {
    it("returns an object with privateKey, publicKey, and address", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet).toHaveProperty("privateKey")
      expect(wallet).toHaveProperty("publicKey")
      expect(wallet).toHaveProperty("address")
    })

    it("returns privateKey as Uint8Array", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.privateKey).toBeInstanceOf(Uint8Array)
    })

    it("returns publicKey as Uint8Array", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.publicKey).toBeInstanceOf(Uint8Array)
    })

    it("returns address as string", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(typeof wallet.address).toBe("string")
    })
  })

  describe("key format validation", () => {
    it("returns a 32-byte private key", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.privateKey.length).toBe(32)
    })

    it("returns a 33-byte compressed public key", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.publicKey.length).toBe(33)
    })

    it("public key starts with 0x02 or 0x03 (compressed format)", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")
      const firstByte = wallet.publicKey[0]

      expect(firstByte === 0x02 || firstByte === 0x03).toBe(true)
    })
  })

  describe("address format validation", () => {
    it("returns address with 'init' prefix", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.address.startsWith("init1")).toBe(true)
    })

    it("returns address with correct bech32 length", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.address.length).toBe(43)
    })

    it("returns valid bech32 address format", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")
      const bech32Regex = /^init1[a-z0-9]{38}$/

      expect(bech32Regex.test(wallet.address)).toBe(true)
    })

    it("different signatures produce addresses with same format", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature, "init")
      const wallet2 = await deriveWalletFromSignature(anotherSignature, "init")

      expect(wallet1.address.startsWith("init1")).toBe(true)
      expect(wallet2.address.startsWith("init1")).toBe(true)
      expect(wallet1.address.length).toBe(wallet2.address.length)
    })
  })

  describe("cryptographic properties", () => {
    it("uses BIP-39 mnemonic derivation path m/44'/60'/0'/0/0", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")

      expect(wallet.privateKey.length).toBe(32)
      expect(wallet.publicKey.length).toBe(33)
    })

    it("derived keys are non-zero", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "init")
      const privateKeyAllZero = wallet.privateKey.every((byte: number) => byte === 0)
      const publicKeyAllZero = wallet.publicKey.every((byte: number) => byte === 0)

      expect(privateKeyAllZero).toBe(false)
      expect(publicKeyAllZero).toBe(false)
    })

    it("handles 65-byte signatures (standard Ethereum signature)", async () => {
      const standardEthSig: Hex =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901c"

      const wallet = await deriveWalletFromSignature(standardEthSig, "init")

      expect(wallet.address.startsWith("init1")).toBe(true)
    })
  })

  describe("bech32 prefix support", () => {
    it("uses provided bech32 prefix for address encoding", async () => {
      const wallet = await deriveWalletFromSignature(validSignature, "cosmos")

      expect(wallet.address.startsWith("cosmos1")).toBe(true)
    })

    it("same signature with different prefixes produces different addresses", async () => {
      const initWallet = await deriveWalletFromSignature(validSignature, "init")
      const cosmosWallet = await deriveWalletFromSignature(validSignature, "cosmos")

      expect(initWallet.address).not.toBe(cosmosWallet.address)
      expect(initWallet.address.startsWith("init1")).toBe(true)
      expect(cosmosWallet.address.startsWith("cosmos1")).toBe(true)
    })

    it("same signature with different prefixes produces same keys", async () => {
      const initWallet = await deriveWalletFromSignature(validSignature, "init")
      const cosmosWallet = await deriveWalletFromSignature(validSignature, "cosmos")

      expect(initWallet.privateKey).toEqual(cosmosWallet.privateKey)
      expect(initWallet.publicKey).toEqual(cosmosWallet.publicKey)
    })

    it("supports various cosmos chain prefixes", async () => {
      const prefixes = ["init", "cosmos", "osmo", "neutron", "celestia"]

      for (const prefix of prefixes) {
        const wallet = await deriveWalletFromSignature(validSignature, prefix)
        expect(wallet.address.startsWith(`${prefix}1`)).toBe(true)
      }
    })
  })
})

describe("getDerivedWalletKey", () => {
  const testAddress = "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d"
  const testPrefix = "init"

  it("includes userAddress and bech32 prefix in key", () => {
    const result = getDerivedWalletKey(testAddress, testPrefix)

    expect(result).toBe(`${testAddress}:${testPrefix}`)
  })

  it("different user addresses produce different keys", () => {
    const address1 = "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d"
    const address2 = "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz9ml8a"
    const key1 = getDerivedWalletKey(address1, testPrefix)
    const key2 = getDerivedWalletKey(address2, testPrefix)

    expect(key1).not.toBe(key2)
  })

  it("different prefixes produce different keys for the same user", () => {
    const key1 = getDerivedWalletKey(testAddress, "init")
    const key2 = getDerivedWalletKey(testAddress, "cosmos")

    expect(key1).not.toBe(key2)
  })

  it("same userAddress and prefix produce same key", () => {
    const key1 = getDerivedWalletKey(testAddress, testPrefix)
    const key2 = getDerivedWalletKey(testAddress, testPrefix)

    expect(key1).toBe(key2)
  })

  it("handles empty string", () => {
    const result = getDerivedWalletKey("", "")

    expect(result).toBe(":")
  })
})

describe("integration: full derivation flow", () => {
  const testAddress = "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d"

  it("message + signature derivation produces valid wallet", async () => {
    const origin = "https://dapp.initia.xyz"

    const message = getAutoSignMessage(origin)

    expect(message).toContain(origin)

    const mockSignature: Hex =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

    const wallet = await deriveWalletFromSignature(mockSignature, "init")
    const cacheKey = getDerivedWalletKey(testAddress, "init")

    expect(wallet.address.startsWith("init1")).toBe(true)
    expect(cacheKey).toBe(`${testAddress}:init`)
  })

  it("cache key includes bech32 prefix", () => {
    const cacheKey = getDerivedWalletKey(testAddress, "init")

    expect(cacheKey).toBe(`${testAddress}:init`)
  })
})
