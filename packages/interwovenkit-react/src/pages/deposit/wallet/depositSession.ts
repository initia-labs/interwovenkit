import { equals } from "ramda"
import { useMemo, useSyncExternalStore } from "react"
import { DAY_IN_MS, LocalStorageKey } from "@/data/constants"
import {
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isString,
  optional,
  parseFields,
  required,
} from "../data/parse"
import { BRIDGE_STATUS_STATES, DEPOSIT_BUCKETS } from "../data/types"

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

const DEPOSIT_SESSION_VERSION = 1

// Monotonic. `submission_unknown` precedes `source_sent` so an ambiguous send can never walk back to a re-signable phase.
const DEPOSIT_SESSION_PHASES = [
  "prepared",
  "send_prompt",
  "submission_unknown",
  "source_sent",
  "terminal",
] as const

export type DepositSessionPhase = (typeof DEPOSIT_SESSION_PHASES)[number]

const DEPOSIT_LAST_STATES = [
  "source_pending",
  "source_replaced",
  "source_reverted",
  "source_cancelled",
  "source_conflict",
  ...BRIDGE_STATUS_STATES,
  ...DEPOSIT_BUCKETS,
  "unknown",
  "tracking_conflict",
  "not_sent",
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
  /** Records issued against one Deposit API environment must never resume against another. */
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
  transaction: DepositSessionTransaction
  predictedDelivery?: string
  preSubmitBlock?: number
  /** When the wallet prompt opened, and the sender's mined nonce read before it. */
  promptedAt?: number
  promptNonce?: number
  /** Last heartbeat from a tab still holding the prompt open. */
  promptSeenAt?: number
  /** What the wallet actually returned; its nonce may differ from any prefetched hint. */
  submitted?: { nonce?: number; from: string }
  currentSourceHash?: string
  originalSourceHash?: string
  depositId?: string
  lastState?: DepositLastState
}

export type DepositSessionDraft = Omit<
  DepositSession,
  "version" | "id" | "createdAt" | "updatedAt" | "phase"
>

export class DepositSessionWriteError extends Error {}

export function depositSessionStorageKey(id: string): string {
  return `${LocalStorageKey.DEPOSIT_SESSION_PREFIX}${id}`
}

// Strips `undefined` keys so a stored record and its parsed form compare equal.
function canonicalize(session: DepositSession): DepositSession {
  return JSON.parse(JSON.stringify(session)) as DepositSession
}

function createDepositSession(draft: DepositSessionDraft): DepositSession {
  const now = Date.now()
  return canonicalize({
    ...draft,
    version: DEPOSIT_SESSION_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    phase: "prepared",
  })
}

// Only a never-prompted record of the same transfer may be signed again; anything later gets a new record.
export function reuseOrCreateDepositSession(
  stored: DepositSession | null,
  draft: DepositSessionDraft,
): DepositSession {
  return stored?.phase === "prepared" && isSameIntent(stored, draft)
    ? stored
    : createDepositSession(draft)
}

const isInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value)

const isTransport = (value: unknown): value is DepositSession["transport"] =>
  value === "direct" || value === "lifi"

const isPhase = (value: unknown): value is DepositSessionPhase =>
  DEPOSIT_SESSION_PHASES.some((phase) => phase === value)

const isLastState = (value: unknown): value is DepositLastState =>
  DEPOSIT_LAST_STATES.some((state) => state === value)

const SESSION_FIELDS = {
  id: required(isNonEmptyString),
  apiUrl: required(isNonEmptyString),
  createdAt: required(isFiniteNumber),
  updatedAt: required(isFiniteNumber),
  transport: required(isTransport),
  phase: required(isPhase),
  depositAddress: required(isNonEmptyString),
  predictedDelivery: optional(isNonEmptyString),
  preSubmitBlock: optional(isNonNegativeInteger),
  promptedAt: optional(isNonNegativeInteger),
  promptNonce: optional(isNonNegativeInteger),
  promptSeenAt: optional(isNonNegativeInteger),
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
  nonce: optional(isInteger),
  from: required(isNonEmptyString),
}

