import type { StdSignDoc } from "@cosmjs/amino"
import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, fromHex } from "@cosmjs/encoding"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { ethers } from "ethers"
import { describe, expect, it } from "vitest"
import { createStore } from "jotai/vanilla"
import { isExactAutoSignPublicIdentity, mergeAutoSignObservation } from "./storage"
import {
  derivationSequenceAtom,
  type DerivedWallet,
  derivedWalletPrivateKeysAtom,
  derivedWalletsAtom,
  pendingDerivationsAtom,
} from "./store"
import {
  awaitWalletRestore,
  clearAllWalletState,
  clearExpectedAddressFromStorage,
  DerivedWalletSigner,
  getExpectedAddressKey,
  getMatchingActiveAutoSignIdentity,
  readExpectedAddressFromStorage,
  shouldBroadcastStorageMode,
  shouldClearWalletsOnAddressChange,
  signWithDerivedWalletWithPrivateKey,
  writeExpectedAddressToStorage,
} from "./wallet"

async function createTestWallet(): Promise<DerivedWallet> {
  const privateKey = fromHex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
  const keypair = await Secp256k1.makeKeypair(privateKey)
  const publicKey = Secp256k1.compressPubkey(keypair.pubkey)

  return {
    privateKey,
    publicKey,
    address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d",
  }
}

