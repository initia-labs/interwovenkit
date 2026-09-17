import { LocalStorageKey } from "@/data/constants"
import type { DepositSession, DepositSessionPhase, StorageLike } from "./depositSession"
import {
  createDepositSession,
  depositSessionStorageKey,
  DepositSessionWriteError,
  findInFlightSession,
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
import {
  API_URL,
  buildDepositSession,
  createMemoryStorage,
  DEPOSIT_ADDRESS,
  SENDER,
} from "./testing"

/** Seeds a record the way an earlier tab left it: straight to storage, bypassing the merge. */
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
      buildDepositSession()
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
    const session = buildDepositSession({ lastState: "bridge_pending" })
    expect(parseDepositSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
  })

  it("drops fields it does not know about", () => {
    const parsed = parseDepositSession({ ...buildDepositSession(), rogueField: "x" })
    expect(parsed).not.toHaveProperty("rogueField")
  })

  it("drops a lastState it cannot render rather than rejecting a live record", () => {
    const parsed = parseDepositSession({ ...buildDepositSession(), lastState: "moon_phase" })
    expect(parsed).not.toBeNull()
    expect(parsed?.lastState).toBeUndefined()
  })

  it("rejects a record from another schema version", () => {
    expect(parseDepositSession({ ...buildDepositSession(), version: 2 })).toBeNull()
  })

  it("rejects an unknown phase", () => {
    expect(parseDepositSession({ ...buildDepositSession(), phase: "halfway" })).toBeNull()
  })

  it("rejects a record without the intended transaction", () => {
    const session: Partial<DepositSession> = buildDepositSession()
    delete session.transaction
    expect(parseDepositSession(session)).toBeNull()
  })

  it("rejects a submitted hash without a sender", () => {
    expect(
      parseDepositSession({ ...buildDepositSession(), submitted: { hash: "0xabc" } }),
    ).toBeNull()
  })

  it("rejects non-objects", () => {
    expect(parseDepositSession(null)).toBeNull()
    expect(parseDepositSession("{}")).toBeNull()
    expect(parseDepositSession([buildDepositSession()])).toBeNull()
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
    const session = buildDepositSession()
    expect(mergeDepositSession(null, session)).toEqual(session)
  })

  it("keeps the newer phase when an older writer arrives late", () => {
    const current = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const stale = buildDepositSession({ phase: "prepared" })
    expect(mergeDepositSession(current, stale).phase).toBe("source_sent")
  })

  it("never erases a recorded hash by omission", () => {
    const current = buildDepositSession({
      phase: "source_sent",
      currentSourceHash: "0xaaa",
      submitted: { hash: "0xaaa", nonce: 7, from: SENDER },
    })
    const statusUpdate = buildDepositSession({
      phase: "source_sent",
      lastState: "bridge_pending",
    })
    const merged = mergeDepositSession(current, statusUpdate)
    expect(merged.currentSourceHash).toBe("0xaaa")
    expect(merged.submitted).toEqual({ hash: "0xaaa", nonce: 7, from: SENDER })
    expect(merged.lastState).toBe("bridge_pending")
  })

  it("adopts a replacement hash", () => {
    const current = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const replaced = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xbbb" })
    expect(mergeDepositSession(current, replaced).currentSourceHash).toBe("0xbbb")
  })

  it("preserves the original creation time and takes the latest update time", () => {
    const current = buildDepositSession({ createdAt: 1_000, updatedAt: 5_000 })
    const next = buildDepositSession({ createdAt: 9_999, updatedAt: 2_000 })
    const merged = mergeDepositSession(current, next)
    expect(merged.createdAt).toBe(1_000)
    expect(merged.updatedAt).toBe(5_000)
  })

  it("refuses to merge two different intents under one id", () => {
    const current = buildDepositSession()
    const other = buildDepositSession({
      destination: { ...buildDepositSession().destination, recipient: "init1someone-else" },
    })
    expect(() => mergeDepositSession(current, other)).toThrow(DepositSessionWriteError)
  })
})

describe("writeDepositSession", () => {
  it("merges into the stored record and returns what was persisted", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" }))

    const saved = writeDepositSession(
      storage,
      buildDepositSession({ phase: "prepared", updatedAt: 2_000, lastState: "bridge_pending" }),
    )

    expect(saved.phase).toBe("source_sent")
    expect(saved.currentSourceHash).toBe("0xaaa")
    expect(readDepositSession(storage, "session-1")).toEqual(saved)
  })

  it("throws when the write is silently dropped", () => {
    const storage = createMemoryStorage()
    storage.setItem = () => {}
    expect(() => writeDepositSession(storage, buildDepositSession())).toThrow(
      DepositSessionWriteError,
    )
  })

  it("throws when storage rejects the write", () => {
    const storage = createMemoryStorage()
    storage.setItem = () => {
      throw new Error("QuotaExceededError")
    }
    expect(() => writeDepositSession(storage, buildDepositSession())).toThrow(
      DepositSessionWriteError,
    )
  })
})

