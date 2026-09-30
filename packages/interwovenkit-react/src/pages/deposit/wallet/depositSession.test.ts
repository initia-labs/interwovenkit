import { omit } from "ramda"
import { DEPOSIT_ADDRESS, RECIPIENT } from "../data/testing"
import type {
  DepositLastState,
  DepositSession,
  DepositSessionPhase,
  StorageLike,
} from "./depositSession"
import {
  acquireDepositPromptReservation,
  DepositInFlightError,
  depositSessionStorageKey,
  depositSessionStore,
  DepositSessionWriteError,
  findInFlightSession,
  isPhaseAdvance,
  listDepositSessions,
  mergeDepositSession,
  parseDepositSession,
  pruneDepositSessions,
  readDepositSession,
  recoveryReference,
  reserveDepositPrompt,
  reuseOrCreateDepositSession,
  rollbackDepositSessionPrompt,
  writeDepositSession,
} from "./depositSession"
import { API_URL, buildDepositSession, createMemoryStorage } from "./testing"

/** Seeds a record the way an earlier tab left it: straight to storage, bypassing the merge. */
function store(storage: StorageLike, session: DepositSession) {
  storage.setItem(depositSessionStorageKey(session.id), JSON.stringify(session))
}

function createLockRequest() {
  interface PendingLock {
    callback: () => Promise<unknown> | unknown
    reject: (error: unknown) => void
    resolve: (value: unknown) => void
    signal?: AbortSignal
  }
  let held = false
  const queue: PendingLock[] = []
  const pump = () => {
    if (held) return
    const pending = queue.shift()
    if (!pending) return
    if (pending.signal?.aborted) {
      pending.reject(pending.signal.reason)
      pump()
      return
    }
    held = true
    Promise.resolve(pending.callback())
      .then(pending.resolve, pending.reject)
      .finally(() => {
        held = false
        pump()
      })
  }
  return vi.fn(
    (
      _name: string,
      optionsOrCallback: { signal?: AbortSignal } | (() => Promise<unknown> | unknown),
      callback?: () => Promise<unknown> | unknown,
    ) => {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback
      const run = typeof optionsOrCallback === "function" ? optionsOrCallback : callback!
      return new Promise<unknown>((resolve, reject) => {
        const pending = { callback: run, reject, resolve, signal: options.signal }
        const abort = () => {
          const index = queue.indexOf(pending)
          if (index < 0) return
          queue.splice(index, 1)
          reject(options.signal?.reason)
        }
        options.signal?.addEventListener("abort", abort, { once: true })
        queue.push(pending)
        pump()
      })
    },
  )
}

