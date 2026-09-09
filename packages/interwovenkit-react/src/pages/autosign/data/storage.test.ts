import { afterEach, describe, expect, it, vi } from "vitest"
import { createRandomWallet } from "./derivation"
import {
  activatePendingAutoSignWallet,
  AutoSignCancelledError,
  AutoSignStorageError,
  createPendingRandomAutoSignWallet,
  forgetAutoSignWallet,
  getAutoSignPreference,
  listAutoSignPublicIdentities,
  loadAutoSignWallet,
  saveAutoSignWallet,
} from "./storage"

const identity = {
  owner: "init1owner",
  chainId: "initiation-2",
  bech32Prefix: "init",
  origin: "https://app.example",
}

class MemoryStorage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

type FakeEvent<T> = { target: T }

interface FakeRequest<T> {
  result: T
  onsuccess?: (event: FakeEvent<FakeRequest<T>>) => unknown
}

interface FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded?: (event: FakeEvent<FakeOpenRequest>) => unknown
}

interface FakeObjectStore {
  get: (key: IDBValidKey) => IDBRequest<unknown>
  getAllKeys: () => IDBRequest<string[]>
  put: (value: unknown, key: IDBValidKey) => void
  delete: (key: IDBValidKey) => void
}

interface FakeTransaction {
  error?: DOMException | null
  abort: () => void
  onabort?: (event: FakeEvent<FakeTransaction>) => unknown
  oncomplete?: (event: FakeEvent<FakeTransaction>) => unknown
  onerror?: (event: FakeEvent<FakeTransaction>) => unknown
  objectStore: (_name: string) => FakeObjectStore
}

interface FakeDatabase {
  objectStoreNames: { contains: (_name: string) => boolean }
  close: () => void
  transaction: (_name: string, _mode: IDBTransactionMode) => FakeTransaction
}

const records = new Map<string, unknown>()

function installIndexedDb() {
  records.clear()
  const request = <T>(result: T) => {
    const value: FakeRequest<T> = { result }
    queueMicrotask(() => value.onsuccess?.({ target: value }))
    return value as unknown as IDBRequest<T>
  }
  const database: FakeDatabase = {
    objectStoreNames: { contains: () => true },
    close: () => undefined,
    transaction: () => {
      const snapshot = new Map(records)
      let finished = false
      const transaction: FakeTransaction = {
        abort: () => {
          if (finished) throw new DOMException("Transaction already finished", "InvalidStateError")
          finished = true
          records.clear()
          for (const [key, value] of snapshot) records.set(key, value)
          queueMicrotask(() => transaction.onabort?.({ target: transaction }))
        },
        objectStore: () => store,
      }
      const store: FakeObjectStore = {
        get: (key) => request(records.get(String(key))),
        getAllKeys: () => request([...records.keys()]),
        put: (value, key) => {
          records.set(String(key), value)
        },
        delete: (key) => {
          records.delete(String(key))
        },
      }
      setTimeout(() => {
        if (finished) return
        finished = true
        transaction.oncomplete?.({ target: transaction })
      }, 0)
      return transaction
    },
  }
  const indexedDb = {
    open: () => {
      const open: FakeOpenRequest = { result: database }
      queueMicrotask(() => {
        open.onupgradeneeded?.({ target: open })
        open.onsuccess?.({ target: open })
      })
      return open as unknown as IDBOpenDBRequest
    },
  }
  vi.stubGlobal("indexedDB", indexedDb as unknown as IDBFactory)
  return records
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("abandoned pending auto-sign candidates", () => {
  it("does not block a persistent-to-session handoff and remains known for recovery", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })

    const pendingWallet = await createRandomWallet(identity.bech32Prefix)
    const sessionWallet = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, pendingWallet)

    await saveAutoSignWallet(identity, sessionWallet, "session")

    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      stayConnected: false,
      revision: 1,
    })
    const identities = await listAutoSignPublicIdentities(identity.owner, identity.origin)
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: sessionWallet.address, state: "active" }),
        expect.objectContaining({
          address: pending.address,
          keyId: pending.keyId,
          state: "forgotten",
        }),
      ]),
    )
    expect(identities.some((candidate) => candidate.state === "pending")).toBe(false)

    const restored = await loadAutoSignWallet(identity)
    expect(restored?.address).toBe(sessionWallet.address)
    restored?.privateKey.fill(0)
    pendingWallet.privateKey.fill(0)
    sessionWallet.privateKey.fill(0)

    const replacementIdentity = { ...identity, chainId: "initiation-3" }
    const forgottenRandomWallet = await createRandomWallet(replacementIdentity.bech32Prefix)
    const forgottenPending = await createPendingRandomAutoSignWallet(
      replacementIdentity,
      forgottenRandomWallet,
    )
    await activatePendingAutoSignWallet(replacementIdentity, forgottenPending.keyId)
    await forgetAutoSignWallet(replacementIdentity)

    const replacementWallet = await createRandomWallet(replacementIdentity.bech32Prefix)
    await saveAutoSignWallet(replacementIdentity, replacementWallet, "session")

    const replacementIdentities = await listAutoSignPublicIdentities(
      replacementIdentity.owner,
      replacementIdentity.origin,
    )
    expect(replacementIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: forgottenPending.address,
          keyId: forgottenPending.keyId,
          state: "forgotten",
        }),
        expect.objectContaining({ address: replacementWallet.address, state: "active" }),
      ]),
    )
    forgottenRandomWallet.privateKey.fill(0)
    replacementWallet.privateKey.fill(0)
  })
})

