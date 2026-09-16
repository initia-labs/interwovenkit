import { equals } from "ramda"
import { useMemo, useSyncExternalStore } from "react"
import { DAY_IN_MS, LocalStorageKey } from "@/data/constants"
import type { FieldSpec, ParsedFields } from "../data/parse"
import {
  isBoolean,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isString,
  optional,
  parseFields,
  required,
} from "../data/parse"

/**
 * The slice of `Storage` this module uses. Injected so the pure functions can
 * be exercised against an in-memory map, and so a caller can pass
 * `sessionStorage` or a stub when `localStorage` is unavailable (Safari private
 * mode throws on write, which these functions surface as a write failure rather
 * than a silent no-op).
 */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

export const DEPOSIT_SESSION_VERSION = 1

export type DepositSessionPhase =
  | "prepared"
  | "approval_prompt"
  | "approval_sent"
  | "send_prompt"
  | "submission_unknown"
  | "source_sent"
  | "deposit_indexed"
  | "terminal"

/**
 * Monotonic phase order. `submission_unknown` sits between `send_prompt` and
 * `source_sent` on purpose: a wallet call that never returned a hash is strictly
 * more advanced than "about to prompt" (funds may already be moving) and
 * strictly less than "we hold the hash". Ordering it this way makes the
 * monotonic guard refuse to walk an ambiguous submission back to a state the UI
 * would treat as safe to re-sign.
 */
export const DEPOSIT_SESSION_PHASES: readonly DepositSessionPhase[] = [
  "prepared",
  "approval_prompt",
  "approval_sent",
  "send_prompt",
  "submission_unknown",
  "source_sent",
  "deposit_indexed",
  "terminal",
]

export interface DepositSessionTransaction {
  chainId: string
  to: string
  data: string
  value: string
  gasLimit?: string
}

export interface DepositSession {
  version: typeof DEPOSIT_SESSION_VERSION
  id: string
  /** Deposit API base URL: the environment fingerprint. Records issued against staging must never resume against production. */
  apiUrl: string
  createdAt: number
  updatedAt: number
  transport: "direct" | "lifi"
  phase: DepositSessionPhase
  source: {
    chainId: string
    denom: string
    decimals: number
    sender: string
    amount: string
    symbol: string
    chainName: string
    /** Captured at form time so progress renders identity with no registry dependency. */
    chainLogoUrl?: string
  }
  destination: {
    chainId: string
    denom: string
    recipient: string
    symbol: string
    chainName: string
    chainLogoUrl?: string
  }
  depositAddress: string
  cursor: string
  bridge?: { tool: string; quoteId?: string; minReceived: string; amountOut: string }
  /** The exact intended call, saved before any wallet prompt. It is the only description of intent that survives a lost response. */
  transaction: DepositSessionTransaction
  approval?: { spender: string; amount: string; hash?: string; confirmed?: boolean }
  /** Source-pinned block captured before the prompt; the lower bound for ethers' replacement scan. Never proof that nothing was sent. */
  preSubmitBlock?: number
  /** Identity of the response the wallet actually returned. The wallet may pick a nonce other than any prefetched hint. */
  submitted?: { hash: string; nonce?: number; from: string }
  currentSourceHash?: string
  originalSourceHash?: string
  /** LI.FI only: the Ethereum receiving transaction, once the bridge reports it. */
  ethereumTxHash?: string
  depositId?: string
  lastState?: string
  failure?: { code: string; message: string }
}

/** Raised when a session write cannot be proven durable. Callers must block signing and show the recovery reference instead. */
export class DepositSessionWriteError extends Error {}

/** Raised when the per-session Web Lock cannot be taken. Fail closed: no wallet prompt without exclusion. */
export class DepositSessionLockError extends Error {}

/** `${LocalStorageKey.DEPOSIT_SESSION_PREFIX}${id}` — one record per session. */
export function depositSessionStorageKey(id: string): string {
  return `${LocalStorageKey.DEPOSIT_SESSION_PREFIX}${id}`
}

/** Strips keys whose value is `undefined` so a stored record and its parsed form compare equal (see writeDepositSession). */
function canonicalize(session: DepositSession): DepositSession {
  return JSON.parse(JSON.stringify(session)) as DepositSession
}

/**
 * Creates a `prepared` session. The id comes from `crypto.randomUUID`, which
 * needs a secure context (HTTPS or localhost) — the same requirement the Web
 * Locks helpers below carry, so the two fail together rather than leaving a
 * session that cannot be serialized against a prompt.
 */