// Fails closed, and keeps only spec'd fields so a foreign key cannot ride along into a later write.
export function parseDepositSession(raw: unknown): DepositSession | null {
  if (!isRecord(raw) || raw.version !== DEPOSIT_SESSION_VERSION) return null

  const session = parseFields(raw, SESSION_FIELDS)
  const source = parseFields(raw.source, SOURCE_FIELDS)
  const destination = parseFields(raw.destination, DESTINATION_FIELDS)
  const transaction = parseFields(raw.transaction, TRANSACTION_FIELDS)
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
    // Display-only: an unknown label must not reject a record that may describe funds in flight.
    lastState: isLastState(raw.lastState) ? raw.lastState : undefined,
  })
}

/** Equal phases count as an advance so a write can update fields without moving the phase. */
export function isPhaseAdvance(from: DepositSessionPhase, to: DepositSessionPhase): boolean {
  return DEPOSIT_SESSION_PHASES.indexOf(to) >= DEPOSIT_SESSION_PHASES.indexOf(from)
}

// Which transfer a record describes; amount, deposit address and transaction may change.
export interface DepositIntent {
  apiUrl: string
  transport: DepositSession["transport"]
  source: Pick<DepositSession["source"], "chainId" | "denom" | "sender">
  destination: Pick<DepositSession["destination"], "chainId" | "denom" | "recipient">
}

const intentOf = ({ apiUrl, transport, source, destination }: DepositIntent) => [
  apiUrl,
  transport,
  source.chainId,
  source.denom,
  source.sender,
  destination.chainId,
  destination.denom,
  destination.recipient,
]

function isSameIntent(a: DepositIntent, b: DepositIntent): boolean {
  return equals(intentOf(a), intentOf(b))
}

// The window in which a second signature could duplicate the first; once a hash is known, a new deposit is legitimate.
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

// The phase only moves forward and `undefined` keeps the stored value, so a stale tab cannot erase a hash.
export function mergeDepositSession(
  current: DepositSession | null,
  next: DepositSession,
): DepositSession {
  if (!current) return canonicalize(next)
  if (current.id !== next.id || !isSameIntent(current, next)) {
    throw new DepositSessionWriteError(`Deposit session ${current.id} identity changed`)
  }

  // A hash outranks a "not sent" verdict: the transfer was broadcast after all.
  const reopened =
    current.lastState === "not_sent" && !current.currentSourceHash && !!next.currentSourceHash

  return canonicalize({
    ...current,
    ...next,
    createdAt: current.createdAt,
    updatedAt: Math.max(current.updatedAt, next.updatedAt),
    phase: reopened || isPhaseAdvance(current.phase, next.phase) ? next.phase : current.phase,
    preSubmitBlock: next.preSubmitBlock ?? current.preSubmitBlock,
    promptedAt: next.promptedAt ?? current.promptedAt,
    promptNonce: next.promptNonce ?? current.promptNonce,
    promptSeenAt: Math.max(next.promptSeenAt ?? 0, current.promptSeenAt ?? 0) || undefined,
    submitted: next.submitted ? { ...current.submitted, ...next.submitted } : current.submitted,
    currentSourceHash: next.currentSourceHash ?? current.currentSourceHash,
    originalSourceHash: next.originalSourceHash ?? current.originalSourceHash,
    depositId: next.depositId ?? current.depositId,
    lastState: reopened
      ? next.lastState
      : current.phase === "terminal"
        ? current.lastState
        : (next.lastState ?? current.lastState),
  })
}