describe("stable auto-sign identity", () => {
  it.each(["persistent", "session"] as const)(
    "restores the same %s signer using only owner, chain, prefix, and origin",
    async (mode) => {
      const records = installIndexedDb()
      const sessionStorage = new MemoryStorage()
      vi.stubGlobal("window", { sessionStorage })
      const wallet = await createRandomWallet(identity.bech32Prefix)
      await saveAutoSignWallet(identity, wallet, mode)

      const restored = await loadAutoSignWallet({ ...identity })
      expect(restored?.address).toBe(wallet.address)
      expect(restored?.privateKey).toEqual(wallet.privateKey)
      expect(await listAutoSignPublicIdentities(identity.owner, identity.origin)).toEqual([
        expect.objectContaining({ ...identity, address: wallet.address, keyId: restored?.keyId }),
      ])
      const suffix = `${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
      if (mode === "persistent") {
        expect(records.has(`wallet:${suffix}`)).toBe(true)
      } else {
        expect(sessionStorage.getItem(`interwovenkit:autosign:session:${suffix}`)).not.toBeNull()
      }
      expect(records.has(`identity:${suffix}`)).toBe(true)

      for (const differentIdentity of [
        { ...identity, owner: "init1anotherowner" },
        { ...identity, chainId: "another-chain" },
        { ...identity, bech32Prefix: "another" },
        { ...identity, origin: "https://another-app.example" },
      ]) {
        if (differentIdentity.origin !== identity.origin) {
          await expect(loadAutoSignWallet(differentIdentity)).rejects.toBeInstanceOf(
            AutoSignStorageError,
          )
        } else {
          expect(await loadAutoSignWallet(differentIdentity)).toBeUndefined()
        }
      }
      restored?.privateKey.fill(0)
      wallet.privateKey.fill(0)
    },
  )

  it("authenticates chain and origin in persistent ciphertext even if metadata is rewritten", async () => {
    const records = installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "persistent")
    const originalKey = `wallet:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
    const originalRecord = records.get(originalKey) as Record<string, unknown>
    const preferenceKey = `preference:${identity.owner}`
    const originalPreference = records.get(preferenceKey) as Record<string, unknown>

    for (const changed of [
      { ...identity, chainId: "another-chain" },
      { ...identity, origin: "https://another-app.example" },
    ]) {
      records.set(`wallet:${changed.owner}:${changed.chainId}:${changed.bech32Prefix}`, {
        ...originalRecord,
        ...changed,
      })
      records.set(preferenceKey, { ...originalPreference, origin: changed.origin })
      expect(await loadAutoSignWallet(changed)).toBeUndefined()
    }
    wallet.privateKey.fill(0)
  })

  it("migrates every valid owner session after discarding an earlier invalid record", async () => {
    const records = installIndexedDb()
    const sessionStorage = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "session")
    await saveAutoSignWallet(siblingIdentity, siblingWallet, "session")

    const firstSessionKey = `interwovenkit:autosign:session:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
    const invalid = JSON.parse(sessionStorage.getItem(firstSessionKey)!) as Record<string, unknown>
    sessionStorage.setItem(firstSessionKey, JSON.stringify({ ...invalid, schemaVersion: 0 }))

    const replacement = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, replacement, "persistent")

    expect(
      records.has(
        `wallet:${siblingIdentity.owner}:${siblingIdentity.chainId}:${siblingIdentity.bech32Prefix}`,
      ),
    ).toBe(true)
    expect(sessionStorage.length).toBe(0)

    firstWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })

  it("cleans staged sibling sessions and restores the prior current value after cancellation", async () => {
    const records = installIndexedDb()
    const sessionStorage = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage })
    const originalWallet = await createRandomWallet(identity.bech32Prefix)
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    await saveAutoSignWallet(identity, originalWallet, "persistent")
    await saveAutoSignWallet(siblingIdentity, siblingWallet, "persistent")
    const preferenceKey = `preference:${identity.owner}`
    const identityKey = `identity:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
    const walletKey = `wallet:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
    const siblingIdentityKey = `identity:${siblingIdentity.owner}:${siblingIdentity.chainId}:${siblingIdentity.bech32Prefix}`
    const siblingWalletKey = `wallet:${siblingIdentity.owner}:${siblingIdentity.chainId}:${siblingIdentity.bech32Prefix}`
    const originalPreference = records.get(preferenceKey)
    const originalIdentity = records.get(identityKey)
    const originalWalletRecord = records.get(walletKey)
    const originalSiblingIdentity = records.get(siblingIdentityKey)
    const originalSiblingWalletRecord = records.get(siblingWalletKey)
    const sessionKey = `interwovenkit:autosign:session:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
    const siblingSessionKey = `interwovenkit:autosign:session:${siblingIdentity.owner}:${siblingIdentity.chainId}:${siblingIdentity.bech32Prefix}`
    sessionStorage.setItem(sessionKey, "prior-session-value")

    const replacement = await createRandomWallet(identity.bech32Prefix)
    await expect(
      saveAutoSignWallet(
        identity,
        replacement,
        "session",
        () =>
          (records.get(preferenceKey) as { stayConnected?: boolean } | undefined)?.stayConnected !==
          false,
      ),
    ).rejects.toBeInstanceOf(AutoSignCancelledError)

    expect(records.get(preferenceKey)).toBe(originalPreference)
    expect(records.get(identityKey)).toBe(originalIdentity)
    expect(records.get(walletKey)).toBe(originalWalletRecord)
    expect(records.get(siblingIdentityKey)).toBe(originalSiblingIdentity)
    expect(records.get(siblingWalletKey)).toBe(originalSiblingWalletRecord)
    expect(sessionStorage.getItem(sessionKey)).toBe("prior-session-value")
    expect(sessionStorage.getItem(siblingSessionKey)).toBeNull()

    records.set(siblingWalletKey, {
      ...(originalSiblingWalletRecord as Record<string, unknown>),
      wrappingKey: undefined,
    })
    await expect(saveAutoSignWallet(identity, replacement, "session")).rejects.toBeInstanceOf(
      AutoSignStorageError,
    )
    expect(sessionStorage.getItem(sessionKey)).toBe("prior-session-value")
    expect(sessionStorage.getItem(siblingSessionKey)).toBeNull()

    originalWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })
})
