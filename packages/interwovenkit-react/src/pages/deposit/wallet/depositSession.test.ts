import { LocalStorageKey } from "@/data/constants"
import type { DepositSession, StorageLike } from "./depositSession"
import {
  createDepositSession,
  DepositSessionLockError,
  depositSessionStorageKey,
  DepositSessionWriteError,
  holdDepositSessionLock,
  isPhaseAdvance,
  listDepositSessions,
  mergeDepositSession,
  parseDepositSession,
  pruneDepositSessions,
  readDepositSession,
  recoveryReference,
  rollbackDepositSessionPrompt,
  writeDepositSession,
} from "./depositSession"

interface MemoryStorage extends StorageLike {
  map: Map<string, string>
}

function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

const SENDER = "0x4e3d1f2a6b5c8d9e0f1a2b3c4d5e6f7a8b9c0d1e"
const DEPOSIT_ADDRESS = "0x1111111111111111111111111111111111111111"

function buildSession(overrides: Partial<DepositSession> = {}): DepositSession {
  return {
    version: 1,
    id: "session-1",
    apiUrl: "https://deposit.staging.example",
    createdAt: 1_000,
    updatedAt: 1_000,
    transport: "lifi",
    phase: "prepared",
    source: {
      chainId: "8453",
      denom: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      sender: SENDER,
      amount: "1500000",
      symbol: "USDC",
      chainName: "Base",
    },
    destination: {
      chainId: "interwoven-1",
      denom: "uusdc",
      recipient: "init1recipient",
      symbol: "USDC",
      chainName: "Initia",
    },
    depositAddress: DEPOSIT_ADDRESS,
    cursor: "cursor-1",
    transaction: {
      chainId: "8453",
      to: "0x2222222222222222222222222222222222222222",
      data: "0xdeadbeef",
      value: "0",
    },
    ...overrides,
  }
}

function store(storage: StorageLike, session: DepositSession) {
  storage.setItem(depositSessionStorageKey(session.id), JSON.stringify(session))
}

describe("depositSessionStorageKey", () => {
  it("prefixes the id with the deposit session namespace", () => {
    expect(depositSessionStorageKey("abc")).toBe(`${LocalStorageKey.DEPOSIT_SESSION_PREFIX}abc`)
  })
})

describe("createDepositSession", () => {
  it("starts prepared with a generated id and matching timestamps", () => {
    const { apiUrl, transport, source, destination, depositAddress, cursor, transaction } =
      buildSession()
    const { version, id, createdAt, updatedAt, phase } = createDepositSession({
      apiUrl,
      transport,
      source,
      destination,
      depositAddress,
      cursor,
      transaction,
    })
    expect(version).toBe(1)
    expect(id).not.toBe("session-1")
    expect(id.length).toBeGreaterThan(0)
    expect(phase).toBe("prepared")
    expect(createdAt).toBe(updatedAt)
  })
})

