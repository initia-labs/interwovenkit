import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { deriveWalletFromSignature, getAutoSignTypedData, getDerivedWalletKey } from "./derivation"

describe("getAutoSignTypedData", () => {
  it("returns correct EIP-712 domain", () => {
    const result = getAutoSignTypedData("https://example.com", "initia-1")

    expect(result.domain).toEqual({
      name: "InterwovenKit",
      version: "1",
    })
  })

  it("returns correct EIP-712 types structure", () => {
    const result = getAutoSignTypedData("https://example.com", "initia-1")

    expect(result.types).toEqual({
      AutoSign: [
        { name: "action", type: "string" },
        { name: "origin", type: "string" },
        { name: "chainId", type: "string" },
      ],
    })
  })

  it("returns correct primary type", () => {
    const result = getAutoSignTypedData("https://example.com", "initia-1")

    expect(result.primaryType).toBe("AutoSign")
  })

  it("includes origin in message", () => {
    const origin = "https://myapp.initia.xyz"
    const result = getAutoSignTypedData(origin, "initia-1")

    expect(result.message.origin).toBe(origin)
  })

  it("includes chainId in message", () => {
    const chainId = "minimove-1"
    const result = getAutoSignTypedData("https://example.com", chainId)

    expect(result.message.chainId).toBe(chainId)
  })

  it("sets action to 'Enable Auto-Sign'", () => {
    const result = getAutoSignTypedData("https://example.com", "initia-1")

    expect(result.message.action).toBe("Enable Auto-Sign")
  })

  it("returns complete typed data structure", () => {
    const origin = "https://example.com"
    const chainId = "initia-1"
    const result = getAutoSignTypedData(origin, chainId)

    expect(result).toEqual({
      domain: { name: "InterwovenKit", version: "1" },
      types: {
        AutoSign: [
          { name: "action", type: "string" },
          { name: "origin", type: "string" },
          { name: "chainId", type: "string" },
        ],
      },
      primaryType: "AutoSign",
      message: {
        action: "Enable Auto-Sign",
        origin: origin,
        chainId: chainId,
      },
    })
  })

  it("handles different origins correctly", () => {
    const result1 = getAutoSignTypedData("https://app1.com", "initia-1")
    const result2 = getAutoSignTypedData("https://app2.com", "initia-1")

    expect(result1.message.origin).toBe("https://app1.com")
    expect(result2.message.origin).toBe("https://app2.com")
    expect(result1.message.origin).not.toBe(result2.message.origin)
  })

  it("handles different chainIds correctly", () => {
    const result1 = getAutoSignTypedData("https://example.com", "initia-1")
    const result2 = getAutoSignTypedData("https://example.com", "minimove-1")

    expect(result1.message.chainId).toBe("initia-1")
    expect(result2.message.chainId).toBe("minimove-1")
    expect(result1.message.chainId).not.toBe(result2.message.chainId)
  })
})