describe("awaitWalletRestore", () => {
  it("zeroizes a restored key that arrives after the timeout", async () => {
    let resolveRestore!: (wallet: DerivedWallet) => void
    const restore = new Promise<DerivedWallet>((resolve) => {
      resolveRestore = resolve
    })
    const lateWallet = await createTestWallet()

    await expect(
      awaitWalletRestore(restore, 0, (wallet) => wallet.privateKey.fill(0)),
    ).rejects.toThrow("Autosign browser storage timed out")
    resolveRestore(lateWallet)
    await restore
    await Promise.resolve()

    expect(Array.from(lateWallet.privateKey)).toEqual(new Array(32).fill(0))
  })
})

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
          from_address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgkcpfs",
          to_address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5ld4x7",
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
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)

      const accounts = await signer.getAccounts()

      expect(accounts).toHaveLength(1)
    })

    it("returns account with correct address", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)

      const accounts = await signer.getAccounts()

      expect(accounts[0].address).toBe(wallet.address)
    })

    it("returns account with ethsecp256k1 algo", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)

      const accounts = await signer.getAccounts()

      expect(accounts[0].algo).toBe("ethsecp256k1")
    })

    it("returns account with correct public key", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)

      const accounts = await signer.getAccounts()

      expect(accounts[0].pubkey).toEqual(wallet.publicKey)
    })

    it("returns array (not frozen at runtime)", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)

      const accounts = await signer.getAccounts()

      expect(Object.isFrozen(accounts)).toBe(false)
      expect(Array.isArray(accounts)).toBe(true)
    })
  })

  describe("signAmino", () => {
    it("throws when signer address does not match wallet address", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      await expect(
        signer.signAmino("init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz9ml8a", signDoc),
      ).rejects.toThrow("Signer address does not match the derived wallet address")
    })

    it("returns signed document unchanged", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(result.signed).toEqual(signDoc)
    })

    it("returns signature with pub_key", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(result.signature.pub_key).toBeDefined()
      expect(result.signature.pub_key.type).toBe("initia/PubKeyEthSecp256k1")
    })

    it("returns signature as base64 string", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)

      expect(typeof result.signature.signature).toBe("string")
      expect(() => fromBase64(result.signature.signature)).not.toThrow()
    })

    it("produces 64-byte signature", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      const result = await signer.signAmino(wallet.address, signDoc)
      const signatureBytes = fromBase64(result.signature.signature)

      expect(signatureBytes.length).toBe(64)
    })

    it("produces deterministic signature for same input", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc = createTestSignDoc()

      const result1 = await signer.signAmino(wallet.address, signDoc)
      const result2 = await signer.signAmino(wallet.address, signDoc)

      expect(result1.signature.signature).toBe(result2.signature.signature)
    })

    it("produces different signature for different sign docs", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
      const signDoc1 = createTestSignDoc()
      const signDoc2 = { ...createTestSignDoc(), memo: "different memo" }

      const result1 = await signer.signAmino(wallet.address, signDoc1)
      const result2 = await signer.signAmino(wallet.address, signDoc2)

      expect(result1.signature.signature).not.toBe(result2.signature.signature)
    })

    it("produces verifiable signature", async () => {
      const wallet = await createTestWallet()
      const signer = new DerivedWalletSigner(wallet, wallet.privateKey)
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

describe("signWithDerivedWalletWithPrivateKey", () => {
  it("uses a private key snapshot during signing to avoid concurrent zeroization races", async () => {
    const wallet = await createTestWallet()
    const originalPrivateKey = new Uint8Array(wallet.privateKey)
    const signDoc = createTestSignDoc()
    const messages: EncodeObject[] = [
      { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: "a", toAddress: "b" } },
    ]
    let signedResponse:
      | {
          signature: { signature: string }
        }
      | undefined

    await signWithDerivedWalletWithPrivateKey({
      chainId: "initia-1",
      granterAddress: "init1granter",
      messages,
      fee: signDoc.fee,
      memo: signDoc.memo,
      derivedWallet: {
        address: wallet.address,
        publicKey: wallet.publicKey,
      },
      privateKey: wallet.privateKey,
      encoder: {
        encode: () => new Uint8Array([1, 2, 3]),
      },
      signWithEthSecp256k1: async (
        _chainId,
        _signerAddress,
        _messages,
        _fee,
        _memo,
        options,
      ): Promise<TxRaw> => {
        const customSigner = options?.customSigner
        if (!customSigner) {
          throw new Error("Custom signer was not provided")
        }

        // Simulate concurrent clearWallet() zeroizing the original in-memory key.
        wallet.privateKey.fill(0)
        signedResponse = await customSigner.signAmino(wallet.address, signDoc)

        return { signatures: [new Uint8Array([7])] } as unknown as TxRaw
      },
    })

    const { escapeCharacters, sortedJsonStringify } = await import("@cosmjs/amino/build/signdoc")
    const signDocJSON = escapeCharacters(sortedJsonStringify(signDoc))
    const messageHash = ethers.hashMessage(signDocJSON)
    const messageHashBytes = fromHex(messageHash.replace("0x", ""))
    const expectedSignature = await Secp256k1.createSignature(messageHashBytes, originalPrivateKey)
    const expectedSignatureBytes = new Uint8Array([
      ...expectedSignature.r(32),
      ...expectedSignature.s(32),
    ])

    expect(signedResponse).toBeDefined()
    expect(fromBase64(signedResponse!.signature.signature)).toEqual(expectedSignatureBytes)
  })
})

describe("expected address storage", () => {
  it("uses chain-scoped key format", () => {
    const key = getExpectedAddressKey("init1user", "chain-a")
    expect(key).toBe("autosign:init1user:chain-a")
  })

  it("writes and reads expected address per chain", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    }

    writeExpectedAddressToStorage(storage, "init1user", "chain-a", "init1granteeA")
    writeExpectedAddressToStorage(storage, "init1user", "chain-b", "init1granteeB")

    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-a")).toBe("init1granteeA")
    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-b")).toBe("init1granteeB")
  })

  it("returns null when storage read throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {},
    }

    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-a")).toBeNull()
  })

  it("does not throw when storage write fails", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied")
      },
    }

    expect(() =>
      writeExpectedAddressToStorage(storage, "init1user", "chain-a", "init1grantee"),
    ).not.toThrow()
  })

  it("clears only the exact revoked grantee mirror", () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    }
    writeExpectedAddressToStorage(storage, "init1user", "chain-a", "init1revoked")
    writeExpectedAddressToStorage(storage, "init1user", "chain-b", "init1unrelated")

    expect(clearExpectedAddressFromStorage(storage, "init1user", "chain-a", "init1different")).toBe(
      false,
    )
    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-a")).toBe("init1revoked")

    expect(clearExpectedAddressFromStorage(storage, "init1user", "chain-a", "init1revoked")).toBe(
      true,
    )
    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-a")).toBeNull()
    expect(readExpectedAddressFromStorage(storage, "init1user", "chain-b")).toBe("init1unrelated")
  })
})

describe("stored auto-sign identities", () => {
  const active = {
    owner: "init1owner",
    chainId: "initiation-2",
    bech32Prefix: "init",
    origin: "https://app.example",
    address: "init1active",
    publicKey: "public-key",
    provenance: "legacy-derived" as const,
    keyId: "active-key",
    state: "active" as const,
    revision: 3,
    requestedDurationMs: 60_000,
    observedExpiration: "2026-09-09T12:00:00.000Z",
  }

  it("preserves a matching active identity including its key and grant metadata", () => {
    expect(getMatchingActiveAutoSignIdentity(active, "init1active")).toBe(active)
  })

  it("does not treat forgotten or a different active grantee as a derivation conflict", () => {
    expect(
      getMatchingActiveAutoSignIdentity({ ...active, state: "forgotten" }, "init1active"),
    ).toBeUndefined()
    expect(getMatchingActiveAutoSignIdentity(active, "init1different")).toBeUndefined()
  })

  it("allows revocation to delete only the exact public identity", () => {
    const identity = {
      owner: active.owner,
      chainId: active.chainId,
      bech32Prefix: active.bech32Prefix,
      origin: active.origin,
    }
    expect(isExactAutoSignPublicIdentity(active, identity, active.keyId)).toBe(true)
    expect(isExactAutoSignPublicIdentity(active, identity, "other-key")).toBe(false)
    expect(
      isExactAutoSignPublicIdentity({ ...active, chainId: "other-chain" }, identity, active.keyId),
    ).toBe(false)
  })
})

