import { afterEach, describe, expect, it, vi } from "vitest"
import { createRandomWallet } from "./derivation"
import {
  activatePendingAutoSignWallet,
  AutoSignCancelledError,
  AutoSignPendingResolutionError,
  AutoSignStorageError,
  createPendingRandomAutoSignWallet,
  deleteAutoSignWallet,
  forgetAutoSignWallet,
  getAutoSignPreference,
  getAutoSignPublicIdentity,
  listAutoSignPublicIdentities,
  listOwnerPendingIdentities,
  loadAutoSignWallet,
  saveAutoSignWallet,
  setAutoSignWalletState,
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
let failWritesForKey: string | undefined

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
          if (String(key) === failWritesForKey) throw new Error("injected write failure")
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

async function rewritePendingAsLegacyRecord(
  targetIdentity: typeof identity,
  keyId: string,
  privateKey: Uint8Array,
) {
  const key = `wallet:${targetIdentity.owner}:${targetIdentity.chainId}:${targetIdentity.bech32Prefix}:pending:${keyId}`
  const record = records.get(key) as {
    owner: string
    chainId: string
    bech32Prefix: string
    origin: string
    address: string
    publicKey: string
    revision: number
    keyId: string
    state: string
    requestedDurationMs?: number
    observedExpiration?: string
    schemaVersion: number
    nonce: ArrayBuffer
    wrappingKey: CryptoKey
    supersedes?: string | null
    startingPreferenceRevision?: number
    requestedMode?: string
    ciphertext: ArrayBuffer
  }
  const additionalData = new TextEncoder().encode(
    JSON.stringify({
      owner: record.owner,
      chainId: record.chainId,
      bech32Prefix: record.bech32Prefix,
      origin: record.origin,
      address: record.address,
      publicKey: record.publicKey,
      revision: record.revision,
      keyId: record.keyId,
      state: record.state,
      requestedDurationMs: record.requestedDurationMs,
      observedExpiration: record.observedExpiration,
      schemaVersion: record.schemaVersion,
    }),
  )
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: record.nonce, additionalData },
    record.wrappingKey,
    new Uint8Array(privateKey).buffer,
  )
  const legacy = { ...record, ciphertext }
  delete legacy.supersedes
  delete legacy.startingPreferenceRevision
  delete legacy.requestedMode
  records.set(key, legacy)
}

afterEach(() => {
  failWritesForKey = undefined
  vi.unstubAllGlobals()
})

describe("abandoned pending auto-sign candidates", () => {
  it("blocks a persistent-to-session handoff and preserves the pending candidate", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })

    const pendingWallet = await createRandomWallet(identity.bech32Prefix)
    const sessionWallet = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, pendingWallet)

    await expect(saveAutoSignWallet(identity, sessionWallet, "session")).rejects.toBeInstanceOf(
      AutoSignPendingResolutionError,
    )

    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      stayConnected: true,
      revision: 0,
    })
    const identities = await listAutoSignPublicIdentities(identity.owner, identity.origin)
    expect(identities).toEqual([
      expect.objectContaining({
        address: pending.address,
        keyId: pending.keyId,
        state: "pending",
      }),
    ])
    pendingWallet.privateKey.fill(0)
    sessionWallet.privateKey.fill(0)
  })
})