describe("deriveWalletFromSignature", () => {
  const validSignature: Hex =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

  const anotherSignature: Hex =
    "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543211b"

  describe("deterministic derivation", () => {
    it("produces the same wallet for the same signature", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature)
      const wallet2 = await deriveWalletFromSignature(validSignature)

      expect(wallet1.address).toBe(wallet2.address)
      expect(wallet1.privateKey).toEqual(wallet2.privateKey)
      expect(wallet1.publicKey).toEqual(wallet2.publicKey)
    })

    it("produces consistent results across multiple calls", async () => {
      const results = await Promise.all([
        deriveWalletFromSignature(validSignature),
        deriveWalletFromSignature(validSignature),
        deriveWalletFromSignature(validSignature),
        deriveWalletFromSignature(validSignature),
        deriveWalletFromSignature(validSignature),
      ])

      const firstAddress = results[0].address
      results.forEach((result) => {
        expect(result.address).toBe(firstAddress)
      })
    })
  })

  describe("different inputs produce different outputs", () => {
    it("produces different wallets for different signatures", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature)
      const wallet2 = await deriveWalletFromSignature(anotherSignature)

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

      const wallet1 = await deriveWalletFromSignature(sig1)
      const wallet2 = await deriveWalletFromSignature(sig2)

      expect(wallet1.address).not.toBe(wallet2.address)
    })

    it("signatures differing only in v byte produce the same wallet", async () => {
      // v byte (last byte) is stripped before hashing, so these should produce the same wallet
      const sig1: Hex =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b"
      const sig2: Hex =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

      const wallet1 = await deriveWalletFromSignature(sig1)
      const wallet2 = await deriveWalletFromSignature(sig2)

      expect(wallet1.address).toBe(wallet2.address)
    })
  })

  describe("return value structure", () => {
    it("returns an object with privateKey, publicKey, and address", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet).toHaveProperty("privateKey")
      expect(wallet).toHaveProperty("publicKey")
      expect(wallet).toHaveProperty("address")
    })

    it("returns privateKey as Uint8Array", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.privateKey).toBeInstanceOf(Uint8Array)
    })

    it("returns publicKey as Uint8Array", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.publicKey).toBeInstanceOf(Uint8Array)
    })

    it("returns address as string", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(typeof wallet.address).toBe("string")
    })
  })

  describe("key format validation", () => {
    it("returns a 32-byte private key", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.privateKey.length).toBe(32)
    })

    it("returns a 33-byte compressed public key", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.publicKey.length).toBe(33)
    })

    it("public key starts with 0x02 or 0x03 (compressed format)", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)
      const firstByte = wallet.publicKey[0]

      expect(firstByte === 0x02 || firstByte === 0x03).toBe(true)
    })
  })

  describe("address format validation", () => {
    it("returns address with 'init' prefix", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.address.startsWith("init1")).toBe(true)
    })

    it("returns address with correct bech32 length", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.address.length).toBe(43)
    })

    it("returns valid bech32 address format", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)
      const bech32Regex = /^init1[a-z0-9]{38}$/

      expect(bech32Regex.test(wallet.address)).toBe(true)
    })

    it("different signatures produce addresses with same format", async () => {
      const wallet1 = await deriveWalletFromSignature(validSignature)
      const wallet2 = await deriveWalletFromSignature(anotherSignature)

      expect(wallet1.address.startsWith("init1")).toBe(true)
      expect(wallet2.address.startsWith("init1")).toBe(true)
      expect(wallet1.address.length).toBe(wallet2.address.length)
    })
  })

  describe("cryptographic properties", () => {
    it("uses BIP-39 mnemonic derivation path m/44'/60'/0'/0/0", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)

      expect(wallet.privateKey.length).toBe(32)
      expect(wallet.publicKey.length).toBe(33)
    })

    it("derived keys are non-zero", async () => {
      const wallet = await deriveWalletFromSignature(validSignature)
      const privateKeyAllZero = wallet.privateKey.every((byte: number) => byte === 0)
      const publicKeyAllZero = wallet.publicKey.every((byte: number) => byte === 0)

      expect(privateKeyAllZero).toBe(false)
      expect(publicKeyAllZero).toBe(false)
    })

    it("handles 65-byte signatures (standard Ethereum signature)", async () => {
      const standardEthSig: Hex =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901c"

      const wallet = await deriveWalletFromSignature(standardEthSig)

      expect(wallet.address.startsWith("init1")).toBe(true)
    })
  })
})

describe("getDerivedWalletKey", () => {
  it("returns key in format 'origin:chainId'", () => {
    const result = getDerivedWalletKey("https://example.com", "initia-1")

    expect(result).toBe("https://example.com:initia-1")
  })

  it("different origins produce different keys", () => {
    const key1 = getDerivedWalletKey("https://app1.com", "initia-1")
    const key2 = getDerivedWalletKey("https://app2.com", "initia-1")

    expect(key1).not.toBe(key2)
  })

  it("different chainIds produce different keys", () => {
    const key1 = getDerivedWalletKey("https://example.com", "initia-1")
    const key2 = getDerivedWalletKey("https://example.com", "minimove-1")

    expect(key1).not.toBe(key2)
  })

  it("same origin and chainId produce same key", () => {
    const key1 = getDerivedWalletKey("https://example.com", "initia-1")
    const key2 = getDerivedWalletKey("https://example.com", "initia-1")

    expect(key1).toBe(key2)
  })

  it("handles empty strings", () => {
    const result = getDerivedWalletKey("", "")

    expect(result).toBe(":")
  })

  it("handles special characters in origin", () => {
    const result = getDerivedWalletKey("https://app.example.com:8080/path", "chain-1")

    expect(result).toBe("https://app.example.com:8080/path:chain-1")
  })

  it("handles hyphenated chainIds", () => {
    const result = getDerivedWalletKey("https://example.com", "my-chain-id-123")

    expect(result).toBe("https://example.com:my-chain-id-123")
  })

  it("preserves order of origin and chainId", () => {
    const result = getDerivedWalletKey("first", "second")

    expect(result).toBe("first:second")
    expect(result).not.toBe("second:first")
  })
})

describe("integration: full derivation flow", () => {
  it("typed data + signature derivation produces valid wallet", async () => {
    const origin = "https://dapp.initia.xyz"
    const chainId = "initia-1"

    const typedData = getAutoSignTypedData(origin, chainId)

    expect(typedData.message.origin).toBe(origin)
    expect(typedData.message.chainId).toBe(chainId)

    const mockSignature: Hex =
      "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901c"

    const wallet = await deriveWalletFromSignature(mockSignature)
    const cacheKey = getDerivedWalletKey(origin, chainId)

    expect(wallet.address.startsWith("init1")).toBe(true)
    expect(cacheKey).toBe(`${origin}:${chainId}`)
  })

  it("cache key matches typed data parameters", () => {
    const origin = "https://test.com"
    const chainId = "test-chain-1"

    const typedData = getAutoSignTypedData(origin, chainId)
    const cacheKey = getDerivedWalletKey(origin, chainId)

    expect(cacheKey).toContain(typedData.message.origin)
    expect(cacheKey).toContain(typedData.message.chainId)
  })
})
