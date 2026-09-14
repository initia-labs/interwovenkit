import { afterEach, describe, expect, it, vi } from "vitest"
import { createStore } from "jotai/vanilla"
import { createRandomWallet } from "./derivation"
import {
  getAutoSignPublicIdentity,
  listAutoSignPublicIdentities,
  loadAutoSignWallet,
  saveAutoSignWallet,
} from "./storage"
import {
  activeWalletOwnerAtom,
  derivedWalletPrivateKeysAtom,
  derivedWalletsAtom,
  walletGenerationAtom,
  walletRevisionsAtom,
} from "./store"
import { useDeriveWallet } from "./wallet"

const harness = vi.hoisted(() => ({
  store: undefined as ReturnType<typeof createStore> | undefined,
  mode: "browser" as "browser" | "memory",
}))

vi.mock("react", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useEffect: () => undefined,
}))
vi.mock("jotai", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useStore: () => harness.store,
}))
vi.mock("wagmi", () => ({ useSignMessage: () => ({ signMessageAsync: vi.fn() }) }))
vi.mock("@/data/chains", () => ({
  useFindChain: () => () => ({ bech32_prefix: "init" }),
}))
vi.mock("@/data/config", () => ({ useConfig: () => ({ autoSignStorage: harness.mode }) }))
vi.mock("@/public/data/hooks", () => ({ useInitiaAddress: () => "init1owner" }))

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
        put: (value, key) => records.set(String(key), value),
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
}

function setBrowserGlobals() {
  harness.mode = "browser"
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  vi.stubGlobal("window", {
    sessionStorage,
    localStorage,
    location: { origin: identity.origin },
  })
  vi.stubGlobal("BroadcastChannel", undefined)
  vi.stubGlobal("navigator", {})
  return { sessionStorage, localStorage }
}

function createHarness() {
  const store = createStore()
  harness.store = store
  store.set(activeWalletOwnerAtom, identity.owner)
  // Hooks are invoked as plain functions because React and Jotai are replaced by this test harness.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return { store, hooks: useDeriveWallet() }
}

afterEach(() => {
  harness.store = undefined
  vi.unstubAllGlobals()
})

describe("wallet pause and revision lifecycle", () => {
  it("pauses an uncached session signer by keyId and keeps silent restore stopped", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "session")
    const keyId = (await getAutoSignPublicIdentity(identity))!.keyId
    const { hooks } = createHarness()

    await hooks.pauseWallet(identity.chainId, keyId)

    expect(await loadAutoSignWallet(identity)).toBeUndefined()
    expect(await getAutoSignPublicIdentity(identity)).toMatchObject({ keyId, state: "paused" })
    expect(await hooks.restoreWallet(identity.chainId)).toBeUndefined()

    await expect(hooks.resumeWallet(identity.chainId, undefined, keyId)).resolves.toMatchObject({
      address: wallet.address,
    })
    expect(await getAutoSignPublicIdentity(identity)).toMatchObject({ keyId, state: "active" })
    wallet.privateKey.fill(0)
  })

  it("lets another tab pause public session state so the original tab cannot restore its old copy", async () => {
    installIndexedDb()
    const { sessionStorage: firstTab } = setBrowserGlobals()
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "session")
    const keyId = (await getAutoSignPublicIdentity(identity))!.keyId
    const secondTab = new MemoryStorage()
    vi.stubGlobal("window", {
      sessionStorage: secondTab,
      localStorage: new MemoryStorage(),
      location: { origin: identity.origin },
    })
    const { hooks } = createHarness()

    await hooks.pauseWallet(identity.chainId, keyId)

    expect(secondTab.length).toBe(0)
    expect(await getAutoSignPublicIdentity(identity)).toMatchObject({ keyId, state: "paused" })
    vi.stubGlobal("window", {
      sessionStorage: firstTab,
      localStorage: new MemoryStorage(),
      location: { origin: identity.origin },
    })
    expect(await loadAutoSignWallet(identity)).toBeUndefined()
    wallet.privateKey.fill(0)
  })

  it("pauses an explicitly targeted active key without clearing a different cached candidate", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const activeWallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, activeWallet, "persistent")
    const activeKeyId = (await getAutoSignPublicIdentity(identity))!.keyId
    const { hooks } = createHarness()
    const pending = await hooks.createWallet(identity.chainId, {
      random: true,
      stayConnected: true,
    })
    const pendingRevision = hooks.getWalletRevision(identity.chainId)

    await hooks.pauseWallet(identity.chainId, activeKeyId)

    expect(hooks.getWallet(identity.chainId)).toEqual(pending)
    expect(hooks.getWalletRevision(identity.chainId)).toBe(pendingRevision)
    expect(await getAutoSignPublicIdentity(identity)).toMatchObject({
      keyId: activeKeyId,
      state: "paused",
    })
    activeWallet.privateKey.fill(0)
  })

  it("clears an exact cached pending key after confirmed revoke", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const { hooks } = createHarness()
    await hooks.createWallet(identity.chainId, { random: true, stayConnected: true })
    const keyId = hooks.getWalletRevision(identity.chainId)!.keyId

    await hooks.deleteWalletAfterConfirmedRevoke(identity.chainId, undefined, keyId)

    expect(hooks.getWallet(identity.chainId)).toBeUndefined()
    expect(await hooks.getPendingIdentities(identity.chainId)).toEqual([])
  })

  it("zeroizes a paused copy when resume finds that the target is still pending", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const { hooks } = createHarness()
    const pending = await hooks.createWallet(identity.chainId, {
      random: true,
      stayConnected: true,
    })
    const revision = hooks.getWalletRevision(identity.chainId)!
    const pausedPrivateKey = new Uint8Array(hooks.getWalletPrivateKey(identity.chainId)!)

    await expect(
      hooks.resumeWallet(identity.chainId, {
        ...pending,
        privateKey: pausedPrivateKey,
        provenance: "random",
        revision: revision.storageRevision,
        keyId: revision.keyId,
        state: "paused",
      }),
    ).resolves.toBeUndefined()

    expect([...pausedPrivateKey]).toEqual(new Array(32).fill(0))
    expect(await hooks.getPendingIdentities(identity.chainId)).toHaveLength(1)
  })

  it("rejects a captured session revision after clear and restore reinsert the same values", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "session")
    const { hooks } = createHarness()
    await hooks.restoreWallet(identity.chainId)
    const captured = hooks.getWalletRevision(identity.chainId)
    hooks.clearWallet(identity.chainId)
    await hooks.restoreWallet(identity.chainId)

    await expect(hooks.assertWalletRevision(identity.chainId, captured)).rejects.toThrow()
    await expect(
      hooks.assertWalletRevision(identity.chainId, hooks.getWalletRevision(identity.chainId)),
    ).resolves.toBeUndefined()
    wallet.privateKey.fill(0)
  })

  it("rejects a captured memory revision immediately after pause clears its cache entry", async () => {
    installIndexedDb()
    setBrowserGlobals()
    harness.mode = "memory"
    const wallet = await createRandomWallet(identity.bech32Prefix)
    const { store, hooks } = createHarness()
    const key = `${identity.owner}:${identity.bech32Prefix}:${identity.chainId}`
    const revision = {
      owner: identity.owner,
      generation: store.get(walletGenerationAtom),
      storageRevision: 0,
      keyId: "memory:0",
    }
    store.set(derivedWalletsAtom, {
      [key]: { address: wallet.address, publicKey: wallet.publicKey },
    })
    store.set(derivedWalletPrivateKeysAtom, { [key]: wallet.privateKey })
    store.set(walletRevisionsAtom, { [key]: revision })

    await hooks.pauseWallet(identity.chainId)

    await expect(hooks.assertWalletRevision(identity.chainId, revision)).rejects.toThrow()
  })
})