describe("parseDepositSession", () => {
  it("round-trips a valid record", () => {
    const session = buildSession()
    expect(parseDepositSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
  })

  it("drops fields it does not know about", () => {
    const parsed = parseDepositSession({ ...buildSession(), rogueField: "x" })
    expect(parsed).not.toHaveProperty("rogueField")
  })

  it("rejects a record from another schema version", () => {
    expect(parseDepositSession({ ...buildSession(), version: 2 })).toBeNull()
  })

  it("rejects an unknown phase", () => {
    expect(parseDepositSession({ ...buildSession(), phase: "halfway" })).toBeNull()
  })

  it("rejects a record without the intended transaction", () => {
    const session: Partial<DepositSession> = buildSession()
    delete session.transaction
    expect(parseDepositSession(session)).toBeNull()
  })

  it("rejects a submitted hash without a sender", () => {
    expect(parseDepositSession({ ...buildSession(), submitted: { hash: "0xabc" } })).toBeNull()
  })

  it("rejects non-objects", () => {
    expect(parseDepositSession(null)).toBeNull()
    expect(parseDepositSession("{}")).toBeNull()
    expect(parseDepositSession([buildSession()])).toBeNull()
  })
})

describe("isPhaseAdvance", () => {
  it("allows forward moves and same-phase field updates", () => {
    expect(isPhaseAdvance("prepared", "send_prompt")).toBe(true)
    expect(isPhaseAdvance("source_sent", "source_sent")).toBe(true)
  })

  it("refuses to walk a submission backwards", () => {
    expect(isPhaseAdvance("source_sent", "prepared")).toBe(false)
    expect(isPhaseAdvance("submission_unknown", "send_prompt")).toBe(false)
  })
})

describe("mergeDepositSession", () => {
  it("returns the incoming session when nothing is stored", () => {
    const session = buildSession()
    expect(mergeDepositSession(null, session)).toEqual(session)
  })

  it("keeps the newer phase when an older writer arrives late", () => {
    const current = buildSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const stale = buildSession({ phase: "prepared" })
    expect(mergeDepositSession(current, stale).phase).toBe("source_sent")
  })

  it("never erases a recorded hash by omission", () => {
    const current = buildSession({
      phase: "source_sent",
      currentSourceHash: "0xaaa",
      submitted: { hash: "0xaaa", nonce: 7, from: SENDER },
    })
    const statusUpdate = buildSession({ phase: "source_sent", lastState: "bridge_pending" })
    const merged = mergeDepositSession(current, statusUpdate)
    expect(merged.currentSourceHash).toBe("0xaaa")
    expect(merged.submitted).toEqual({ hash: "0xaaa", nonce: 7, from: SENDER })
    expect(merged.lastState).toBe("bridge_pending")
  })

  it("adopts a replacement hash", () => {
    const current = buildSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const replaced = buildSession({ phase: "source_sent", currentSourceHash: "0xbbb" })
    expect(mergeDepositSession(current, replaced).currentSourceHash).toBe("0xbbb")
  })

  it("preserves the original creation time and takes the latest update time", () => {
    const current = buildSession({ createdAt: 1_000, updatedAt: 5_000 })
    const next = buildSession({ createdAt: 9_999, updatedAt: 2_000 })
    const merged = mergeDepositSession(current, next)
    expect(merged.createdAt).toBe(1_000)
    expect(merged.updatedAt).toBe(5_000)
  })

  it("refuses to merge two different intents under one id", () => {
    const current = buildSession()
    const other = buildSession({
      destination: { ...buildSession().destination, recipient: "init1someone-else" },
    })
    expect(() => mergeDepositSession(current, other)).toThrow(DepositSessionWriteError)
  })
})

describe("writeDepositSession", () => {
  it("merges into the stored record and returns what was persisted", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ phase: "source_sent", currentSourceHash: "0xaaa" }))

    const saved = writeDepositSession(
      storage,
      buildSession({ phase: "prepared", updatedAt: 2_000, lastState: "bridge_pending" }),
    )

    expect(saved.phase).toBe("source_sent")
    expect(saved.currentSourceHash).toBe("0xaaa")
    expect(readDepositSession(storage, "session-1")).toEqual(saved)
  })

  it("throws when the write is silently dropped", () => {
    const storage = createMemoryStorage()
    storage.setItem = () => {}
    expect(() => writeDepositSession(storage, buildSession())).toThrow(DepositSessionWriteError)
  })

  it("throws when storage rejects the write", () => {
    const storage = createMemoryStorage()
    storage.setItem = () => {
      throw new Error("QuotaExceededError")
    }
    expect(() => writeDepositSession(storage, buildSession())).toThrow(DepositSessionWriteError)
  })
})

describe("rollbackDepositSessionPrompt", () => {
  it("reopens the form after a rejected prompt", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ phase: "send_prompt" }))
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe("prepared")
  })

  it("refuses once a hash exists", () => {
    const storage = createMemoryStorage()
    store(
      storage,
      buildSession({ phase: "send_prompt", submitted: { hash: "0xaaa", from: SENDER } }),
    )
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe("send_prompt")
  })

  it("leaves a sent transfer alone", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ phase: "source_sent" }))
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe("source_sent")
  })
})

