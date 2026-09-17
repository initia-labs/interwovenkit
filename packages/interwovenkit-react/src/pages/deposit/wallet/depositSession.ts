import { equals } from "ramda"
import { useMemo, useSyncExternalStore } from "react"
import { DAY_IN_MS, LocalStorageKey } from "@/data/constants"
import {
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

const DEPOSIT_SESSION_VERSION = 1

export type DepositSessionPhase =
  | "prepared"
  | "send_prompt"
  | "submission_unknown"
  | "source_sent"
  | "deposit_indexed"
  | "terminal"

// Monotonic phase order. `submission_unknown` sits between `send_prompt` and `source_sent`
// so the guard cannot walk an ambiguous submission back to a phase the UI treats as re-signable.
export const DEPOSIT_SESSION_PHASES: readonly DepositSessionPhase[] = [
  "prepared",
  "send_prompt",
  "submission_unknown",
  "source_sent",
  "deposit_indexed",
  "terminal",
]

// The whole vocabulary the derivation may persist (see depositProgressLogic), so a stored
// label is always one the reader knows how to render.
const DEPOSIT_LAST_STATES = [
  "source_pending",
  "source_replaced",
  "source_reverted",
  "source_cancelled",
  "source_conflict",
  "bridge_not_found",
  "bridge_pending",
  "bridge_refunding",
  "bridge_refunded",
  "bridge_partial",
  "bridge_refund_required",
  "bridge_failed",
  "deposit_pending",
  "deposit_indexed",
  "waiting",
  "processing",
  "completed",
  "below_minimum",
  "failed",
  "unknown",
  "tracking_conflict",
] as const

export type DepositLastState = (typeof DEPOSIT_LAST_STATES)[number]

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
  /** The exact intended call, saved before any wallet prompt. It is the only description of intent that survives a lost response. */
  transaction: DepositSessionTransaction
  /** Source-pinned block captured before the prompt; the lower bound for ethers' replacement scan. Never proof that nothing was sent. */
  preSubmitBlock?: number
  /** Identity of the response the wallet actually returned. The wallet may pick a nonce other than any prefetched hint. */
  submitted?: { hash: string; nonce?: number; from: string }
  currentSourceHash?: string
  originalSourceHash?: string
  depositId?: string
  lastState?: DepositLastState
}

/** Raised when a session write cannot be proven durable. Callers must block signing and show the recovery reference instead. */
export class DepositSessionWriteError extends Error {}

export function depositSessionStorageKey(id: string): string {
  return `${LocalStorageKey.DEPOSIT_SESSION_PREFIX}${id}`
}

/** Strips keys whose value is `undefined` so a stored record and its parsed form compare equal (see writeDepositSession). */
function canonicalize(session: DepositSession): DepositSession {
  return JSON.parse(JSON.stringify(session)) as DepositSession
}

/** `crypto.randomUUID` needs a secure context (HTTPS or localhost). */
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

const isLastState = (value: unknown): value is DepositLastState =>
  DEPOSIT_LAST_STATES.includes(value as DepositLastState)

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
  depositId: optional(isNonEmptyString),
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

const SUBMITTED_FIELDS = {
  hash: required(isNonEmptyString),
  nonce: optional(isInteger),
  from: required(isNonEmptyString),
}

// Fail closed: version drift, a missing field or a wrong type returns null, and the result
// carries only spec'd fields, so a foreign key cannot ride along into a later write.
export function parseDepositSession(raw: unknown): DepositSession | null {
  if (!isRecord(raw) || raw.version !== DEPOSIT_SESSION_VERSION) return null

  const session = parseFields(raw, SESSION_FIELDS)
  const source = parseFields(raw.source, SOURCE_FIELDS)
  const destination = parseFields(raw.destination, DESTINATION_FIELDS)
  const transaction = parseFields(raw.transaction, TRANSACTION_FIELDS)
  // An absent sub-record is fine; a present but malformed one rejects the session.
  const submitted =
    raw.submitted === undefined ? undefined : parseFields(raw.submitted, SUBMITTED_FIELDS)
  if (!session || !source || !destination || !transaction || submitted === null) return null

  return canonicalize({
    version: DEPOSIT_SESSION_VERSION,
    ...session,
    source,
    destination,
    transaction,
    submitted,
    // Display-only, and written by this client alone: an unrecognized label is dropped
    // rather than rejecting a record that may describe funds in flight.
    lastState: isLastState(raw.lastState) ? raw.lastState : undefined,
  })
}

/** Whether `to` is at or after `from` in DEPOSIT_SESSION_PHASES. Equal phases are advances so a write can update fields without moving the phase. */
export function isPhaseAdvance(from: DepositSessionPhase, to: DepositSessionPhase): boolean {
  return DEPOSIT_SESSION_PHASES.indexOf(to) >= DEPOSIT_SESSION_PHASES.indexOf(from)
}

// Facts that identify *which transfer* this is; a disagreement means two intents are
// colliding on one id. Amount, deposit address and transaction stay mutable.
export interface DepositIntent {
  apiUrl: string
  transport: DepositSession["transport"]
  source: Pick<DepositSession["source"], "chainId" | "denom" | "sender">
  destination: Pick<DepositSession["destination"], "chainId" | "denom" | "recipient">
}

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