describe("mergeAutoSignObservation", () => {
  it("preserves omitted fields but clears fields explicitly set to undefined", () => {
    const existing = {
      requestedDurationMs: 60_000,
      observedExpiration: "2026-09-09T12:00:00.000Z",
    }

    expect(mergeAutoSignObservation(existing, { requestedDurationMs: 0 })).toEqual({
      requestedDurationMs: 0,
      observedExpiration: "2026-09-09T12:00:00.000Z",
    })
    expect(
      mergeAutoSignObservation(existing, {
        requestedDurationMs: 0,
        observedExpiration: undefined,
      }),
    ).toEqual({ requestedDurationMs: 0, observedExpiration: undefined })
  })
})

describe("clearAllWalletState", () => {
  it("clears pending derivations and zeroizes cached key material", async () => {
    const store = createStore()
    const privateKey = fromHex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    const walletKey = "wallet-key"

    const pendingPromise = Promise.resolve({
      address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgkcpfs",
      publicKey: new Uint8Array([1, 2, 3]),
    })

    store.set(pendingDerivationsAtom, {
      [walletKey]: {
        promise: pendingPromise,
        token: "wallet-key:9",
      },
    })
    store.set(derivedWalletPrivateKeysAtom, { [walletKey]: privateKey })
    store.set(derivedWalletsAtom, {
      [walletKey]: {
        address: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgkcpfs",
        publicKey: new Uint8Array([4, 5, 6]),
      },
    })
    store.set(derivationSequenceAtom, 9)

    clearAllWalletState(store)

    expect(store.get(pendingDerivationsAtom)).toEqual({})
    expect(store.get(derivedWalletPrivateKeysAtom)).toEqual({})
    expect(store.get(derivedWalletsAtom)).toEqual({})
    expect(Array.from(privateKey)).toEqual(new Array(32).fill(0))
    expect(store.get(derivationSequenceAtom)).toBe(9)
  })
})

describe("shouldClearWalletsOnAddressChange", () => {
  it("returns false for initial connect", () => {
    expect(shouldClearWalletsOnAddressChange("", "init1new")).toBe(false)
  })

  it("returns false when address is unchanged", () => {
    expect(shouldClearWalletsOnAddressChange("init1same", "init1same")).toBe(false)
  })

  it("returns true when switching to another address", () => {
    expect(shouldClearWalletsOnAddressChange("init1old", "init1new")).toBe(true)
  })

  it("returns true when disconnecting after a connected session", () => {
    expect(shouldClearWalletsOnAddressChange("init1old", "")).toBe(true)
  })
})

describe("shouldBroadcastStorageMode", () => {
  it("skips a no-op preference write but reports an unexpected identity replacement", () => {
    expect(
      shouldBroadcastStorageMode({
        previousRevision: 3,
        nextRevision: 3,
        previousKeyId: "key-a",
        nextKeyId: "key-a",
      }),
    ).toBe(false)
    expect(
      shouldBroadcastStorageMode({
        previousRevision: 3,
        nextRevision: 3,
        previousKeyId: "key-a",
        nextKeyId: "key-b",
      }),
    ).toBe(true)
  })
})

describe("refreshOwnerWalletRevisions", () => {
  it("refreshes every cached chain for the owner without changing another owner", async () => {
    const { refreshOwnerWalletRevisions } = await import("./wallet")
    const { walletRevisionsAtom } = await import("./store")
    const store = createStore()
    store.set(walletRevisionsAtom, {
      move: { owner: "init1owner", generation: 4, storageRevision: 1, keyId: "move" },
      wasm: { owner: "init1owner", generation: 4, storageRevision: 1, keyId: "wasm" },
      other: { owner: "init1other", generation: 2, storageRevision: 9, keyId: "other" },
    })
    refreshOwnerWalletRevisions(store, "init1owner", 2)
    expect(store.get(walletRevisionsAtom)).toEqual({
      move: { owner: "init1owner", generation: 4, storageRevision: 2, keyId: "move" },
      wasm: { owner: "init1owner", generation: 4, storageRevision: 2, keyId: "wasm" },
      other: { owner: "init1other", generation: 2, storageRevision: 9, keyId: "other" },
    })
  })
})