describe("owner-wide Forget lifecycle", () => {
  it("clears every cached chain only after the durable tombstone commits", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const sibling = { ...identity, chainId: "initiation-3" }
    const first = await createRandomWallet(identity.bech32Prefix)
    const second = await createRandomWallet(sibling.bech32Prefix)
    await saveAutoSignWallet(identity, first, "session")
    await saveAutoSignWallet(sibling, second, "session")
    const { store, hooks } = createHarness()
    await hooks.restoreWallet(identity.chainId)
    await hooks.restoreWallet(sibling.chainId)
    const firstCachedKey = hooks.getWalletPrivateKey(identity.chainId)!
    const secondCachedKey = hooks.getWalletPrivateKey(sibling.chainId)!
    const generation = store.get(walletGenerationAtom)

    await hooks.forgetWallet(identity.chainId)

    expect(hooks.getWallet(identity.chainId)).toBeUndefined()
    expect(hooks.getWallet(sibling.chainId)).toBeUndefined()
    expect([...firstCachedKey]).toEqual(new Array(32).fill(0))
    expect([...secondCachedKey]).toEqual(new Array(32).fill(0))
    expect(store.get(walletGenerationAtom)).toBe(generation + 1)
    expect(await listAutoSignPublicIdentities(identity.owner, identity.origin)).toEqual([
      expect.objectContaining({ chainId: identity.chainId, state: "forgotten" }),
      expect.objectContaining({ chainId: sibling.chainId, state: "forgotten" }),
    ])
    first.privateKey.fill(0)
    second.privateKey.fill(0)
  })

  it("does not clear or overwrite a newly connected owner's cache when Forget completes late", async () => {
    installIndexedDb()
    setBrowserGlobals()
    const wallet = await createRandomWallet(identity.bech32Prefix)
    await saveAutoSignWallet(identity, wallet, "session")
    const { store, hooks } = createHarness()
    const forgetting = hooks.forgetWallet(identity.chainId)
    const nextOwner = "init1nextowner"
    const nextKey = "next-owner-key"
    const nextPrivateKey = new Uint8Array([9, 8, 7])
    store.set(activeWalletOwnerAtom, nextOwner)
    store.set(walletGenerationAtom, (generation) => generation + 1)
    store.set(derivedWalletPrivateKeysAtom, { [nextKey]: nextPrivateKey })

    await forgetting

    expect(store.get(activeWalletOwnerAtom)).toBe(nextOwner)
    expect(store.get(derivedWalletPrivateKeysAtom)[nextKey]).toBe(nextPrivateKey)
    expect([...nextPrivateKey]).toEqual([9, 8, 7])
    wallet.privateKey.fill(0)
  })
})
