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

// Injected so the pure functions can run against an in-memory map, and so a caller can
// pass a stub when `localStorage` is unavailable (Safari private mode throws on write).
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

// Monotonic phase order. `submission_unknown` sits between `send_prompt` and `source_sent`
// so the guard cannot walk an ambiguous submission back to a phase the UI treats as re-signable.
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

export function depositSessionStorageKey(id: string): string {
  return `${LocalStorageKey.DEPOSIT_SESSION_PREFIX}${id}`
}

/** Strips keys whose value is `undefined` so a stored record and its parsed form compare equal (see writeDepositSession). */
function canonicalize(session: DepositSession): DepositSession {
  return JSON.parse(JSON.stringify(session)) as DepositSession
}

/** `crypto.randomUUID` needs a secure context (HTTPS or localhost), the same requirement as the Web Locks helpers below. */
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

// Everything the resume path needs is required; a present optional field is still never
// allowed to be malformed.
const SESSION_FIELDS = {
  id: required(isNonEmptyString),
  apiUrl: required(isNonEmptyString),
  createdAt: required(isFiniteNumber),
  updatedAt: required(isFiniteNumber),
  transport: required(isTransport),
  phase: required(isPhase),
  depositAddress: required(isNonEmptyString),
  cursor: required(isString),
  // A fractional or negative block would silently widen or invalidate the replacement scan.
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

// Fail closed: version drift, a missing field or a wrong type returns null, and the result
// carries only spec'd fields, so a foreign key cannot ride along into a later write.
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

// Facts that identify *which transfer* this is; a disagreement means two intents are
// colliding on one id. Amount, deposit address and transaction stay mutable.
type DepositIntent = Pick<DepositSession, "apiUrl" | "transport" | "source" | "destination">

function intentMismatch(current: DepositIntent, next: DepositIntent) {
  return (
    [
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
}

/** Whether two records describe the same transfer (amount, address and transaction may differ). */
export function isSameIntent(current: DepositIntent, next: DepositIntent): boolean {
  return !intentMismatch(current, next)
}

function assertSameIntent(current: DepositSession, next: DepositSession): void {
  const mismatch =
    current.id !== next.id ? (["id", current.id, next.id] as const) : intentMismatch(current, next)
  if (mismatch) {
    throw new DepositSessionWriteError(
      `Deposit session ${current.id} identity changed (${mismatch[0]}): ${String(mismatch[1])} vs ${String(mismatch[2])}`,
    )
  }
}

// The phase only moves forward and an `undefined` in `next` keeps the stored value, so a
// stale tab cannot walk `source_sent` back to a re-signable state or erase a hash it did
// not know about. A *different* hash still wins: that is what repricing does.
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

// Read → merge → write → read back: a quota error, a private-mode stub or a competing tab
// all end with the caller believing a transfer is recorded when it is not. Hold the
// session Web Lock whenever this write precedes or follows a wallet prompt.
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

// The one sanctioned phase regression, deliberately bypassing the monotonic merge: only
// from a prompt phase and only while no hash exists, because a rejection after a hash is
// not a rejection of that transaction. Call it under the session Web Lock.
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

/** Newest first, filtered by environment: a staging deposit address and a production one are indistinguishable by shape. */
export function listDepositSessions(storage: StorageLike, apiUrl: string): DepositSession[] {
  return readAllDepositSessions(storage)
    .filter((session) => session.apiUrl === apiUrl)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

const TERMINAL_RETENTION_MS = 30 * DAY_IN_MS
const TERMINAL_RETENTION_COUNT = 20

// A non-terminal session is never removed no matter how old: age is not evidence that a
// transfer settled. Terminal records last 30 days, and the newest 20 survive regardless.
export function pruneDepositSessions(storage: StorageLike, now: number): void {
  const terminal = readAllDepositSessions(storage)
    .filter((session) => session.phase === "terminal")
    .sort((a, b) => b.updatedAt - a.updatedAt)

  for (const session of terminal.slice(TERMINAL_RETENTION_COUNT)) {
    if (now - session.updatedAt <= TERMINAL_RETENTION_MS) continue
    storage.removeItem(depositSessionStorageKey(session.id))
  }
}

/** Copyable text for the "we could not save this" screen; there is no recovery-import UI in this slice. */
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

// `navigator.locks` requires a secure context; on plain HTTP it is undefined and every
// helper below throws, so the caller fails closed before a prompt rather than signing twice.
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

// Taken once the form is ready — ahead of the wallet click, so the click path itself
// contains no await other than the wallet calls — and held until `release()`.
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

// Same-tab writes do not raise a `storage` event (the spec fires it only in *other*
// documents), so the hook needs both the event and this emitter.
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

// Records the browser could not persist. A failed write after a broadcast must not lose
// the evidence; a later successful write promotes it back to localStorage.
const volatileSessions = new Map<string, DepositSession>()

function readStoredOrVolatile(id: string): DepositSession | null {
  return readDepositSession(localStorage, id) ?? volatileSessions.get(id) ?? null
}

// Falls back to the in-memory copy when storage itself fails. Never call this for the
// pre-prompt write that must block signing — writeDepositSession makes that an error.
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
      // A record the browser could not persist is still a transfer in flight, so the hub
      // lists it alongside the stored ones for as long as this tab lives.
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