// Only the window in which a second signature could duplicate the first: a prompt that was
// opened and not resolved, or a send the wallet never confirmed. Once a hash is known the
// transfer is a distinct, tracked thing and a new deposit for the same pair is legitimate.
export function findInFlightSession(
  sessions: DepositSession[],
  intent: DepositIntent,
): DepositSession | undefined {
  return sessions.find(
    (session) =>
      (session.phase === "send_prompt" || session.phase === "submission_unknown") &&
      isSameIntent(session, intent),
  )
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
    preSubmitBlock: next.preSubmitBlock ?? current.preSubmitBlock,
    submitted: next.submitted ? { ...current.submitted, ...next.submitted } : current.submitted,
    currentSourceHash: next.currentSourceHash ?? current.currentSourceHash,
    originalSourceHash: next.originalSourceHash ?? current.originalSourceHash,
    depositId: next.depositId ?? current.depositId,
    lastState: next.lastState ?? current.lastState,
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

// Read back every durable write: a quota error, a private-mode stub or a competing tab all
// end with the caller believing a transfer is recorded when it is not.
function persistDepositSession(
  storage: StorageLike,
  session: DepositSession,
  action: string,
): DepositSession {
  try {
    storage.setItem(depositSessionStorageKey(session.id), JSON.stringify(session))
  } catch (error) {
    throw new DepositSessionWriteError(
      `Deposit session ${session.id} could not be ${action}: ${String(error)}`,
    )
  }

  const readBack = readDepositSession(storage, session.id)
  if (!readBack || !equals(readBack, session)) {
    throw new DepositSessionWriteError(
      `Deposit session ${session.id} did not survive read-back; storage is not durable`,
    )
  }
  return session
}

export function writeDepositSession(storage: StorageLike, session: DepositSession): DepositSession {
  const merged = mergeDepositSession(readDepositSession(storage, session.id), session)
  return persistDepositSession(storage, merged, "saved")
}

// The one sanctioned phase regression, deliberately bypassing the monotonic merge: only
// from the send prompt and only while no hash exists, because a rejection after a hash is
// not a rejection of that transaction.
export function rollbackDepositSessionPrompt(
  storage: StorageLike,
  id: string,
): DepositSession | null {
  const current = readDepositSession(storage, id)
  if (!current) return null
  if (current.phase !== "send_prompt") return current
  if (current.submitted || current.currentSourceHash) return current

  const reverted = canonicalize({ ...current, phase: "prepared", updatedAt: Date.now() })
  return persistDepositSession(storage, reverted, "reverted")
}

function depositSessionIds(storage: StorageLike): string[] {
  const { DEPOSIT_SESSION_PREFIX } = LocalStorageKey
  const ids: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(DEPOSIT_SESSION_PREFIX)) ids.push(key.slice(DEPOSIT_SESSION_PREFIX.length))
  }
  return ids
}

function readAllDepositSessions(storage: StorageLike): DepositSession[] {
  return depositSessionIds(storage)
    .map((id) => readDepositSession(storage, id))
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

const PREPARED_RETENTION_MS = DAY_IN_MS

// A session that reached a prompt is never removed no matter how old: age is not evidence
// that a transfer settled. One that never did (`prepared`: the form was left before the
// wallet opened) describes no transfer and goes after a day. Terminal records last 30 days,
// and the newest 20 survive regardless.
export function pruneDepositSessions(storage: StorageLike, now: number): void {
  const sessions = readAllDepositSessions(storage)
  const remove = (session: DepositSession) =>
    storage.removeItem(depositSessionStorageKey(session.id))

  for (const session of sessions) {
    if (session.phase === "prepared" && now - session.updatedAt > PREPARED_RETENTION_MS) {
      remove(session)
    }
  }

  const terminal = sessions
    .filter((session) => session.phase === "terminal")
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of terminal.slice(TERMINAL_RETENTION_COUNT)) {
    if (now - session.updatedAt > TERMINAL_RETENTION_MS) remove(session)
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

// A volatile copy exists only because a later write failed, so when both exist and it is
// at least as far along, it is the newer record.
function readStoredOrVolatile(id: string): DepositSession | null {
  const stored = readDepositSession(localStorage, id)
  const volatile = volatileSessions.get(id)
  if (volatile && (!stored || isPhaseAdvance(stored.phase, volatile.phase))) return volatile
  return stored
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
      read: readStoredOrVolatile,
      write: writeStoredOrVolatile,
      /** The record exists only in this tab's memory; a reload will not find it. */
      isVolatile: (id: string) => volatileSessions.has(id),
      // A record the browser could not persist is still a transfer in flight, so the hub
      // lists it alongside the stored ones for as long as this tab lives.
      list: (apiUrl: string) => {
        const stored = listDepositSessions(localStorage, apiUrl).map(
          (session) => readStoredOrVolatile(session.id) ?? session,
        )
        const ids = new Set(stored.map(({ id }) => id))
        const volatile = [...volatileSessions.values()].filter(
          (session) => session.apiUrl === apiUrl && !ids.has(session.id),
        )
        return [...stored, ...volatile].sort((a, b) => b.updatedAt - a.updatedAt)
      },
    }),
    // The revision is not read here: it is the store's version, and re-identifying this
    // object is what invalidates every memo a caller built on the sessions it returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  )
}