describe("listDepositSessions", () => {
  it("returns only this environment's sessions, newest first", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ id: "a", updatedAt: 1_000 }))
    store(storage, buildSession({ id: "b", updatedAt: 3_000 }))
    store(storage, buildSession({ id: "c", apiUrl: "https://deposit.example" }))
    storage.setItem("unrelated:key", "{}")

    expect(
      listDepositSessions(storage, "https://deposit.staging.example").map(({ id }) => id),
    ).toEqual(["b", "a"])
  })

  it("skips malformed records instead of failing the list", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ id: "a" }))
    storage.setItem(depositSessionStorageKey("broken"), "{not json")
    expect(listDepositSessions(storage, "https://deposit.staging.example")).toHaveLength(1)
  })
})

describe("pruneDepositSessions", () => {
  const now = 100 * 24 * 60 * 60 * 1000
  const ancient = now - 31 * 24 * 60 * 60 * 1000

  it("never removes a session that is still in flight", () => {
    const storage = createMemoryStorage()
    store(storage, buildSession({ id: "live", phase: "source_sent", updatedAt: ancient }))
    pruneDepositSessions(storage, now)
    expect(readDepositSession(storage, "live")).not.toBeNull()
  })

  it("removes terminal sessions older than 30 days", () => {
    const storage = createMemoryStorage()
    for (let index = 0; index < 25; index++) {
      store(storage, buildSession({ id: `old-${index}`, phase: "terminal", updatedAt: ancient }))
    }
    pruneDepositSessions(storage, now)
    expect(listDepositSessions(storage, "https://deposit.staging.example")).toHaveLength(20)
  })

  it("keeps the newest 20 terminal records regardless of age", () => {
    const storage = createMemoryStorage()
    for (let index = 0; index < 20; index++) {
      store(storage, buildSession({ id: `old-${index}`, phase: "terminal", updatedAt: ancient }))
    }
    pruneDepositSessions(storage, now)
    expect(listDepositSessions(storage, "https://deposit.staging.example")).toHaveLength(20)
  })
})

describe("recoveryReference", () => {
  it("carries the facts support needs to resolve a transfer", () => {
    const reference = recoveryReference(
      buildSession({ phase: "source_sent", currentSourceHash: "0xaaa" }),
    )
    expect(reference).toContain("https://deposit.staging.example")
    expect(reference).toContain("0xaaa")
    expect(reference).toContain(DEPOSIT_ADDRESS)
    expect(reference).toContain("init1recipient")
  })

  it("says the hash is unknown rather than omitting the line", () => {
    expect(recoveryReference(buildSession())).toContain("Source transaction: unknown")
  })
})

interface FakeLocks {
  held: Set<string>
  request: (
    name: string,
    options: unknown,
    callback: (lock: unknown) => unknown,
  ) => Promise<unknown>
}

function createFakeLocks(): FakeLocks {
  const held = new Set<string>()
  return {
    held,
    request: async (name, _options, callback) => {
      if (held.has(name)) return callback(null)
      held.add(name)
      try {
        return await callback({ name, mode: "exclusive" })
      } finally {
        held.delete(name)
      }
    },
  }
}

describe("holdDepositSessionLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps the lock until release is called", async () => {
    const locks = createFakeLocks()
    vi.stubGlobal("navigator", { locks })

    const lease = await holdDepositSessionLock("session-1")
    expect(locks.held.has(depositSessionStorageKey("session-1"))).toBe(true)

    await expect(holdDepositSessionLock("session-1")).rejects.toThrow(DepositSessionLockError)

    lease.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(locks.held.has(depositSessionStorageKey("session-1"))).toBe(false)
  })

  it("fails closed when Web Locks is unavailable", async () => {
    vi.stubGlobal("navigator", {})
    await expect(holdDepositSessionLock("session-1")).rejects.toThrow(DepositSessionLockError)
  })
})