export function createDepositSession(
  input: Omit<DepositSession, "version" | "id" | "createdAt" | "updatedAt" | "phase">,
): DepositSession {
  const now = Date.now()
  return canonicalize({
    ...input,
    version: DEPOSIT_SESSION_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    phase: "prepared",
  })
}

const isInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value)

const isBlockNumber = (value: unknown): value is number => isInteger(value) && value >= 0

const isTransport = (value: unknown): value is DepositSession["transport"] =>
  value === "direct" || value === "lifi"

const isPhase = (value: unknown): value is DepositSessionPhase =>
  DEPOSIT_SESSION_PHASES.includes(value as DepositSessionPhase)

// The stored record, field by field. Everything the resume path needs in order
// to describe the transfer is required; the fields written later in the
// lifecycle are optional, but a present one is never allowed to be malformed.
const SESSION_FIELDS = {
  id: required(isNonEmptyString),
  apiUrl: required(isNonEmptyString),
  createdAt: required(isFiniteNumber),
  updatedAt: required(isFiniteNumber),
  transport: required(isTransport),
  phase: required(isPhase),
  depositAddress: required(isNonEmptyString),
  cursor: required(isString),
  // The lower bound for the replacement scan: a fractional or negative block
  // would silently widen or invalidate it.
  preSubmitBlock: optional(isBlockNumber),
  currentSourceHash: optional(isNonEmptyString),
  originalSourceHash: optional(isNonEmptyString),
  ethereumTxHash: optional(isNonEmptyString),
  depositId: optional(isNonEmptyString),
  lastState: optional(isNonEmptyString),
}

const SOURCE_FIELDS = {
  chainId: required(isNonEmptyString),
  denom: required(isNonEmptyString),
  decimals: required(isFiniteNumber),
  sender: required(isNonEmptyString),
  amount: required(isNonEmptyString),
  symbol: required(isString),
  chainName: required(isString),
  chainLogoUrl: optional(isString),
}

const DESTINATION_FIELDS = {
  chainId: required(isNonEmptyString),
  denom: required(isNonEmptyString),
  recipient: required(isNonEmptyString),
  symbol: required(isString),
  chainName: required(isString),
  chainLogoUrl: optional(isString),
}

const TRANSACTION_FIELDS = {
  chainId: required(isNonEmptyString),
  to: required(isNonEmptyString),
  data: required(isNonEmptyString),
  value: required(isNonEmptyString),
  gasLimit: optional(isNonEmptyString),
}

const BRIDGE_FIELDS = {
  tool: required(isNonEmptyString),
  quoteId: optional(isNonEmptyString),
  minReceived: required(isNonEmptyString),
  amountOut: required(isNonEmptyString),
}

const APPROVAL_FIELDS = {
  spender: required(isNonEmptyString),
  amount: required(isNonEmptyString),
  hash: optional(isNonEmptyString),
  confirmed: optional(isBoolean),
}

const SUBMITTED_FIELDS = {
  hash: required(isNonEmptyString),
  nonce: optional(isInteger),
  from: required(isNonEmptyString),
}

const FAILURE_FIELDS = {
  code: required(isString),
  message: required(isString),
}

/** An absent sub-record is fine; a present but malformed one is null, which rejects the session. */
function optionalRecord<S extends FieldSpec>(
  value: unknown,
  spec: S,
): ParsedFields<S> | null | undefined {
  return value === undefined ? undefined : parseFields(value, spec)
}

/**
 * Boundary parser for a stored record, held to the same standard as
 * assertDepositAddress: this is the only description of an in-flight transfer
 * that survives a reload, so a half-readable record must not be resumed. Any
 * version drift, missing field or wrong type returns null (fail closed), and the
 * result carries only the spec'd fields, so a foreign key written by another
 * version cannot ride along into a later write.
 */
export function parseDepositSession(raw: unknown): DepositSession | null {
  if (!isRecord(raw) || raw.version !== DEPOSIT_SESSION_VERSION) return null

  const session = parseFields(raw, SESSION_FIELDS)
  const source = parseFields(raw.source, SOURCE_FIELDS)
  const destination = parseFields(raw.destination, DESTINATION_FIELDS)
  const transaction = parseFields(raw.transaction, TRANSACTION_FIELDS)
  if (!session || !source || !destination || !transaction) return null

  const bridge = optionalRecord(raw.bridge, BRIDGE_FIELDS)
  const approval = optionalRecord(raw.approval, APPROVAL_FIELDS)
  const submitted = optionalRecord(raw.submitted, SUBMITTED_FIELDS)
  const failure = optionalRecord(raw.failure, FAILURE_FIELDS)
  if (bridge === null || approval === null || submitted === null || failure === null) return null

  return canonicalize({
    version: DEPOSIT_SESSION_VERSION,
    ...session,
    source,
    destination,
    transaction,
    bridge,
    approval,
    submitted,
    failure,
  })
}