describe("pending random signer lifecycle", () => {
  it("stages without changing a session preference or migrating sibling session keys", async () => {
    const records = installIndexedDb()
    const sessionStorage = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage })
    const active = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, active, "session")
    const before = await getAutoSignPreference(identity.owner, identity.origin)
    const sibling = { ...identity, chainId: "initiation-3" }
    const candidate = await createRandomWallet(sibling.bech32Prefix)

    const pending = await createPendingRandomAutoSignWallet(sibling, candidate)

    expect(await getAutoSignPreference(identity.owner, identity.origin)).toEqual(before)
    expect(sessionStorage.length).toBe(1)
    expect(
      records.has(`wallet:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`),
    ).toBe(false)
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: active.address })
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ keyId: pending.keyId, state: "pending" }),
    ])
    active.privateKey.fill(0)
    candidate.privateKey.fill(0)
  })

  it("keeps an older candidate pending when a newer candidate was activated first", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    const secondWallet = await createRandomWallet(identity.bech32Prefix)
    const first = await createPendingRandomAutoSignWallet(identity, firstWallet)
    const second = await createPendingRandomAutoSignWallet(identity, secondWallet)

    await activatePendingAutoSignWallet(identity, second.keyId, { mode: "persistent" })
    await expect(
      activatePendingAutoSignWallet(identity, first.keyId, { mode: "persistent" }),
    ).rejects.toBeInstanceOf(AutoSignCancelledError)

    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: secondWallet.address })
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ keyId: first.keyId, state: "pending" }),
    ])
    firstWallet.privateKey.fill(0)
    secondWallet.privateKey.fill(0)
  })

  it("keeps background activation stopped after Forget but allows explicit activation staged later", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const original = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, original, "persistent")
    await forgetAutoSignWallet(identity)
    const replacement = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, replacement)

    await expect(activatePendingAutoSignWallet(identity, pending.keyId)).rejects.toBeInstanceOf(
      AutoSignCancelledError,
    )
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toHaveLength(1)

    const activated = await activatePendingAutoSignWallet(identity, pending.keyId, {
      mode: "persistent",
    })
    expect(activated).toMatchObject({ keyId: pending.keyId, mode: "persistent" })
    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      forgotten: false,
      stayConnected: true,
      revision: activated.revision,
    })
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: replacement.address })
    original.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })

  it("allows an intentional replacement when the authenticated predecessor still matches", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const original = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, original, "persistent")
    const replacement = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, replacement)

    const activated = await activatePendingAutoSignWallet(identity, pending.keyId, {
      mode: "persistent",
    })

    expect(await loadAutoSignWallet(identity)).toMatchObject({
      address: replacement.address,
      keyId: activated.keyId,
      revision: activated.revision,
    })
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([])
    original.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })

  it("migrates a session predecessor and activates its replacement in one persistent commit", async () => {
    const sessionStorage = new MemoryStorage()
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage })
    const original = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, original, "session")
    const replacement = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, replacement)

    const activated = await activatePendingAutoSignWallet(identity, pending.keyId, {
      mode: "persistent",
    })

    expect(activated.mode).toBe("persistent")
    expect(sessionStorage.length).toBe(0)
    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      stayConnected: true,
      revision: activated.revision,
    })
    expect(await loadAutoSignWallet(identity)).toMatchObject({
      address: replacement.address,
      keyId: pending.keyId,
    })
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([])
    original.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })

  it("allows only one concurrent activation and keeps the loser pending", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    const secondWallet = await createRandomWallet(identity.bech32Prefix)
    const first = await createPendingRandomAutoSignWallet(identity, firstWallet)
    const second = await createPendingRandomAutoSignWallet(identity, secondWallet)

    const results = await Promise.allSettled([
      activatePendingAutoSignWallet(identity, first.keyId, { mode: "persistent" }),
      activatePendingAutoSignWallet(identity, second.keyId, { mode: "persistent" }),
    ])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    const active = await loadAutoSignWallet(identity)
    const pending = await listOwnerPendingIdentities(identity.owner, identity.origin)
    expect(pending).toHaveLength(1)
    expect(pending[0].keyId).not.toBe(active?.keyId)
    firstWallet.privateKey.fill(0)
    secondWallet.privateKey.fill(0)
  })

  it("rejects activation when the pending public identity no longer binds to its ciphertext", async () => {
    const records = installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const candidate = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, candidate)
    const pendingIdentityKey = `identity:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}:pending:${pending.keyId}`
    records.set(pendingIdentityKey, {
      ...(records.get(pendingIdentityKey) as Record<string, unknown>),
      address: "init1mismatched",
    })

    await expect(
      activatePendingAutoSignWallet(identity, pending.keyId, { mode: "persistent" }),
    ).rejects.toBeInstanceOf(AutoSignCancelledError)
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ keyId: pending.keyId, address: "init1mismatched" }),
    ])
    candidate.privateKey.fill(0)
  })

  it("activates under the current session mode without making the preference persistent", async () => {
    const sessionStorage = new MemoryStorage()
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage })
    const existing = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, existing, "session")
    const sibling = { ...identity, chainId: "initiation-3" }
    const candidate = await createRandomWallet(sibling.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(sibling, candidate)

    const activated = await activatePendingAutoSignWallet(sibling, pending.keyId)

    expect(activated.mode).toBe("session")
    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      stayConnected: false,
    })
    expect(await loadAutoSignWallet(sibling)).toMatchObject({ address: candidate.address })
    expect(sessionStorage.length).toBe(2)
    existing.privateKey.fill(0)
    candidate.privateKey.fill(0)
  })

  it("activates an old pending record without predecessor metadata only when no identity exists", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const candidate = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, candidate)
    await rewritePendingAsLegacyRecord(identity, pending.keyId, candidate.privateKey)

    await expect(
      activatePendingAutoSignWallet(identity, pending.keyId, { mode: "persistent" }),
    ).resolves.toMatchObject({ keyId: pending.keyId })
    candidate.privateKey.fill(0)
  })

  it("fails closed for an old pending record without predecessor metadata when an identity exists", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const original = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, original, "persistent")
    const candidate = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, candidate)
    await rewritePendingAsLegacyRecord(identity, pending.keyId, candidate.privateKey)

    await expect(
      activatePendingAutoSignWallet(identity, pending.keyId, { mode: "persistent" }),
    ).rejects.toBeInstanceOf(AutoSignCancelledError)
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: original.address })
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toHaveLength(1)
    original.privateKey.fill(0)
    candidate.privateKey.fill(0)
  })

  it("leaves a pending signer pending when pause is requested for its uncached key", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const candidate = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, candidate)

    await expect(setAutoSignWalletState(identity, pending.keyId, "paused")).resolves.toBe(false)
    expect(await listOwnerPendingIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ keyId: pending.keyId, state: "pending" }),
    ])
    candidate.privateKey.fill(0)
  })

  it("deletes a superseded forgotten identity without touching the newer active signer", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const original = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, original, "persistent")
    const originalKeyId = (await getAutoSignPublicIdentity(identity))!.keyId
    await forgetAutoSignWallet(identity)
    const replacement = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, replacement)
    await activatePendingAutoSignWallet(identity, pending.keyId, { mode: "persistent" })

    await deleteAutoSignWallet(identity, originalKeyId)

    expect(await listAutoSignPublicIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ keyId: pending.keyId, state: "active" }),
    ])
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: replacement.address })
    original.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })
})