export function readDepositSession(storage: StorageLike, id: string): DepositSession | null {
  try {
    const raw = storage.getItem(depositSessionStorageKey(id))
    return raw ? parseDepositSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

// Read back every durable write: a quota error, a private-mode stub or another tab can each drop it silently.
function persistDepositSession(storage: StorageLike, session: DepositSession): DepositSession {
  try {
    storage.setItem(depositSessionStorageKey(session.id), JSON.stringify(session))
  } catch (error) {
    throw new DepositSessionWriteError(
      `Deposit session ${session.id} could not be saved: ${String(error)}`,
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
  return persistDepositSession(storage, merged)
}

// The one sanctioned phase regression: a rejection after a hash is not a rejection of that transaction.
export function rollbackDepositSessionPrompt(
  storage: StorageLike,
  id: string,
): DepositSession | null {
  const current = readDepositSession(storage, id)
  if (!current || current.phase !== "send_prompt" || current.currentSourceHash) return current

  const reverted = canonicalize({
    ...current,
    phase: "prepared",
    promptedAt: undefined,
    promptNonce: undefined,
    promptSeenAt: undefined,
    updatedAt: Date.now(),
  })
  return persistDepositSession(storage, reverted)
}

function readAllDepositSessions(storage: StorageLike): DepositSession[] {
  const { DEPOSIT_SESSION_PREFIX } = LocalStorageKey
  const sessions: DepositSession[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(DEPOSIT_SESSION_PREFIX)) continue
    const session = readDepositSession(storage, key.slice(DEPOSIT_SESSION_PREFIX.length))
    if (session) sessions.push(session)
  }
  return sessions
}

export function listDepositSessions(storage: StorageLike, apiUrl: string): DepositSession[] {
  return readAllDepositSessions(storage)
    .filter((session) => session.apiUrl === apiUrl)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

const TERMINAL_RETENTION_MS = 30 * DAY_IN_MS
const TERMINAL_RETENTION_COUNT = 20
const PREPARED_RETENTION_MS = DAY_IN_MS

// A session that reached a prompt is never removed while open: age is not evidence that a transfer settled.
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

export function recoveryReference(session: DepositSession): string {
  return [
    "InterwovenKit deposit recovery reference",
    `Session: ${session.id}`,
    `API: ${session.apiUrl}`,
    `Source: ${session.source.chainName} (chain ${session.source.chainId})`,
    `Source transaction: ${session.currentSourceHash ?? "unknown"}`,
    `Deposit address: ${session.depositAddress}`,
    `Recipient: ${session.destination.recipient} on ${session.destination.chainName} (chain ${session.destination.chainId})`,
  ].join("\n")
}

// Same-tab writes raise no `storage` event, so the store also notifies its own listeners.
let storeRevision = 0
const listeners = new Set<() => void>()

function notifyDepositSessions() {
  storeRevision += 1
  for (const listener of listeners) listener()
}

function handleStorage(event: StorageEvent) {
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

// Post-prompt records the browser could not persist; a later successful write promotes them back.
const volatileSessions = new Map<string, DepositSession>()

// Merged rather than picked, so a late hash kept only in memory still outranks a stored verdict.
function preferVolatile(stored: DepositSession | null, id: string): DepositSession | null {
  const volatile = volatileSessions.get(id)
  if (!volatile) return stored
  return stored ? mergeDepositSession(stored, volatile) : volatile
}

function readStoredOrVolatile(id: string): DepositSession | null {
  return preferVolatile(readDepositSession(localStorage, id), id)
}

// Never for a pre-prompt write, which must block signing when it is not durable.
function writeStoredOrVolatile(session: DepositSession): DepositSession {
  const merged = mergeDepositSession(readStoredOrVolatile(session.id), {
    ...session,
    updatedAt: Date.now(),
  })
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

function listStoredAndVolatile(apiUrl: string): DepositSession[] {
  const byId = new Map(
    listDepositSessions(localStorage, apiUrl).map((session) => [session.id, session]),
  )
  for (const [id, session] of volatileSessions) {
    if (session.apiUrl !== apiUrl) continue
    const preferred = preferVolatile(byId.get(id) ?? null, id)
    if (preferred) byId.set(id, preferred)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function useDepositSessionStore() {
  const revision = useSyncExternalStore(subscribeDepositSessions, getRevision, getRevision)
  return useMemo(
    () => ({
      read: readStoredOrVolatile,
      write: writeStoredOrVolatile,
      isVolatile: (id: string) => volatileSessions.has(id),
      list: listStoredAndVolatile,
    }),
    // A new object per revision is what invalidates every memo built on the sessions it returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  )
}