/** Whether `to` is at or after `from` in DEPOSIT_SESSION_PHASES. Equal phases are advances so a write can update fields without moving the phase. */
export function isPhaseAdvance(from: DepositSessionPhase, to: DepositSessionPhase): boolean {
  return DEPOSIT_SESSION_PHASES.indexOf(to) >= DEPOSIT_SESSION_PHASES.indexOf(from)
}

// Facts that identify *which transfer* this is. They are fixed once the record
// exists, so a disagreement means two different intents are colliding on one id
// — merging them would attach one transfer's hash to another's recipient.
// The amount, deposit address and transaction stay mutable: the form rewrites
// them while the session is still `prepared` and a refreshed quote lands.
function assertSameIntent(current: DepositSession, next: DepositSession): void {
  const mismatch = (
    [
      ["id", current.id, next.id],
      ["apiUrl", current.apiUrl, next.apiUrl],
      ["transport", current.transport, next.transport],
      ["source.chainId", current.source.chainId, next.source.chainId],
      ["source.denom", current.source.denom, next.source.denom],
      ["source.sender", current.source.sender, next.source.sender],
      ["destination.chainId", current.destination.chainId, next.destination.chainId],
      ["destination.denom", current.destination.denom, next.destination.denom],
      ["destination.recipient", current.destination.recipient, next.destination.recipient],
    ] as const
  ).find(([, a, b]) => a !== b)

  if (mismatch) {
    throw new DepositSessionWriteError(
      `Deposit session ${current.id} identity changed (${mismatch[0]}): ${String(mismatch[1])} vs ${String(mismatch[2])}`,
    )
  }
}

/**
 * Last-writer-wins on values, but never on the phase and never by omission.
 *
 * Two rules protect a transfer in flight: the phase only moves forward, so a
 * tab holding a stale snapshot cannot walk `source_sent` back to a state the
 * form treats as re-signable; and an optional field that `next` leaves
 * `undefined` keeps the stored value, so a short status update cannot erase a
 * recorded hash it did not know about. Replacing a hash with a *different*
 * hash is still allowed — that is exactly what a repriced transaction does.
 */
export function mergeDepositSession(
  current: DepositSession | null,
  next: DepositSession,
): DepositSession {
  if (!current) return canonicalize(next)
  assertSameIntent(current, next)

  return canonicalize({
    ...current,
    ...next,
    createdAt: current.createdAt,
    updatedAt: Math.max(current.updatedAt, next.updatedAt),
    phase: isPhaseAdvance(current.phase, next.phase) ? next.phase : current.phase,
    bridge: next.bridge ?? current.bridge,
    approval: next.approval ? { ...current.approval, ...next.approval } : current.approval,
    preSubmitBlock: next.preSubmitBlock ?? current.preSubmitBlock,
    submitted: next.submitted ? { ...current.submitted, ...next.submitted } : current.submitted,
    currentSourceHash: next.currentSourceHash ?? current.currentSourceHash,
    originalSourceHash: next.originalSourceHash ?? current.originalSourceHash,
    ethereumTxHash: next.ethereumTxHash ?? current.ethereumTxHash,
    depositId: next.depositId ?? current.depositId,
    lastState: next.lastState ?? current.lastState,
    failure: next.failure ?? current.failure,
  })
}

