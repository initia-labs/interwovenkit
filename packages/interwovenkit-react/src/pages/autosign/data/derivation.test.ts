import type { Hex } from "viem"
import { describe, expect, it } from "vitest"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"

const VALID_SIGNATURE: Hex =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

const ANOTHER_SIGNATURE: Hex =
  "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543211b"

describe("getAutoSignMessage", () => {
  it("includes origin and signing purpose", () => {
    const origin = "https://app.initia.xyz"
    const message = getAutoSignMessage(origin)

    expect(message).toContain(origin)
    expect(message).toContain("Enable Auto-Sign")
    expect(message).toContain("InterwovenKit")
  })

  it("changes when origin changes", () => {
    const first = getAutoSignMessage("https://app1.initia.xyz")
    const second = getAutoSignMessage("https://app2.initia.xyz")

    expect(first).not.toBe(second)
  })
})

describe("deriveWalletFromSignature", () => {
  it("derives deterministically for the same signature", async () => {
    const first = await deriveWalletFromSignature(VALID_SIGNATURE, "init")
    const second = await deriveWalletFromSignature(VALID_SIGNATURE, "init")

    expect(first.address).toBe(second.address)
    expect(first.privateKey).toEqual(second.privateKey)
    expect(first.publicKey).toEqual(second.publicKey)
  })

  it("derives different wallets for different signatures", async () => {
    const first = await deriveWalletFromSignature(VALID_SIGNATURE, "init")
    const second = await deriveWalletFromSignature(ANOTHER_SIGNATURE, "init")

    expect(first.address).not.toBe(second.address)
    expect(first.privateKey).not.toEqual(second.privateKey)
    expect(first.publicKey).not.toEqual(second.publicKey)
  })

  it("ignores the v byte when deriving wallet entropy", async () => {
    const sigV27: Hex =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b"
    const sigV28: Hex =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1c"

    const first = await deriveWalletFromSignature(sigV27, "init")
    const second = await deriveWalletFromSignature(sigV28, "init")

    expect(first.address).toBe(second.address)
    expect(first.privateKey).toEqual(second.privateKey)
    expect(first.publicKey).toEqual(second.publicKey)
  })

  it("supports bech32 prefixes while keeping key material stable", async () => {
    const initWallet = await deriveWalletFromSignature(VALID_SIGNATURE, "init")
    const cosmosWallet = await deriveWalletFromSignature(VALID_SIGNATURE, "cosmos")

    expect(initWallet.address.startsWith("init1")).toBe(true)
    expect(cosmosWallet.address.startsWith("cosmos1")).toBe(true)
    expect(initWallet.address).not.toBe(cosmosWallet.address)
    expect(initWallet.privateKey).toEqual(cosmosWallet.privateKey)
    expect(initWallet.publicKey).toEqual(cosmosWallet.publicKey)
  })

  it("rejects signatures with an invalid byte length", async () => {
    await expect(deriveWalletFromSignature("0x1234" as Hex, "init")).rejects.toThrow(
      "Invalid signature length",
    )
  })

  it("rejects non-hex signatures", async () => {
    await expect(deriveWalletFromSignature("0xnothex" as Hex, "init")).rejects.toThrow("Invalid")
  })
})

describe("getDerivedWalletKey", () => {
  it("scopes cache key by user and prefix", () => {
    expect(getDerivedWalletKey("init1user", "init")).toBe("init1user:init")
    expect(getDerivedWalletKey("init1user", "cosmos")).toBe("init1user:cosmos")
    expect(getDerivedWalletKey("init1other", "init")).toBe("init1other:init")
  })
})