describe("storage revision and pending-resolution fences", () => {
  it("rejects a cached-material save whose captured revision predates Forget", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const wallet = await createRandomWallet(identity.bech32Prefix)
    const saved = await saveAutoSignWallet(identity, wallet, "persistent")
    await forgetAutoSignWallet(identity)

    await expect(
      saveAutoSignWallet(identity, wallet, "persistent", () => true, undefined, {
        expectedRevision: saved.revision,
      }),
    ).rejects.toBeInstanceOf(AutoSignCancelledError)
    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      forgotten: true,
    })
    expect(await loadAutoSignWallet(identity)).toBeUndefined()
    wallet.privateKey.fill(0)
  })

  it("retains the session signer when the durable Forget transaction fails", async () => {
    installIndexedDb()
    const sessionStorage = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage })
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "session")
    failWritesForKey = `preference:${identity.owner}`

    await expect(forgetAutoSignWallet(identity)).rejects.toBeInstanceOf(AutoSignStorageError)

    failWritesForKey = undefined
    expect(sessionStorage.length).toBe(1)
    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      forgotten: false,
      stayConnected: false,
    })
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: wallet.address })
    wallet.privateKey.fill(0)
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

  it("round-trips loaded sibling signers from persistent to session and back", async () => {
    installIndexedDb()
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "persistent")
    await saveAutoSignWallet(siblingIdentity, siblingWallet, "persistent")
    const firstPublicIdentity = (await getAutoSignPublicIdentity(identity))!
    const loadedFirst = (await loadAutoSignWallet(identity))!
    const loadedSibling = (await loadAutoSignWallet(siblingIdentity))!

    await saveAutoSignWallet(identity, loadedFirst, "session", () => true, firstPublicIdentity)

    const sessionFirst = await loadAutoSignWallet(identity)
    const sessionSibling = await loadAutoSignWallet(siblingIdentity)
    expect(sessionFirst).toMatchObject({
      address: loadedFirst.address,
      keyId: firstPublicIdentity.keyId,
    })
    expect(sessionSibling).toMatchObject({
      address: loadedSibling.address,
      keyId: loadedSibling.keyId,
    })

    await saveAutoSignWallet(
      identity,
      sessionFirst!,
      "persistent",
      () => true,
      (await getAutoSignPublicIdentity(identity))!,
    )

    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: loadedFirst.address })
    expect(await loadAutoSignWallet(siblingIdentity)).toMatchObject({
      address: loadedSibling.address,
      keyId: loadedSibling.keyId,
    })
    firstWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
    loadedFirst.privateKey.fill(0)
    loadedSibling.privateKey.fill(0)
    sessionFirst?.privateKey.fill(0)
    sessionSibling?.privateKey.fill(0)
  })

  it("does not migrate a stale sibling session over a newer key at the same preference revision", async () => {
    installIndexedDb()
    const firstTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: firstTab })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const staleSiblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "session")
    await saveAutoSignWallet(siblingIdentity, staleSiblingWallet, "session")

    const secondTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: secondTab })
    const replacementSiblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(
      siblingIdentity,
      replacementSiblingWallet,
    )
    await activatePendingAutoSignWallet(siblingIdentity, pending.keyId)
    vi.stubGlobal("window", { sessionStorage: firstTab })

    await expect(saveAutoSignWallet(identity, firstWallet, "persistent")).rejects.toThrow(
      /tab holding.*initiation-3.*Settings.*Forget this browser/i,
    )

    expect(await getAutoSignPublicIdentity(siblingIdentity)).toMatchObject({
      keyId: pending.keyId,
      address: replacementSiblingWallet.address,
      state: "active",
    })
    expect(firstTab.length).toBe(2)
    firstWallet.privateKey.fill(0)
    staleSiblingWallet.privateKey.fill(0)
    replacementSiblingWallet.privateKey.fill(0)
  })

  it("blocks an upgrade when another tab exclusively holds an active random sibling", async () => {
    installIndexedDb()
    const firstTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: firstTab })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "session")
    const secondTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: secondTab })
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(siblingIdentity, siblingWallet)
    await activatePendingAutoSignWallet(siblingIdentity, pending.keyId)
    vi.stubGlobal("window", { sessionStorage: firstTab })

    await expect(saveAutoSignWallet(identity, firstWallet, "persistent")).rejects.toThrow(
      /tab holding.*initiation-3.*Settings.*Forget this browser/i,
    )

    expect(await getAutoSignPreference(identity.owner, identity.origin)).toMatchObject({
      stayConnected: false,
    })
    vi.stubGlobal("window", { sessionStorage: secondTab })
    expect(await loadAutoSignWallet(siblingIdentity)).toMatchObject({
      address: siblingWallet.address,
      keyId: pending.keyId,
    })
    firstWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
  })

  it("allows explicit replacement when the missing random session key is the current target", async () => {
    installIndexedDb()
    const firstTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: firstTab })
    const seed = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, seed, "session")
    const original = await createRandomWallet(identity.bech32Prefix)
    const originalPending = await createPendingRandomAutoSignWallet(identity, original)
    await activatePendingAutoSignWallet(identity, originalPending.keyId)
    const replacementTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: replacementTab })
    const replacement = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, replacement)

    const activated = await activatePendingAutoSignWallet(identity, pending.keyId, {
      mode: "persistent",
    })

    expect(activated).toMatchObject({ keyId: pending.keyId, mode: "persistent" })
    expect(await loadAutoSignWallet(identity)).toMatchObject({
      address: replacement.address,
      keyId: pending.keyId,
    })
    expect(firstTab.length).toBe(1)
    expect(replacementTab.length).toBe(0)
    seed.privateKey.fill(0)
    original.privateKey.fill(0)
    replacement.privateKey.fill(0)
  })

  it("discards an orphan session sibling after its durable identity was revoked", async () => {
    installIndexedDb()
    const firstTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: firstTab })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "session")
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(siblingIdentity, siblingWallet)
    await activatePendingAutoSignWallet(siblingIdentity, pending.keyId)
    const secondTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: secondTab })
    await deleteAutoSignWallet(siblingIdentity, pending.keyId)
    vi.stubGlobal("window", { sessionStorage: firstTab })

    await expect(saveAutoSignWallet(identity, firstWallet, "persistent")).resolves.toMatchObject({
      stayConnected: true,
    })

    expect(firstTab.length).toBe(0)
    expect(await getAutoSignPublicIdentity(siblingIdentity)).toBeUndefined()
    expect(await loadAutoSignWallet(identity)).toMatchObject({ address: firstWallet.address })
    firstWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
  })

  it("adopts a durable sibling pause while migrating an older active session copy", async () => {
    installIndexedDb()
    const firstTab = new MemoryStorage()
    vi.stubGlobal("window", { sessionStorage: firstTab })
    const firstWallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, firstWallet, "session")
    const siblingIdentity = { ...identity, chainId: "initiation-3" }
    const siblingWallet = await createRandomWallet(siblingIdentity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(siblingIdentity, siblingWallet)
    await activatePendingAutoSignWallet(siblingIdentity, pending.keyId)
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() })
    await setAutoSignWalletState(siblingIdentity, pending.keyId, "paused")
    vi.stubGlobal("window", { sessionStorage: firstTab })

    const preference = await saveAutoSignWallet(identity, firstWallet, "persistent")

    expect(await getAutoSignPublicIdentity(siblingIdentity)).toMatchObject({
      keyId: pending.keyId,
      revision: preference.revision,
      state: "paused",
    })
    expect(await loadAutoSignWallet(siblingIdentity)).toBeUndefined()
    await setAutoSignWalletState(siblingIdentity, pending.keyId, "active")
    expect(await loadAutoSignWallet(siblingIdentity)).toMatchObject({
      address: siblingWallet.address,
    })
    firstWallet.privateKey.fill(0)
    siblingWallet.privateKey.fill(0)
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
