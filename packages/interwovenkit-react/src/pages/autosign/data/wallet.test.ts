import type { StdSignDoc } from "@cosmjs/amino"
import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, fromHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { describe, expect, it } from "vitest"
import type { DerivedWallet } from "./store"
import { DerivedWalletSigner } from "./wallet"

async function createTestWallet(): Promise<DerivedWallet> {
  const privateKey = fromHex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
  const keypair = await Secp256k1.makeKeypair(privateKey)
  const publicKey = Secp256k1.compressPubkey(keypair.pubkey)

  return {
    privateKey,
    publicKey,
    address: "init1testaddress12345678901234567890",
  }
}

function createTestSignDoc(): StdSignDoc {
  return {
    chain_id: "initia-1",
    account_number: "123",
    sequence: "0",
    fee: {
      amount: [{ denom: "uinit", amount: "1000" }],
      gas: "200000",
    },
    msgs: [
      {
        type: "cosmos-sdk/MsgSend",
        value: {
          from_address: "init1sender",
          to_address: "init1receiver",
          amount: [{ denom: "uinit", amount: "1000000" }],
        },
      },
    ],
    memo: "",
  }
}

describe("DerivedWalletSigner", () => {
  describe("getAccounts", () => {
    it("returns array with single account", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)

      const accounts = await signer.getAccounts()

      expect(accounts).toHaveLength(1)
    })

    it("returns account with correct address", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)

      const accounts = await signer.getAccounts()

      expect(accounts[0].address).toBe(wallet.address)
    })

    it("returns account with ethsecp256k1 algo", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)

      const accounts = await signer.getAccounts()

      expect(accounts[0].algo).toBe("ethsecp256k1")
    })

    it("returns account with correct public key", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)

      const accounts = await signer.getAccounts()

      expect(accounts[0].pubkey).toEqual(wallet.publicKey)
    })

    it("returns readonly array", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)

      const accounts = await signer.getAccounts()

      expect(Object.isFrozen(accounts)).toBe(false)
      expect(Array.isArray(accounts)).toBe(true)
    })
  })

  describe("signAmino", () => {
    it("throws when signer address does not match wallet address", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      await expect(signer.signAmino("init1wrongaddress", signDoc)).rejects.toThrow(
        "Signer address does not match the derived wallet address",
      )
    })

    it("returns signed document unchanged", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(result.signed).toEqual(signDoc)
    })

    it("returns signature with pub_key", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(result.signature.pub_key).toBeDefined()
      expect(result.signature.pub_key.type).toBe("initia/PubKeyEthSecp256k1")
    })

    it("returns signature as base64 string", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(typeof result.signature.signature).toBe("string")
      expect(() => fromBase64(result.signature.signature)).not.toThrow()
    })

    it("produces 64-byte signature", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)
      const signatureBytes = fromBase64(result.signature.signature)

      expect(signatureBytes.length).toBe(64)
    })

    it("produces deterministic signature for same input", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result1 = await signer.signAmino(wallet.address, signDoc)
      const result2 = await signer.signAmino(wallet.address, signDoc)

      expect(result1.signature.signature).toBe(result2.signature.signature)
    })

    it("produces different signature for different sign docs", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc1 = createTestSignDoc()
      const signDoc2 = { ...createTestSignDoc(), memo: "different memo" }

      const result1 = await signer.signAmino(wallet.address, signDoc1)
      const result2 = await signer.signAmino(wallet.address, signDoc2)

      expect(result1.signature.signature).not.toBe(result2.signature.signature)
    })

    it("produces verifiable signature", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      const { escapeCharacters, sortedJsonStringify } = await import("@cosmjs/amino/build/signdoc")
      const signDocJSON = escapeCharacters(sortedJsonStringify(signDoc))
      const messageHash = ethers.hashMessage(signDocJSON)
      const messageHashBytes = fromHex(messageHash.replace("0x", ""))

      const signatureBytes = fromBase64(result.signature.signature)
      const signature = await Secp256k1.createSignature(messageHashBytes, wallet.privateKey)
      const expectedSignatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)])

      expect(signatureBytes).toEqual(expectedSignatureBytes)
    })
  })
})