describe("parseDepositSession", () => {
  const base = buildDepositSession()
  const full: Required<DepositSession> = {
    ...base,
    phase: "source_sent",
    source: {
      ...base.source,
      chainLogoUrl: "https://example.com/base.svg",
      assetLogoUrl: "https://example.com/usdc.svg",
    },
    destination: {
      ...base.destination,
      decimals: 6,
      chainLogoUrl: "https://example.com/initia.svg",
      assetLogoUrl: "https://example.com/iusd.svg",
    },
    transaction: { ...base.transaction, gasLimit: "65000" },
    predictedDelivery: "advance",
    preSubmitBlock: 100,
    promptedAt: 5_000,
    promptNonce: 0,
    promptPendingNonce: 1,
    promptSeenAt: 6_000,
    sourceNonce: 0,
    currentSourceHash: "0xbbb",
    originalSourceHash: "0xaaa",
    depositId: "deposit-1",
    received: { amount: "1490000", decimals: 6 },
    deliveryExplorerUrl: "https://explorer.example/tx/0xdelivery",
    lastState: "bridge_pending",
  }

  it("round-trips every field of a stored record", () => {
    expect(parseDepositSession(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })

  it("drops unknown fields and an unrenderable lastState without rejecting a live record", () => {
    expect(parseDepositSession({ ...full, rogueField: "x", lastState: "moon_phase" })).toEqual(
      omit(["lastState"], full),
    )
  })

  it.each([
    ["a negative prompt nonce", { ...full, promptNonce: -1 }],
    ["a fractional prompt nonce", { ...full, promptNonce: 1.5 }],
    ["a string prompt nonce", { ...full, promptNonce: "7" }],
    ["a null prompt nonce", { ...full, promptNonce: null }],
    ["a string pending prompt nonce", { ...full, promptPendingNonce: "8" }],
    ["a malformed predicted delivery", { ...full, predictedDelivery: 1 }],
    ["a fractional received amount", { ...full, received: { amount: "1.5", decimals: 6 } }],
    ["a malformed received record", { ...full, received: "1490000" }],
    ["negative received decimals", { ...full, received: { amount: "1490000", decimals: -1 } }],
    ["another schema version", { ...full, version: 2 }],
    ["an unknown phase", { ...full, phase: "halfway" }],
    ["no intended transaction", omit(["transaction"], full)],
    ["a negative source nonce", { ...full, sourceNonce: -1 }],
    ["null", null],
    ["a string", "{}"],
    ["an array", [full]],
  ])("rejects %s", (_, raw) => {
    expect(parseDepositSession(raw)).toBeNull()
  })
})

describe("isPhaseAdvance", () => {
  it.each<[DepositSessionPhase, DepositSessionPhase, boolean]>([
    ["source_sent", "source_sent", true],
    ["submission_unknown", "source_sent", true],
    ["submission_unknown", "send_prompt", false],
    ["source_sent", "submission_unknown", false],
  ])("%s -> %s: %s", (from, to, expected) => {
    expect(isPhaseAdvance(from, to)).toBe(expected)
  })
})

describe("mergeDepositSession", () => {
  it("never lets a late not-sent verdict hide a session that already has a hash", () => {
    const sent = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const released = buildDepositSession({ phase: "terminal", lastState: "not_sent" })
    expect(mergeDepositSession(sent, released)).toMatchObject({
      phase: "source_sent",
      currentSourceHash: "0xaaa",
    })
    expect(mergeDepositSession(sent, released).lastState).toBeUndefined()
  })

  it("keeps a replacement hash against a stale writer's original hash", () => {
    const replaced = buildDepositSession({
      phase: "source_sent",
      originalSourceHash: "0xaaa",
      currentSourceHash: "0xbbb",
    })
    const stale = buildDepositSession({
      phase: "source_sent",
      originalSourceHash: "0xaaa",
      currentSourceHash: "0xaaa",
    })
    expect(mergeDepositSession(replaced, stale).currentSourceHash).toBe("0xbbb")
    expect(mergeDepositSession(stale, replaced).currentSourceHash).toBe("0xbbb")
  })

  it("reopens a not-sent verdict when a hash arrives after it", () => {
    const released = buildDepositSession({ phase: "terminal", lastState: "not_sent" })
    const sent = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const merged = mergeDepositSession(released, sent)
    expect(merged).toMatchObject({ phase: "source_sent", currentSourceHash: "0xaaa" })
    expect(merged.lastState).toBeUndefined()
  })

  it.each<[string, Partial<DepositSession>, Partial<DepositSession>]>([
    [
      "a failed deposit",
      { phase: "terminal", lastState: "failed", currentSourceHash: "0xaaa" },
      { phase: "source_sent", currentSourceHash: "0xbbb" },
    ],
    [
      "a completed deposit",
      { phase: "terminal", lastState: "completed", currentSourceHash: "0xaaa" },
      { phase: "source_sent", currentSourceHash: "0xbbb" },
    ],
    [
      "a not-sent verdict that already had a hash",
      { phase: "terminal", lastState: "not_sent", currentSourceHash: "0xaaa" },
      { phase: "source_sent", currentSourceHash: "0xbbb" },
    ],
    [
      "a completed deposit against a stale tracker's state",
      { phase: "terminal", lastState: "completed", currentSourceHash: "0xaaa" },
      { phase: "source_sent", lastState: "bridge_pending" },
    ],
    [
      "a not-sent verdict against a stale writer without a hash",
      { phase: "terminal", lastState: "not_sent" },
      { phase: "source_sent" },
    ],
  ])("keeps %s terminal", (_, current, next) => {
    const merged = mergeDepositSession(buildDepositSession(current), buildDepositSession(next))
    expect(merged).toMatchObject({ phase: "terminal", lastState: current.lastState })
  })

  it.each<[DepositSessionPhase, DepositSessionPhase]>([
    ["source_sent", "prepared"],
    ["terminal", "source_sent"],
  ])("keeps %s when a writer still at %s arrives late", (phase, stale) => {
    const current = buildDepositSession({ phase, currentSourceHash: "0xaaa" })
    expect(mergeDepositSession(current, buildDepositSession({ phase: stale })).phase).toBe(phase)
  })

  it("keeps the latest prompt heartbeat", () => {
    const current = buildDepositSession({ phase: "send_prompt", promptSeenAt: 2000 })
    const stale = buildDepositSession({ phase: "send_prompt", promptSeenAt: 1000 })
    expect(mergeDepositSession(current, stale).promptSeenAt).toBe(2000)
  })

  it("never erases recorded evidence by omission", () => {
    const current = buildDepositSession({
      phase: "source_sent",
      currentSourceHash: "0xaaa",
      sourceNonce: 7,
      promptNonce: 7,
      promptPendingNonce: 8,
    })
    const statusUpdate = buildDepositSession({
      phase: "source_sent",
      lastState: "bridge_pending",
      sourceNonce: undefined,
      promptPendingNonce: undefined,
    })
    expect(mergeDepositSession(current, statusUpdate)).toMatchObject({
      currentSourceHash: "0xaaa",
      promptNonce: 7,
      promptPendingNonce: 8,
      sourceNonce: 7,
      lastState: "bridge_pending",
    })
  })

  it("keeps a later in-flight stage when a reload reads an earlier one", () => {
    const bridged = buildDepositSession({ phase: "source_sent", lastState: "deposit_pending" })
    const reread = buildDepositSession({ phase: "source_sent", lastState: "source_pending" })
    expect(mergeDepositSession(bridged, reread).lastState).toBe("deposit_pending")
    const conflict = buildDepositSession({ phase: "source_sent", lastState: "tracking_conflict" })
    expect(mergeDepositSession(bridged, conflict).lastState).toBe("tracking_conflict")
  })

  it("keeps a proven problem when a reload reads an earlier stage, and lets later progress through", () => {
    const merge = (current: DepositLastState, next: DepositLastState) =>
      mergeDepositSession(
        buildDepositSession({ phase: "source_sent", lastState: current }),
        buildDepositSession({ phase: "source_sent", lastState: next }),
      ).lastState
    expect(merge("source_conflict", "source_pending")).toBe("source_conflict")
    expect(merge("bridge_refunding", "source_pending")).toBe("bridge_refunding")
    expect(merge("bridge_partial", "bridge_pending")).toBe("bridge_partial")
    expect(merge("bridge_partial", "processing")).toBe("processing")
    expect(merge("bridge_refunding", "bridge_refund_required")).toBe("bridge_refund_required")
  })

  it("holds a tracking conflict against in-flight reads, never over a proven problem", () => {
    const merge = (current: DepositLastState, next: DepositLastState) =>
      mergeDepositSession(
        buildDepositSession({ phase: "source_sent", lastState: current }),
        buildDepositSession({ phase: "source_sent", lastState: next }),
      ).lastState
    expect(merge("tracking_conflict", "processing")).toBe("tracking_conflict")
    expect(merge("processing", "tracking_conflict")).toBe("tracking_conflict")
    expect(merge("bridge_partial", "tracking_conflict")).toBe("bridge_partial")
    expect(merge("bridge_refund_required", "unknown")).toBe("bridge_refund_required")
    expect(merge("tracking_conflict", "unknown")).toBe("tracking_conflict")
    expect(merge("processing", "unknown")).toBe("unknown")
  })

  it("adopts a replacement hash", () => {
    const current = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xaaa" })
    const replaced = buildDepositSession({ phase: "source_sent", currentSourceHash: "0xbbb" })
    expect(mergeDepositSession(current, replaced).currentSourceHash).toBe("0xbbb")
  })

  it("preserves the original creation time and takes the latest update time", () => {
    const current = buildDepositSession({ createdAt: 1_000, updatedAt: 5_000 })
    const next = buildDepositSession({ createdAt: 9_999, updatedAt: 2_000 })
    expect(mergeDepositSession(current, next)).toMatchObject({ createdAt: 1_000, updatedAt: 5_000 })
  })

  it("refuses to merge two different intents under one id", () => {
    const current = buildDepositSession()
    const other = buildDepositSession({
      destination: { ...current.destination, recipient: "init1someone-else" },
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

    expect(saved).toMatchObject({
      phase: "source_sent",
      currentSourceHash: "0xaaa",
      lastState: "bridge_pending",
    })
    expect(readDepositSession(storage, "session-1")).toEqual(saved)
  })

  it.each<[string, (storage: StorageLike) => StorageLike["setItem"]]>([
    [
      "storage rejects the write",
      () => () => {
        throw new Error("QuotaExceededError")
      },
    ],
    ["the write is silently dropped", () => () => {}],
    [
      "another writer changes the record before read-back",
      (storage) => {
        const setItem = storage.setItem
        return (key, value) =>
          setItem(key, JSON.stringify({ ...JSON.parse(value), depositId: "d2" }))
      },
    ],
  ])("throws when %s", (_, override) => {
    const storage = createMemoryStorage()
    storage.setItem = override(storage)
    expect(() => writeDepositSession(storage, buildDepositSession())).toThrow(
      DepositSessionWriteError,
    )
  })
})

describe("rollbackDepositSessionPrompt", () => {
  it("reopens the form after a rejected prompt and forgets that prompt's evidence", () => {
    const storage = createMemoryStorage()
    const prompt = { promptedAt: 5_000, promptNonce: 7, promptPendingNonce: 8 }
    store(storage, buildDepositSession({ phase: "send_prompt", ...prompt }))
    const reverted = rollbackDepositSessionPrompt(storage, "session-1")
    expect(reverted?.phase).toBe("prepared")
    for (const key of Object.keys(prompt)) expect(reverted).not.toHaveProperty(key)
  })

  it.each<[string, Partial<DepositSession>]>([
    ["a prompt that already returned a hash", { phase: "send_prompt", currentSourceHash: "0xaaa" }],
    ["an ambiguous send", { phase: "submission_unknown" }],
  ])("leaves %s untouched", (_, overrides) => {
    const storage = createMemoryStorage()
    store(storage, buildDepositSession(overrides))
    expect(rollbackDepositSessionPrompt(storage, "session-1")?.phase).toBe(overrides.phase)
  })

  it("never rolls back a prompt whose hash this tab could only keep in memory", () => {
    const storage = createMemoryStorage()
    vi.stubGlobal("localStorage", storage)
    const prompted = buildDepositSession({ phase: "send_prompt" })
    store(storage, prompted)
    const setItem = storage.setItem
    storage.setItem = () => {
      throw new Error("QuotaExceededError")
    }
    const sent = { ...prompted, phase: "source_sent" as const, currentSourceHash: "0xaaa" }
    depositSessionStore.write(sent)
    try {
      expect(depositSessionStore.isVolatile(prompted.id)).toBe(true)
      expect(rollbackDepositSessionPrompt(storage, prompted.id)).toMatchObject({
        phase: "source_sent",
        currentSourceHash: "0xaaa",
      })
      expect(depositSessionStore.isVolatile(prompted.id)).toBe(true)
    } finally {
      storage.setItem = setItem
      depositSessionStore.write(sent)
      vi.unstubAllGlobals()
    }
  })

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
  const day = 24 * 60 * 60 * 1000
  const now = 100 * day

  it("never removes an ambiguous send, however old", () => {
    const storage = createMemoryStorage()
    store(
      storage,
      buildDepositSession({ id: "live", phase: "submission_unknown", updatedAt: now - 31 * day }),
    )
    pruneDepositSessions(storage, now)
    expect(readDepositSession(storage, "live")).not.toBeNull()
  })

  it("drops a never-prompted record after a day and keeps a fresh one", () => {
    const storage = createMemoryStorage()
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

  it.each([
    ["older than 30 days", now - 31 * day, 20],
    ["within 30 days", now - 29 * day, 25],
  ])("drops terminal records beyond the newest 20 only when also %s", (_, updatedAt, kept) => {
    const storage = createMemoryStorage()
    for (let index = 0; index < 25; index++) {
      store(
        storage,
        buildDepositSession({ id: `t-${index}`, phase: "terminal", updatedAt: updatedAt + index }),
      )
    }
    pruneDepositSessions(storage, now)
    expect(listDepositSessions(storage, API_URL).map(({ id }) => id)).toEqual(
      Array.from({ length: kept }, (_, index) => `t-${24 - index}`),
    )
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
    expect(reference).toContain(RECIPIENT)
  })

  it("says the hash is unknown rather than omitting the line", () => {
    expect(recoveryReference(buildDepositSession())).toContain("Source transaction: unknown")
  })
})

describe("findInFlightSession", () => {
  const intent = (session: DepositSession) => ({
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
    expect(findInFlightSession([sent, settled, fresh], intent(sent))).toBeUndefined()
  })

  it("ignores a record for a different transfer", () => {
    const prompted = buildDepositSession({ phase: "send_prompt" })
    const other = {
      ...intent(prompted),
      destination: { ...prompted.destination, recipient: "init1other" },
    }
    expect(findInFlightSession([prompted], other)).toBeUndefined()
  })
})

describe("reuseOrCreateDepositSession", () => {
  const draft = omit(["version", "id", "createdAt", "updatedAt", "phase"], buildDepositSession())

  it("reuses this form's never-prompted record for the same transfer", () => {
    const stored = buildDepositSession({ phase: "prepared" })
    expect(reuseOrCreateDepositSession(stored, draft)).toBe(stored)
  })

  it.each([
    [
      "a record that reached an ambiguous send",
      buildDepositSession({ phase: "submission_unknown" }),
      draft,
    ],
    [
      "a different transfer",
      buildDepositSession(),
      { ...draft, destination: { ...draft.destination, recipient: "init1other" } },
    ],
    ["no stored record", null, draft],
  ])("starts a new prepared record over %s", (_, stored, next) => {
    const created = reuseOrCreateDepositSession(stored, next)
    expect(created.id).not.toBe("session-1")
    expect(created.phase).toBe("prepared")
  })
})

describe("reserveDepositPrompt", () => {
  let storage: StorageLike
  beforeEach(() => {
    storage = createMemoryStorage()
    vi.stubGlobal("localStorage", storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("records the prompt when nothing for the same transfer is in flight", async () => {
    const session = buildDepositSession({ phase: "send_prompt" })
    await expect(reserveDepositPrompt(session)).resolves.toMatchObject({ phase: "send_prompt" })
    expect(readDepositSession(storage, session.id)?.phase).toBe("send_prompt")
  })

  it.each<DepositSessionPhase>(["send_prompt", "submission_unknown"])(
    "refuses a second prompt while another mount or tab holds the same transfer in %s",
    async (phase) => {
      store(storage, buildDepositSession({ id: "other-tab", phase }))
      const session = buildDepositSession({ phase: "send_prompt" })
      await expect(reserveDepositPrompt(session)).rejects.toBeInstanceOf(DepositInFlightError)
      expect(readDepositSession(storage, session.id)).toBeNull()
    },
  )

  it("checks and records under the cross-tab lock", async () => {
    const request = vi.fn((_name: string, reserve: () => unknown) => Promise.resolve(reserve()))
    vi.stubGlobal("navigator", { locks: { request } })
    await reserveDepositPrompt(buildDepositSession({ phase: "send_prompt" }))
    expect(request).toHaveBeenCalledWith("interwovenkit:deposit-prompt", expect.any(Function))
  })

  it("lets a prepared click reserve synchronously only once", async () => {
    const controller = new AbortController()
    const reservation = await acquireDepositPromptReservation(controller.signal)
    const session = buildDepositSession({ phase: "send_prompt" })
    expect(reservation.reserve(session).phase).toBe("send_prompt")
    expect(() => reservation.reserve(session)).toThrow(/Abort|aborted/i)
  })

  it("disables a prepared reservation when its owner aborts", async () => {
    const controller = new AbortController()
    const reservation = await acquireDepositPromptReservation(controller.signal)
    controller.abort()
    expect(() => reservation.reserve(buildDepositSession({ phase: "send_prompt" }))).toThrow(
      /Abort|aborted/i,
    )
  })

  it("holds the global lock until a prepared reservation is released", async () => {
    const request = createLockRequest()
    vi.stubGlobal("navigator", { locks: { request } })
    const first = await acquireDepositPromptReservation(new AbortController().signal)
    let acquired = false
    const secondPromise = acquireDepositPromptReservation(new AbortController().signal).then(
      (reservation) => {
        acquired = true
        return reservation
      },
    )
    await Promise.resolve()
    expect(acquired).toBe(false)
    first.release()
    const second = await secondPromise
    expect(acquired).toBe(true)
    second.release()
  })

  it("removes an aborted waiter without acquiring later", async () => {
    const request = createLockRequest()
    vi.stubGlobal("navigator", { locks: { request } })
    const first = await acquireDepositPromptReservation(new AbortController().signal)
    const waiting = new AbortController()
    const second = acquireDepositPromptReservation(waiting.signal)
    waiting.abort()
    await expect(second).rejects.toBe(waiting.signal.reason)
    first.release()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("releases a held reservation when its owner aborts", async () => {
    const request = createLockRequest()
    vi.stubGlobal("navigator", { locks: { request } })
    const owner = new AbortController()
    await acquireDepositPromptReservation(owner.signal)
    const next = acquireDepositPromptReservation(new AbortController().signal)
    owner.abort()
    const reservation = await next
    reservation.release()
  })

  it("releases the lock after reserve fails so legacy callers observe the durable prompt", async () => {
    const request = createLockRequest()
    vi.stubGlobal("navigator", { locks: { request } })
    const reservation = await acquireDepositPromptReservation(new AbortController().signal)
    const session = buildDepositSession({ phase: "send_prompt" })
    const legacy = reserveDepositPrompt(session)
    expect(reservation.reserve(session)).toMatchObject({ phase: "send_prompt" })
    await expect(legacy).rejects.toBeInstanceOf(DepositInFlightError)

    const next = await acquireDepositPromptReservation(new AbortController().signal)
    expect(() =>
      next.reserve(buildDepositSession({ id: "another", phase: "send_prompt" })),
    ).toThrow(DepositInFlightError)
    const afterFailure = await acquireDepositPromptReservation(new AbortController().signal)
    afterFailure.release()
  })
})