/** Reads and parses one session. Unreadable or malformed JSON is null, never a partial object. */
export function readDepositSession(storage: StorageLike, id: string): DepositSession | null {
  let raw: string | null
  try {
    raw = storage.getItem(depositSessionStorageKey(id))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return parseDepositSession(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Read → merge → write → read back. The read-back is the point: a quota error,
 * a private-mode stub that accepts writes and returns null, or a competing tab
 * clobbering the key all end with the caller believing a transfer is recorded
 * when it is not. Callers block signing on the throw, and after a send they
 * fall back to in-memory tracking plus `recoveryReference`.
 *
 * Hold the session's Web Lock around this call whenever the write precedes or
 * follows a wallet prompt.
 */
export function writeDepositSession(storage: StorageLike, session: DepositSession): DepositSession {
  const merged = mergeDepositSession(readDepositSession(storage, session.id), session)
  try {
    storage.setItem(depositSessionStorageKey(session.id), JSON.stringify(merged))
  } catch (error) {
    throw new DepositSessionWriteError(
      `Deposit session ${session.id} could not be saved: ${String(error)}`,
    )
  }

  const readBack = readDepositSession(storage, session.id)
  if (!readBack || !equals(readBack, merged)) {
    throw new DepositSessionWriteError(
      `Deposit session ${session.id} did not survive read-back; storage is not durable`,
    )
  }
  return merged
}

/**
 * The wallet rejected the prompt, so the session goes back to `prepared` and the
 * form reopens. This is the one sanctioned phase regression, and it deliberately
 * bypasses the monotonic merge — but only from a prompt phase and only while no
 * hash has been recorded. A rejection after a hash exists is not a rejection of
 * that transaction. Call it under the session's Web Lock.
 */
export function rollbackDepositSessionPrompt(
  storage: StorageLike,
  id: string,
): DepositSession | null {
  const current = readDepositSession(storage, id)
  if (!current) return null
  if (current.phase !== "approval_prompt" && current.phase !== "send_prompt") return current
  if (current.submitted || current.currentSourceHash) return current

  const reverted = canonicalize({ ...current, phase: "prepared", updatedAt: Date.now() })
  try {
    storage.setItem(depositSessionStorageKey(id), JSON.stringify(reverted))
  } catch (error) {
    throw new DepositSessionWriteError(
      `Deposit session ${id} could not be reverted: ${String(error)}`,
    )
  }
  const readBack = readDepositSession(storage, id)
  if (!readBack || !equals(readBack, reverted)) {
    throw new DepositSessionWriteError(
      `Deposit session ${id} did not survive read-back; storage is not durable`,
    )
  }
  return reverted
}

function depositSessionKeys(storage: StorageLike): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(LocalStorageKey.DEPOSIT_SESSION_PREFIX)) keys.push(key)
  }
  return keys
}

function readAllDepositSessions(storage: StorageLike): DepositSession[] {
  return depositSessionKeys(storage)
    .map((key) => {
      const raw = storage.getItem(key)
      if (!raw) return null
      try {
        return parseDepositSession(JSON.parse(raw))
      } catch {
        return null
      }
    })
    .filter((session): session is DepositSession => !!session)
}

/**
 * Sessions issued against `apiUrl`, newest first. The environment fingerprint is
 * part of the filter because a staging deposit address and a production one look
 * identical; resuming across environments would poll the wrong backend for a
 * transfer it never saw.
 */
export function listDepositSessions(storage: StorageLike, apiUrl: string): DepositSession[] {
  return readAllDepositSessions(storage)
    .filter((session) => session.apiUrl === apiUrl)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

const TERMINAL_RETENTION_MS = 30 * DAY_IN_MS
const TERMINAL_RETENTION_COUNT = 20

/**
 * Housekeeping only. A non-terminal session is never removed no matter how old —
 * age is not evidence that a transfer settled, and the record holds the only
 * copy of the source hash. Terminal records are kept for 30 days, and the newest
 * 20 survive regardless of age so a quiet month still leaves a support trail.
 */
export function pruneDepositSessions(storage: StorageLike, now: number): void {
  const terminal = readAllDepositSessions(storage)
    .filter((session) => session.phase === "terminal")
    .sort((a, b) => b.updatedAt - a.updatedAt)

  for (const session of terminal.slice(TERMINAL_RETENTION_COUNT)) {
    if (now - session.updatedAt <= TERMINAL_RETENTION_MS) continue
    storage.removeItem(depositSessionStorageKey(session.id))
  }
}

/**
 * Copyable text for the "we could not save this" screen. Support can resolve a
 * transfer from these five facts alone, so it stays plain and stable — there is
 * no recovery-import UI in this slice.
 */
export function recoveryReference(session: DepositSession): string {
  const sourceHash =
    session.currentSourceHash ?? session.originalSourceHash ?? session.submitted?.hash ?? "unknown"
  return [
    "InterwovenKit deposit recovery reference",
    `Session: ${session.id}`,
    `API: ${session.apiUrl}`,
    `Source: ${session.source.chainName} (chain ${session.source.chainId})`,
    `Source transaction: ${sourceHash}`,
    `Deposit address: ${session.depositAddress}`,
    `Recipient: ${session.destination.recipient} on ${session.destination.chainName} (chain ${session.destination.chainId})`,
  ].join("\n")
}

/**
 * Web Locks is the only real mutual exclusion available here: a localStorage
 * compare-and-read-back lease is not atomic and must not be described as one.
 * `navigator.locks` requires a secure context (HTTPS, or localhost in
 * development); on plain HTTP it is `undefined` and every helper below throws so
 * the caller fails closed before a prompt rather than signing twice.
 */
function getLockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null
  return navigator.locks ?? null
}