describe("rollbackDepositSessionPrompt", () => {
  it("reopens the form after a rejected prompt", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ phase: "send_prompt" }))
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe("prepared")
  })

  it("refuses once a hash exists", () => {
    const storage = createMemoryStorage()
    store(
      storage,
      buildDepositSession({ phase: "send_prompt", submitted: { hash: "0xaaa", from: SENDER } }),
    )
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe("send_prompt")
  })

  // The send prompt is the only reversible phase: everything else either never prompted or
  // may already have reached the chain.
  it.each<DepositSessionPhase>(["prepared", "submission_unknown", "source_sent", "terminal"])(
    "leaves %s untouched",
    (phase) => {
      const storage = createMemoryStorage()
      store(storage, buildDepositSession({ phase }))
      expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe(phase)
    },
  )

  it("reports nothing to roll back when the record is gone", () => {
    expect(rollbackDepositSessionPrompt(createMemoryStorage(), "session-1")).toBeNull()
  })

  it("throws when the reverted record cannot be proven durable", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ phase: "send_prompt" }))
    storage.setItem = () => {}
    expect(() => rollbackDepositSessionPrompt(storage, "session-1")).toThrow(
      DepositSessionWriteError,
    )
  })
})

describe("listDepositSessions", () => {
  it("returns only this environment's sessions, newest first", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ id: "a", updatedAt: 1_000 }))
    store(storage, buildDepositSession({ id: "b", updatedAt: 3_000 }))
    store(storage, buildDepositSession({ id: "c", apiUrl: "https://deposit.example" }))
    storage.setItem("unrelated:key", "{}")

    expect(listDepositSessions(storage, API_URL).map(({ id }) => id)).toEqual(["b", "a"])
  })

  it("skips malformed records instead of failing the list", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ id: "a" }))
    storage.setItem(depositSessionStorageKey("broken"), "{not json")
    expect(listDepositSessions(storage, API_URL)).toHaveLength(1)
  })
})

describe("pruneDepositSessions", () => {
  const now = 100 * 24 * 60 * 60 * 1000
  const ancient = now - 31 * 24 * 60 * 60 * 1000

  it("never removes a session that is still in flight", () => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession({ id: "live", phase: "source_sent", updatedAt: ancient }))
    pruneDepositSessions(storage, now)
    expect(readDepositSession(storage, "live")).not.toBeNull()
  })

  it("drops a never-prompted record after a day and keeps a fresh one", () => {
    const storage = createMemoryStorage()
    const day = 24 * 60 * 60 * 1000
    store(
      storage,
      buildDepositSession({ id: "stale", phase: "prepared", updatedAt: now - day - 1 }),
    )
    store(
      storage,
      buildDepositSession({ id: "fresh", phase: "prepared", updatedAt: now - day + 1 }),
    )
    pruneDepositSessions(storage, now)
    expect(readDepositSession(storage, "stale")).toBeNull()
    expect(readDepositSession(storage, "fresh")).not.toBeNull()
  })

  it("keeps the newest 20 terminal records regardless of age and drops the rest", () => {
    const storage = createMemoryStorage()
    for (let index = 0; index < 25; index++) {
      store(
        storage,
        buildDepositSession({ id: `old-${index}`, phase: "terminal", updatedAt: ancient + index }),
      )
    }
    pruneDepositSessions(storage, now)
    const ids = listDepositSessions(storage, API_URL).map(({ id }) => id)
    expect(ids).toHaveLength(20)
    expect(ids).toContain("old-24")
    expect(ids).not.toContain("old-0")
  })
})

describe("recoveryReference", () => {
  it("carries the facts support needs to resolve a transfer", () => {
    const reference = recoveryReference(
      buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" }),
    )
    expect(reference).toContain(API_URL)
    expect(reference).toContain("0xaaa")
    expect(reference).toContain(DEPOSIT_ADDRESS)
    expect(reference).toContain("init1recipient")
  })

  it("says the hash is unknown rather than omitting the line", () => {
    expect(recoveryReference(buildDepositSession())).toContain("Source transaction: unknown")
  })
})

describe("findInFlightSession", () => {
  const intent = (session: ReturnType<typeof buildDepositSession>) => ({
    apiUrl: session.apiUrl,
    transport: session.transport,
    source: session.source,
    destination: session.destination,
  })

  it("returns the record for the same transfer whose prompt is open or whose send is ambiguous", () => {
    const prompted = buildDepositSession({ id: "prompted", phase: "send_prompt" })
    const ambiguous = buildDepositSession({ id: "ambiguous", phase: "submission_unknown" })
    const sent = buildDepositSession({ id: "sent", phase: "source_sent" })
    const settled = buildDepositSession({ id: "settled", phase: "terminal" })
    const fresh = buildDepositSession({ id: "fresh", phase: "prepared" })
    expect(findInFlightSession([settled, fresh, prompted], intent(prompted))?.id).toBe("prompted")
    expect(findInFlightSession([ambiguous], intent(ambiguous))?.id).toBe("ambiguous")
    // A known hash is a distinct, tracked transfer: a new deposit for the same pair is fine.
    expect(findInFlightSession([sent, settled, fresh], intent(sent))).toBeUndefined()
  })

  it("ignores a record for a different transfer", () => {
    const sent = buildDepositSession({ id: "sent", phase: "source_sent" })
    const other = { ...intent(sent), destination: { ...sent.destination, recipient: "init1other" } }
    expect(findInFlightSession([sent], other)).toBeUndefined()
  })
})