function lockName(id: string): string {
  return depositSessionStorageKey(id)
}

const UNAVAILABLE =
  "Deposit sessions need the Web Locks API, which requires a secure context (HTTPS or localhost)."

const HELD_ELSEWHERE = "This deposit is already running in another tab."

/**
 * Takes the session's lock and keeps it until `release()`. The executing tab
 * acquires this once the form is ready — ahead of the wallet click — so the
 * click path itself contains no await other than the wallet calls, and holds it
 * for the active life of the session. The lock lives inside the request callback
 * as a deferred promise: it resolves only when `release` is called (or the tab
 * goes away, which the browser handles for us).
 */
export function holdDepositSessionLock(id: string): Promise<{ release: () => void }> {
  const locks = getLockManager()
  if (!locks) return Promise.reject(new DepositSessionLockError(UNAVAILABLE))

  return new Promise((resolve, reject) => {
    let release: () => void = () => {}
    const held = new Promise<void>((done) => {
      release = done
    })

    locks
      .request(lockName(id), { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(new DepositSessionLockError(HELD_ELSEWHERE))
          return Promise.resolve()
        }
        resolve({ release })
        return held
      })
      .catch(reject)
  })
}

// Same-tab writes do not raise a `storage` event — the spec fires it only in
// *other* documents — so the hook needs both sources: the event for a second
// tab, and this emitter for the tab doing the writing.
let storeRevision = 0
const listeners = new Set<() => void>()

function notifyDepositSessions() {
  storeRevision += 1
  for (const listener of listeners) listener()
}

function handleStorage(event: StorageEvent) {
  // A null key means the whole store was cleared.
  if (event.key === null || event.key.startsWith(LocalStorageKey.DEPOSIT_SESSION_PREFIX)) {
    notifyDepositSessions()
  }
}

function subscribeDepositSessions(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", handleStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage)
  }
}

const getRevision = () => storeRevision

// Records the browser could not persist. A failed
// write after a broadcast must not lose the evidence, so the store keeps the
// newest merged copy here and reports it as volatile; a later successful write
// promotes it back to localStorage.
const volatileSessions = new Map<string, DepositSession>()

function readStoredOrVolatile(id: string): DepositSession | null {
  return readDepositSession(localStorage, id) ?? volatileSessions.get(id) ?? null
}

/**
 * Writes through localStorage, falling back to the in-memory copy when storage
 * itself fails. Identity conflicts (see assertSameIntent) still throw: those are
 * programming errors, not a browser that cannot save. Never call this for the
 * pre-prompt write that must block signing — use writeDepositSession directly
 * so a non-durable record is an error there.
 */
function writeStoredOrVolatile(session: DepositSession): DepositSession {
  const stamped = { ...session, updatedAt: Date.now() }
  // Merging first surfaces an identity conflict before any storage attempt.
  const merged = mergeDepositSession(readStoredOrVolatile(session.id), stamped)
  try {
    const saved = writeDepositSession(localStorage, merged)
    volatileSessions.delete(session.id)
    return saved
  } catch (error) {
    if (!(error instanceof DepositSessionWriteError)) throw error
    volatileSessions.set(session.id, merged)
    return merged
  } finally {
    notifyDepositSessions()
  }
}

/** localStorage-backed session access that re-renders on writes from this tab and from others. */
export function useDepositSessionStore() {
  const revision = useSyncExternalStore(subscribeDepositSessions, getRevision, getRevision)
  return useMemo(
    () => ({
      revision,
      read: readStoredOrVolatile,
      write: writeStoredOrVolatile,
      /** The record exists only in this tab's memory; a reload will not find it. */
      isVolatile: (id: string) => volatileSessions.has(id),
      /** Adopts an in-memory record (the form's post-send fallback) when storage has none. */
      remember: (session: DepositSession) => {
        if (readStoredOrVolatile(session.id)) return
        volatileSessions.set(session.id, session)
        notifyDepositSessions()
      },
      // A record the browser could not persist is still a transfer in flight,
      // so the hub lists it alongside the stored ones for as long as this tab lives.
      list: (apiUrl: string) => {
        const stored = listDepositSessions(localStorage, apiUrl)
        const ids = new Set(stored.map(({ id }) => id))
        const volatile = [...volatileSessions.values()].filter(
          (session) => session.apiUrl === apiUrl && !ids.has(session.id),
        )
        return [...stored, ...volatile].sort((a, b) => b.updatedAt - a.updatedAt)
      },
      subscribe: subscribeDepositSessions,
    }),
    [revision],
  )
}
