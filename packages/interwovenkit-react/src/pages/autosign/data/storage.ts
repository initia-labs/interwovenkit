import { fromBase64, toBase64 } from "@cosmjs/encoding"
import { walletFromPrivateKey } from "./derivation"
import type { DerivedWallet } from "./store"

const DATABASE_NAME = "interwovenkit-autosign"
const DATABASE_VERSION = 1
const STORE_NAME = "autosign"
const SESSION_PREFIX = "interwovenkit:autosign:session:"
const SCHEMA_VERSION = 1

export type AutoSignStorageMode = "persistent" | "session" | "memory"
export type AutoSignKeyProvenance = "legacy-derived" | "random"
export type AutoSignWalletState = "pending" | "active" | "paused" | "forgotten"

export interface AutoSignIdentity {
  owner: string
  chainId: string
  bech32Prefix: string
  origin: string
}

export interface AutoSignPreference {
  stayConnected: boolean
  revision: number
  forgotten: boolean
  explicit: boolean
}

export interface StoredAutoSignWallet extends DerivedWallet {
  provenance: AutoSignKeyProvenance
  revision: number
  keyId: string
  state: AutoSignWalletState
}

export interface AutoSignPublicIdentity extends AutoSignIdentity {
  address: string
  publicKey: string
  provenance: AutoSignKeyProvenance
  keyId: string
  state: AutoSignWalletState
  revision: number
  requestedDurationMs?: number
  observedExpiration?: string
}

export interface LegacyAutoSignIdentity {
  owner: string
  chainId: string
  address: string
  provenance: "legacy-derived"
}

interface StoredPreference extends AutoSignPreference {
  schemaVersion: number
  owner: string
  origin: string
}

interface EncryptedWalletRecord {
  schemaVersion: number
  owner: string
  chainId: string
  bech32Prefix: string
  origin: string
  address: string
  publicKey: string
  provenance: AutoSignKeyProvenance
  keyId: string
  state: AutoSignWalletState
  requestedDurationMs?: number
  observedExpiration?: string
  revision: number
  nonce: ArrayBuffer
  ciphertext: ArrayBuffer
  wrappingKey: CryptoKey
  supersedes?: string | null
}

interface SessionWalletRecord {
  schemaVersion: number
  owner: string
  chainId: string
  bech32Prefix: string
  origin: string
  address: string
  publicKey: string
  privateKey: string
  provenance: AutoSignKeyProvenance
  keyId: string
  state: AutoSignWalletState
  requestedDurationMs?: number
  observedExpiration?: string
  revision: number
}

export class AutoSignStorageError extends Error {
  constructor(message = "Autosign browser storage is unavailable") {
    super(message)
    this.name = "AutoSignStorageError"
  }
}

export class AutoSignCancelledError extends Error {
  constructor(
    message = "Autosign operation was cancelled because the account or storage state changed",
  ) {
    super(message)
    this.name = "AutoSignCancelledError"
  }
}

export class AutoSignPendingResolutionError extends Error {
  readonly chainIds: string[]

  constructor(chainIds: string[]) {
    const uniqueChainIds = [...new Set(chainIds)]
    super(
      uniqueChainIds.length
        ? `Revoke or forget the pending autosign key for ${uniqueChainIds.join(", ")} in Settings before turning off Stay connected`
        : "Revoke or forget pending autosign keys in Settings before turning off Stay connected",
    )
    this.name = "AutoSignPendingResolutionError"
    this.chainIds = uniqueChainIds
  }
}

function preferenceKey(owner: string) {
  return `preference:${owner}`
}

function walletKey(identity: AutoSignIdentity) {
  return `wallet:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
}

function matchesIdentity(value: AutoSignIdentity, identity: AutoSignIdentity) {
  return (
    value.owner === identity.owner &&
    value.chainId === identity.chainId &&
    value.bech32Prefix === identity.bech32Prefix &&
    value.origin === identity.origin
  )
}

function identityKey(identity: AutoSignIdentity) {
  return `identity:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
}

function pendingWalletKey(identity: AutoSignIdentity, keyId: string) {
  return `${walletKey(identity)}:pending:${keyId}`
}

function pendingIdentityKey(identity: AutoSignIdentity, keyId: string) {
  return `${identityKey(identity)}:pending:${keyId}`
}

function sessionKey(identity: AutoSignIdentity) {
  return `${SESSION_PREFIX}${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
}

function metadata(
  identity: AutoSignIdentity,
  address: string,
  publicKey: string,
  revision: number,
  keyId: string,
  state: AutoSignWalletState,
  requestedDurationMs?: number,
  observedExpiration?: string,
  supersedes?: string | null,
) {
  return JSON.stringify({
    owner: identity.owner,
    chainId: identity.chainId,
    bech32Prefix: identity.bech32Prefix,
    origin: identity.origin,
    address,
    publicKey,
    revision,
    keyId,
    state,
    requestedDurationMs,
    observedExpiration,
    schemaVersion: SCHEMA_VERSION,
    supersedes,
  })
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function getCrypto(): Crypto {
  const crypto = globalThis.crypto
  if (!crypto?.subtle || !crypto.getRandomValues) {
    throw new AutoSignStorageError()
  }
  return crypto
}

function createKeyId() {
  return toBase64(getCrypto().getRandomValues(new Uint8Array(16)))
}

function toPublicIdentity(
  record: EncryptedWalletRecord | SessionWalletRecord,
): AutoSignPublicIdentity {
  return {
    owner: record.owner,
    chainId: record.chainId,
    bech32Prefix: record.bech32Prefix,
    origin: record.origin,
    address: record.address,
    publicKey: record.publicKey,
    provenance: record.provenance,
    keyId: record.keyId,
    state: record.state,
    revision: record.revision,
    requestedDurationMs: record.requestedDurationMs,
    observedExpiration: record.observedExpiration,
  }
}

function getSessionStorage(): Storage {
  if (typeof window === "undefined") throw new AutoSignStorageError()
  try {
    return window.sessionStorage
  } catch {
    throw new AutoSignStorageError()
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

let databasePromise: Promise<IDBDatabase> | undefined

function getDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === "undefined") return Promise.reject(new AutoSignStorageError())

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) {
        openRequest.result.createObjectStore(STORE_NAME)
      }
    }
    openRequest.onsuccess = () => {
      const database = openRequest.result
      database.onversionchange = () => {
        database.close()
        databasePromise = undefined
      }
      resolve(database)
    }
    openRequest.onerror = () => reject(new AutoSignStorageError())
    openRequest.onblocked = () => reject(new AutoSignStorageError())
  })
  databasePromise = opening.catch((error) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise
}

async function readPersistent<T>(key: string): Promise<T | undefined> {
  try {
    const database = await getDatabase()
    const transaction = database.transaction(STORE_NAME, "readonly")
    const value = await request(transaction.objectStore(STORE_NAME).get(key))
    await transactionDone(transaction)
    return value === undefined ? undefined : (value as T)
  } catch (error) {
    if (
      error instanceof AutoSignStorageError ||
      error instanceof AutoSignCancelledError ||
      error instanceof AutoSignPendingResolutionError
    )
      throw error
    throw new AutoSignStorageError()
  }
}

async function updatePersistent(
  update: (store: IDBObjectStore) => void | Promise<void>,
): Promise<void> {
  let transaction: IDBTransaction | undefined
  let done: Promise<void> | undefined
  try {
    const database = await getDatabase()
    transaction = database.transaction(STORE_NAME, "readwrite")
    done = transactionDone(transaction)
    await update(transaction.objectStore(STORE_NAME))
    await done
  } catch (error) {
    try {
      transaction?.abort()
    } catch {
      // The transaction already finished, so there is nothing left to roll back.
    }
    await done?.catch(() => undefined)
    if (
      error instanceof AutoSignStorageError ||
      error instanceof AutoSignCancelledError ||
      error instanceof AutoSignPendingResolutionError
    )
      throw error
    throw new AutoSignStorageError()
  }
}

async function deleteOwnerWallets(store: IDBObjectStore, owner: string) {
  const keys = await request(store.getAllKeys())
  for (const key of keys) {
    if (typeof key === "string" && key.startsWith(`wallet:${owner}:`)) {
      store.delete(key)
    }
  }
}

/** Keeps a forgotten prior grantee available for revocation after a replacement attempt. */
async function preserveReplacedForgottenIdentity(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
  replacementAddress: string,
) {
  const previous = (await request(store.get(identityKey(identity)))) as
    | AutoSignPublicIdentity
    | undefined
  if (
    previous?.state === "forgotten" &&
    previous.address !== replacementAddress &&
    isExactAutoSignPublicIdentity(previous, identity, previous.keyId)
  ) {
    store.put({ ...previous, state: "forgotten" }, pendingIdentityKey(identity, previous.keyId))
  }
}

/** Retains abandoned candidate identities for revoke inventory while removing their key material. */
async function markOwnerPendingIdentitiesForgotten(
  store: IDBObjectStore,
  owner: string,
  isCurrent: () => boolean,
) {
  const keys = await request(store.getAllKeys())
  for (const key of keys) {
    if (!isCurrent()) throw new AutoSignCancelledError()
    if (typeof key !== "string" || !key.startsWith(`wallet:${owner}:`)) continue
    const pending = (await request(store.get(key))) as EncryptedWalletRecord | undefined
    if (!pending || pending.state !== "pending") continue
    const pendingIdentityKeyForWallet = pendingIdentityKey(pending, pending.keyId)
    const pendingIdentity = (await request(store.get(pendingIdentityKeyForWallet))) as
      | AutoSignPublicIdentity
      | undefined
    if (
      isExactAutoSignPublicIdentity(pendingIdentity, pending, pending.keyId) &&
      pendingIdentity.state === "pending" &&
      pendingIdentity.revision === pending.revision
    ) {
      store.put({ ...pendingIdentity, state: "forgotten" }, pendingIdentityKeyForWallet)
    }
  }
}

async function markOwnerIdentitiesForgotten(store: IDBObjectStore, owner: string) {
  const keys = await request(store.getAllKeys())
  await Promise.all(
    keys
      .filter(
        (key): key is string => typeof key === "string" && key.startsWith(`identity:${owner}:`),
      )
      .map(async (key) => {
        const identity = (await request(store.get(key))) as AutoSignPublicIdentity | undefined
        if (identity) store.put({ ...identity, state: "forgotten" }, key)
      }),
  )
}

async function ownerWalletRecords(owner: string): Promise<EncryptedWalletRecord[]> {
  try {
    const database = await getDatabase()
    const transaction = database.transaction(STORE_NAME, "readonly")
    const store = transaction.objectStore(STORE_NAME)
    const keys = await request(store.getAllKeys())
    const records = await Promise.all(
      keys
        .filter(
          (key): key is string => typeof key === "string" && key.startsWith(`wallet:${owner}:`),
        )
        .map(async (key) => (await request(store.get(key))) as EncryptedWalletRecord | undefined),
    )
    await transactionDone(transaction)
    return records.filter((record): record is EncryptedWalletRecord => !!record)
  } catch (error) {
    if (error instanceof AutoSignStorageError) throw error
    throw new AutoSignStorageError()
  }
}

function toSessionRecord(
  identity: AutoSignIdentity,
  wallet: StoredAutoSignWallet | DerivedWallet,
  keyId: string,
  state: AutoSignWalletState,
  revision: number,
  grant?: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
): SessionWalletRecord {
  return {
    ...identity,
    schemaVersion: SCHEMA_VERSION,
    address: wallet.address,
    publicKey: toBase64(wallet.publicKey),
    privateKey: toBase64(wallet.privateKey),
    provenance: "provenance" in wallet ? wallet.provenance : "legacy-derived",
    keyId,
    state,
    ...grant,
    revision,
  }
}

function writeSessionRecord(identity: AutoSignIdentity, record: SessionWalletRecord) {
  const storage = getSessionStorage()
  const key = sessionKey(identity)
  const serialized = JSON.stringify(record)
  storage.setItem(key, serialized)
  if (storage.getItem(key) !== serialized) throw new AutoSignStorageError()
  return serialized
}

/** Merges grant observations without treating an explicit undefined as an omission. */
export function mergeAutoSignObservation(
  existing: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
  observation?: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
): Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration"> {
  return {
    requestedDurationMs:
      observation && "requestedDurationMs" in observation
        ? observation.requestedDurationMs
        : existing.requestedDurationMs,
    observedExpiration:
      observation && "observedExpiration" in observation
        ? observation.observedExpiration
        : existing.observedExpiration,
  }
}

function isMatchingActiveSessionRecord(
  record: SessionWalletRecord,
  identity: AutoSignIdentity,
  revision: number,
  keyId: string,
): boolean {
  return (
    record.schemaVersion === SCHEMA_VERSION &&
    matchesIdentity(record, identity) &&
    record.keyId === keyId &&
    record.revision === revision &&
    record.state === "active" &&
    (record.provenance === "legacy-derived" || record.provenance === "random") &&
    typeof record.address === "string" &&
    typeof record.publicKey === "string" &&
    typeof record.privateKey === "string"
  )
}

/** The identity key is public, but must still match the full requested signer before deletion. */
export function isExactAutoSignPublicIdentity(
  value: AutoSignPublicIdentity | undefined,
  identity: AutoSignIdentity,
  keyId: string,
): value is AutoSignPublicIdentity {
  return !!value && matchesIdentity(value, identity) && value.keyId === keyId
}

function isMatchingActivePublicIdentity(
  value: AutoSignPublicIdentity | undefined,
  identity: AutoSignIdentity,
  revision: number,
  keyId: string,
): value is AutoSignPublicIdentity {
  return (
    isExactAutoSignPublicIdentity(value, identity, keyId) &&
    value.revision === revision &&
    value.state === "active" &&
    typeof value.address === "string" &&
    typeof value.publicKey === "string"
  )
}

export function clearAutoSignOwnerSessionWallets(owner: string) {
  const storage = getSessionStorage()
  const prefix = `${SESSION_PREFIX}${owner}:`
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}

async function handoffOwnerWalletsToSession(
  owner: string,
  revision: number,
  isCurrent: () => boolean,
) {
  const records = await ownerWalletRecords(owner)
  const handoff: Array<{ previous: EncryptedWalletRecord; record: SessionWalletRecord }> = []
  for (const record of records) {
    if (!isCurrent()) throw new AutoSignCancelledError()
    // A pending candidate has no confirmed authorization. It cannot become a
    // tab-scoped signer, but its public identity is retained as forgotten by
    // the preference transaction below so it remains revocable.
    if (record.state === "pending") continue
    const wallet = await decryptWallet(record)
    if (!wallet) throw new AutoSignStorageError("Autosign stored key could not be recovered")
    try {
      if (!isCurrent()) throw new AutoSignCancelledError()
      const sessionRecord = toSessionRecord(record, wallet, record.keyId, record.state, revision, {
        requestedDurationMs: record.requestedDurationMs,
        observedExpiration: record.observedExpiration,
      })
      writeSessionRecord(record, sessionRecord)
      handoff.push({ previous: record, record: sessionRecord })
    } finally {
      wallet.privateKey.fill(0)
    }
  }
  return handoff
}

async function ownerSessionWallets(owner: string, revision: number) {
  const storage = getSessionStorage()
  const prefix = `${SESSION_PREFIX}${owner}:`
  const records: Array<{
    identity: AutoSignIdentity
    record: SessionWalletRecord
    wallet: DerivedWallet
  }> = []
  const discard = (key: string) => storage.removeItem(key)
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) {
    let record: SessionWalletRecord
    try {
      record = JSON.parse(storage.getItem(key) ?? "") as SessionWalletRecord
    } catch {
      discard(key)
      continue
    }
    if (
      record.schemaVersion !== SCHEMA_VERSION ||
      record.owner !== owner ||
      (record.state !== "active" && record.state !== "paused") ||
      record.revision !== revision ||
      (record.provenance !== "legacy-derived" && record.provenance !== "random") ||
      !record.chainId ||
      !record.bech32Prefix ||
      !record.origin ||
      !record.keyId
    ) {
      discard(key)
      continue
    }
    let privateKey: Uint8Array | undefined
    try {
      privateKey = fromBase64(record.privateKey)
      const wallet = await walletFromPrivateKey(privateKey, record.bech32Prefix)
      if (
        wallet.address !== record.address ||
        !equalBytes(wallet.publicKey, fromBase64(record.publicKey))
      ) {
        wallet.privateKey.fill(0)
        discard(key)
        continue
      }
      records.push({
        identity: {
          owner: record.owner,
          chainId: record.chainId,
          bech32Prefix: record.bech32Prefix,
          origin: record.origin,
        },
        record,
        wallet,
      })
      privateKey = undefined
    } catch {
      privateKey?.fill(0)
      discard(key)
    }
  }
  return records
}

async function handoffOwnerSessionWalletsToPersistent({
  identity,
  wallet,
  provenance,
  keyId,
  grant,
  preference,
  previous,
  isCurrent,
  options,
}: {
  identity: AutoSignIdentity
  wallet: DerivedWallet
  provenance: AutoSignKeyProvenance
  keyId: string
  grant: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration"> | undefined
  preference: AutoSignPreference
  previous: AutoSignPreference
  isCurrent: () => boolean
  options: SaveAutoSignWalletOptions
}) {
  const sessions = await ownerSessionWallets(identity.owner, previous.revision)
  try {
    const sessionSiblings = sessions.filter(
      ({ identity: candidate }) =>
        candidate.chainId !== identity.chainId || candidate.bech32Prefix !== identity.bech32Prefix,
    )
    const durableIdentities = await listAutoSignPublicIdentities(identity.owner, identity.origin)
    const liveDurableIdentities = durableIdentities.filter(
      (candidate) =>
        candidate.revision === previous.revision &&
        (candidate.state === "active" || candidate.state === "paused"),
    )
    const migrationError = (chainIds: string[]) =>
      new AutoSignStorageError(
        `Change Stay connected from the tab holding the current autosign key for ${[
          ...new Set(chainIds),
        ].join(", ")}, or use Settings > Forget this browser`,
      )
    const siblings: typeof sessions = []
    for (const session of sessionSiblings) {
      const durable = liveDurableIdentities.find((candidate) =>
        matchesIdentity(candidate, session.identity),
      )
      if (!durable) {
        const anyDurable = durableIdentities.some((candidate) =>
          matchesIdentity(candidate, session.identity),
        )
        if (!anyDurable) getSessionStorage().removeItem(sessionKey(session.identity))
        else if (session.record.provenance === "random") {
          throw migrationError([session.identity.chainId])
        }
        continue
      }
      const exactKey =
        durable.keyId === session.record.keyId &&
        durable.address === session.record.address &&
        durable.publicKey === session.record.publicKey
      if (!exactKey) {
        if (durable.provenance === "random") throw migrationError([durable.chainId])
        getSessionStorage().removeItem(sessionKey(session.identity))
        continue
      }
      siblings.push({
        ...session,
        record: {
          ...session.record,
          provenance: durable.provenance,
          state: durable.state,
          requestedDurationMs: durable.requestedDurationMs,
          observedExpiration: durable.observedExpiration,
        },
      })
    }
    const missingRandom = liveDurableIdentities.filter(
      (durable) =>
        durable.provenance === "random" &&
        !matchesIdentity(durable, identity) &&
        !siblings.some(
          ({ record }) =>
            matchesIdentity(record, durable) &&
            record.keyId === durable.keyId &&
            record.address === durable.address &&
            record.publicKey === durable.publicKey,
        ),
    )
    if (missingRandom.length) throw migrationError(missingRandom.map(({ chainId }) => chainId))
    const encrypted = await Promise.all([
      encryptWallet(identity, wallet, provenance, preference.revision, keyId, "active", grant),
      ...siblings.map(({ identity: sibling, record, wallet: siblingWallet }) =>
        encryptWallet(
          sibling,
          siblingWallet,
          record.provenance,
          preference.revision,
          record.keyId,
          record.state,
          {
            requestedDurationMs: record.requestedDurationMs,
            observedExpiration: record.observedExpiration,
          },
        ),
      ),
    ])
    await updatePersistent(async (store) => {
      if (!isCurrent()) throw new AutoSignCancelledError()
      await assertUnchangedPreference(store, identity, previous)
      const keys = await request(store.getAllKeys())
      const currentIdentities: AutoSignPublicIdentity[] = []
      for (const candidateKey of keys) {
        if (
          typeof candidateKey !== "string" ||
          !candidateKey.startsWith(`identity:${identity.owner}:`)
        ) {
          continue
        }
        const candidate = (await request(store.get(candidateKey))) as
          | AutoSignPublicIdentity
          | undefined
        if (
          candidate?.origin === identity.origin &&
          candidate.revision === previous.revision &&
          (candidate.state === "active" || candidate.state === "paused")
        ) {
          currentIdentities.push(candidate)
        }
      }
      const currentMissingRandom = currentIdentities.filter(
        (durable) =>
          durable.provenance === "random" &&
          !matchesIdentity(durable, identity) &&
          !siblings.some(
            ({ record }) =>
              matchesIdentity(record, durable) &&
              record.keyId === durable.keyId &&
              record.address === durable.address &&
              record.publicKey === durable.publicKey,
          ),
      )
      if (currentMissingRandom.length) {
        throw migrationError(currentMissingRandom.map(({ chainId }) => chainId))
      }
      if ("expectedPredecessor" in options) {
        await assertExpectedPredecessor(store, identity, options.expectedPredecessor)
      }
      await assertPendingConsumption(store, identity, options)
      await preserveReplacedForgottenIdentity(store, identity, encrypted[0].address)
      writePreference(store, identity, preference)
      store.put(encrypted[0], walletKey(encrypted[0]))
      store.put(toPublicIdentity(encrypted[0]), identityKey(encrypted[0]))
      for (const [index, { identity: sibling, record }] of siblings.entries()) {
        const publicIdentity = currentIdentities.find((candidate) =>
          matchesIdentity(candidate, sibling),
        )
        if (!publicIdentity) continue
        if (
          publicIdentity.keyId !== record.keyId ||
          publicIdentity.address !== record.address ||
          publicIdentity.publicKey !== record.publicKey
        ) {
          if (publicIdentity.provenance === "random") {
            throw migrationError([publicIdentity.chainId])
          }
          continue
        }
        if (
          publicIdentity.state !== record.state ||
          publicIdentity.provenance !== record.provenance
        ) {
          throw new AutoSignCancelledError()
        }
        const encryptedSibling = encrypted[index + 1]
        store.put(encryptedSibling, walletKey(encryptedSibling))
        store.put(toPublicIdentity(encryptedSibling), identityKey(encryptedSibling))
      }
      if (options.consumePendingKeyId) {
        store.delete(pendingWalletKey(identity, options.consumePendingKeyId))
        store.delete(pendingIdentityKey(identity, options.consumePendingKeyId))
      }
    })
    clearAutoSignOwnerSessionWallets(identity.owner)
  } finally {
    for (const { wallet: sessionWallet } of sessions) sessionWallet.privateKey.fill(0)
  }
}

function currentPreference(
  value: StoredPreference | undefined,
  owner: string,
  origin: string,
): AutoSignPreference {
  if (!value) {
    return { stayConnected: true, revision: 0, forgotten: false, explicit: false }
  }
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.owner !== "string" ||
    typeof value.origin !== "string" ||
    value.owner !== owner ||
    value.origin !== origin ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.stayConnected !== "boolean" ||
    typeof value.forgotten !== "boolean"
  ) {
    throw new AutoSignStorageError("Autosign storage data is invalid")
  }
  return {
    stayConnected: value.stayConnected,
    revision: value.revision,
    forgotten: value.forgotten,
    explicit: true,
  }
}

function writePreference(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
  preference: AutoSignPreference,
) {
  store.put(
    {
      ...preference,
      schemaVersion: SCHEMA_VERSION,
      owner: identity.owner,
      origin: identity.origin,
    },
    preferenceKey(identity.owner),
  )
}

async function assertUnchangedPreference(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
  previous: AutoSignPreference,
) {
  const current = currentPreference(
    (await request(store.get(preferenceKey(identity.owner)))) as StoredPreference | undefined,
    identity.owner,
    identity.origin,
  )
  if (current.revision !== previous.revision || current.explicit !== previous.explicit) {
    throw new AutoSignCancelledError()
  }
  return current
}

async function readCurrentIdentityKeyId(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
): Promise<string | null> {
  const current = (await request(store.get(identityKey(identity)))) as
    | AutoSignPublicIdentity
    | undefined
  if (!current) return null
  if (!matchesIdentity(current, identity) || !current.keyId) {
    throw new AutoSignStorageError("Autosign storage data is invalid")
  }
  return current.keyId
}

async function assertExpectedPredecessor(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
  expected: string | null | undefined,
) {
  const currentKeyId = await readCurrentIdentityKeyId(store, identity)
  if (currentKeyId !== (expected ?? null)) throw new AutoSignCancelledError()
}

async function ownerPendingIdentitiesInStore(
  store: IDBObjectStore,
  owner: string,
  origin: string,
  excludeKeyId?: string,
): Promise<AutoSignPublicIdentity[]> {
  const keys = await request(store.getAllKeys())
  const identities: AutoSignPublicIdentity[] = []
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith(`identity:${owner}:`)) continue
    const identity = (await request(store.get(key))) as AutoSignPublicIdentity | undefined
    if (
      identity?.owner === owner &&
      identity.origin === origin &&
      identity.state === "pending" &&
      identity.keyId !== excludeKeyId
    ) {
      identities.push(identity)
    }
  }
  return identities
}

export async function getAutoSignPreference(
  owner: string,
  origin: string,
): Promise<AutoSignPreference> {
  return currentPreference(
    await readPersistent<StoredPreference>(preferenceKey(owner)),
    owner,
    origin,
  )
}

async function encryptWallet(
  identity: AutoSignIdentity,
  wallet: DerivedWallet,
  provenance: AutoSignKeyProvenance,
  revision: number,
  keyId: string,
  state: AutoSignWalletState,
  grant?: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
  pending?: Pick<EncryptedWalletRecord, "supersedes">,
): Promise<EncryptedWalletRecord> {
  const crypto = getCrypto()
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const publicKey = toBase64(wallet.publicKey)
  const additionalData = new TextEncoder().encode(
    metadata(
      identity,
      wallet.address,
      publicKey,
      revision,
      keyId,
      state,
      grant?.requestedDurationMs,
      grant?.observedExpiration,
      pending?.supersedes,
    ),
  )
  const wrappingKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData },
    wrappingKey,
    new Uint8Array(wallet.privateKey),
  )

  return {
    ...identity,
    schemaVersion: SCHEMA_VERSION,
    address: wallet.address,
    publicKey,
    provenance,
    keyId,
    state,
    ...grant,
    revision,
    nonce: nonce.buffer.slice(0),
    ciphertext,
    wrappingKey,
    ...pending,
  }
}

async function decryptWallet(
  record: EncryptedWalletRecord,
): Promise<StoredAutoSignWallet | undefined> {
  try {
    if (
      record.schemaVersion !== SCHEMA_VERSION ||
      record.revision < 0 ||
      (record.provenance !== "legacy-derived" && record.provenance !== "random") ||
      (record.state !== "pending" && record.state !== "active" && record.state !== "paused") ||
      !record.wrappingKey
    ) {
      return undefined
    }
    const crypto = getCrypto()
    const additionalData = new TextEncoder().encode(
      metadata(
        record,
        record.address,
        record.publicKey,
        record.revision,
        record.keyId,
        record.state,
        record.requestedDurationMs,
        record.observedExpiration,
        record.supersedes,
      ),
    )
    const privateKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.nonce, additionalData },
        record.wrappingKey,
        record.ciphertext,
      ),
    )
    const wallet = await walletFromPrivateKey(privateKey, record.bech32Prefix)
    if (
      wallet.address !== record.address ||
      !equalBytes(wallet.publicKey, fromBase64(record.publicKey)) ||
      !equalBytes(wallet.privateKey, privateKey)
    ) {
      privateKey.fill(0)
      wallet.privateKey.fill(0)
      return undefined
    }
    return {
      ...wallet,
      provenance: record.provenance,
      revision: record.revision,
      keyId: record.keyId,
      state: record.state,
    }
  } catch {
    return undefined
  }
}

function parseSessionWallet(
  value: string | null,
  identity: AutoSignIdentity,
  revision: number,
): Promise<StoredAutoSignWallet | undefined> {
  if (!value) return Promise.resolve(undefined)
  try {
    const record = JSON.parse(value) as SessionWalletRecord
    if (
      record.schemaVersion !== SCHEMA_VERSION ||
      (record.provenance !== "legacy-derived" && record.provenance !== "random") ||
      record.state !== "active" ||
      !matchesIdentity(record, identity) ||
      record.revision !== revision
    ) {
      return Promise.resolve(undefined)
    }
    const privateKey = fromBase64(record.privateKey)
    return walletFromPrivateKey(privateKey, identity.bech32Prefix)
      .then((wallet) => {
        if (
          wallet.address !== record.address ||
          !equalBytes(wallet.publicKey, fromBase64(record.publicKey))
        ) {
          wallet.privateKey.fill(0)
          return undefined
        }
        return {
          ...wallet,
          provenance: record.provenance,
          revision: record.revision,
          keyId: record.keyId,
          state: record.state,
        }
      })
      .catch(() => {
        privateKey.fill(0)
        return undefined
      })
  } catch {
    return Promise.resolve(undefined)
  }
}

export async function loadAutoSignWallet(
  identity: AutoSignIdentity,
): Promise<StoredAutoSignWallet | undefined> {
  const preference = await getAutoSignPreference(identity.owner, identity.origin)
  if (!preference.stayConnected) {
    try {
      const wallet = await parseSessionWallet(
        getSessionStorage().getItem(sessionKey(identity)),
        identity,
        preference.revision,
      )
      if (!wallet) return undefined
      const publicIdentity = await getAutoSignPublicIdentity(identity)
      if (
        !isMatchingActivePublicIdentity(
          publicIdentity,
          identity,
          preference.revision,
          wallet.keyId,
        ) ||
        publicIdentity.address !== wallet.address ||
        publicIdentity.publicKey !== toBase64(wallet.publicKey)
      ) {
        wallet.privateKey.fill(0)
        return undefined
      }
      return wallet
    } catch (error) {
      if (error instanceof AutoSignStorageError) throw error
      return undefined
    }
  }

  const record = await readPersistent<EncryptedWalletRecord>(walletKey(identity))
  if (!record || record.revision !== preference.revision || record.state !== "active")
    return undefined
  if (!matchesIdentity(record, identity)) {
    return undefined
  }
  return decryptWallet(record)
}

interface SaveAutoSignWalletOptions {
  expectedRevision?: number
  expectedPredecessor?: string | null
  consumePendingKeyId?: string
  pendingRecord?: EncryptedWalletRecord
}

async function assertPendingConsumption(
  store: IDBObjectStore,
  identity: AutoSignIdentity,
  options: SaveAutoSignWalletOptions,
) {
  if (!options.consumePendingKeyId || !options.pendingRecord) return
  const keyId = options.consumePendingKeyId
  const current = (await request(store.get(pendingWalletKey(identity, keyId)))) as
    | EncryptedWalletRecord
    | undefined
  const pendingIdentity = (await request(store.get(pendingIdentityKey(identity, keyId)))) as
    | AutoSignPublicIdentity
    | undefined
  if (
    !current ||
    current.keyId !== keyId ||
    current.state !== "pending" ||
    current.address !== options.pendingRecord.address ||
    current.publicKey !== options.pendingRecord.publicKey ||
    current.supersedes !== options.pendingRecord.supersedes ||
    !equalBytes(
      new Uint8Array(current.ciphertext),
      new Uint8Array(options.pendingRecord.ciphertext),
    ) ||
    !isExactAutoSignPublicIdentity(pendingIdentity, identity, keyId) ||
    pendingIdentity.state !== "pending" ||
    pendingIdentity.address !== current.address ||
    pendingIdentity.publicKey !== current.publicKey
  ) {
    throw new AutoSignCancelledError()
  }
}

export async function saveAutoSignWallet(
  identity: AutoSignIdentity,
  wallet: DerivedWallet,
  mode: Exclude<AutoSignStorageMode, "memory">,
  isCurrent: () => boolean = () => true,
  existing?: AutoSignPublicIdentity,
  options: SaveAutoSignWalletOptions = {},
): Promise<AutoSignPreference> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const previous = await getAutoSignPreference(identity.owner, identity.origin)
  if (options.expectedRevision !== undefined && previous.revision !== options.expectedRevision) {
    throw new AutoSignCancelledError()
  }
  if (mode === "session" && previous.stayConnected) {
    const pending = (await listOwnerPendingIdentities(identity.owner, identity.origin)).filter(
      (candidate) => candidate.keyId !== options.consumePendingKeyId,
    )
    if (pending.length) {
      throw new AutoSignPendingResolutionError(pending.map(({ chainId }) => chainId))
    }
  }
  const changingMode = previous.stayConnected !== (mode === "persistent") || !previous.explicit
  const preference: AutoSignPreference = {
    stayConnected: mode === "persistent",
    revision: changingMode ? previous.revision + 1 : previous.revision,
    forgotten: false,
    explicit: true,
  }
  const keyId = existing?.keyId ?? createKeyId()
  const provenance = existing?.provenance ?? "legacy-derived"
  const grant = existing && {
    requestedDurationMs: existing.requestedDurationMs,
    observedExpiration: existing.observedExpiration,
  }

  if (mode === "session") {
    const sessionRecord = {
      ...toSessionRecord(identity, wallet, keyId, "active", preference.revision, grant),
      provenance,
    }
    const storage = getSessionStorage()
    const key = sessionKey(identity)
    const original = storage.getItem(key)
    let serialized: string | undefined
    let handoff: Array<{ previous: EncryptedWalletRecord; record: SessionWalletRecord }> = []
    try {
      if (previous.stayConnected) {
        handoff = await handoffOwnerWalletsToSession(identity.owner, preference.revision, isCurrent)
      }
      serialized = writeSessionRecord(identity, sessionRecord)
      if (!isCurrent()) throw new AutoSignCancelledError()
      await updatePersistent(async (store) => {
        if (!isCurrent()) throw new AutoSignCancelledError()
        await assertUnchangedPreference(store, identity, previous)
        if (mode === "session" && previous.stayConnected) {
          const pending = await ownerPendingIdentitiesInStore(
            store,
            identity.owner,
            identity.origin,
            options.consumePendingKeyId,
          )
          if (pending.length) {
            throw new AutoSignPendingResolutionError(pending.map(({ chainId }) => chainId))
          }
        }
        if ("expectedPredecessor" in options) {
          await assertExpectedPredecessor(store, identity, options.expectedPredecessor)
        }
        await assertPendingConsumption(store, identity, options)
        await preserveReplacedForgottenIdentity(store, identity, sessionRecord.address)
        for (const migrated of handoff) {
          if (matchesIdentity(migrated.record, identity)) continue
          const publicIdentity = (await request(store.get(identityKey(migrated.record)))) as
            | AutoSignPublicIdentity
            | undefined
          if (
            !isExactAutoSignPublicIdentity(
              publicIdentity,
              migrated.record,
              migrated.record.keyId,
            ) ||
            publicIdentity.revision !== migrated.previous.revision ||
            publicIdentity.state !== migrated.previous.state ||
            publicIdentity.address !== migrated.previous.address ||
            publicIdentity.publicKey !== migrated.previous.publicKey ||
            publicIdentity.provenance !== migrated.previous.provenance
          ) {
            throw new AutoSignCancelledError()
          }
        }
        writePreference(store, identity, preference)
        for (const migrated of handoff) {
          if (!matchesIdentity(migrated.record, identity)) {
            store.put(toPublicIdentity(migrated.record), identityKey(migrated.record))
          }
        }
        store.put(toPublicIdentity(sessionRecord), identityKey(identity))
        if (previous.stayConnected) {
          await markOwnerPendingIdentitiesForgotten(store, identity.owner, isCurrent)
          if (!isCurrent()) throw new AutoSignCancelledError()
          await deleteOwnerWallets(store, identity.owner)
        }
        if (options.consumePendingKeyId) {
          store.delete(pendingWalletKey(identity, options.consumePendingKeyId))
          store.delete(pendingIdentityKey(identity, options.consumePendingKeyId))
        }
      })
    } catch (error) {
      const shouldRestoreOriginal =
        previous.stayConnected || (!!serialized && storage.getItem(key) === serialized)
      if (previous.stayConnected) {
        try {
          clearAutoSignOwnerSessionWallets(identity.owner)
        } catch {
          // Preserve the original handoff failure when session storage is unavailable.
        }
      }
      if (shouldRestoreOriginal) {
        if (original === null) storage.removeItem(key)
        else storage.setItem(key, original)
      }
      if (
        error instanceof AutoSignStorageError ||
        error instanceof AutoSignCancelledError ||
        error instanceof AutoSignPendingResolutionError
      )
        throw error
      throw new AutoSignStorageError()
    }
    return preference
  }

  if (!previous.stayConnected) {
    await handoffOwnerSessionWalletsToPersistent({
      identity,
      wallet,
      provenance,
      keyId,
      grant,
      preference,
      previous,
      isCurrent,
      options,
    })
  } else {
    const encrypted = await encryptWallet(
      identity,
      wallet,
      provenance,
      preference.revision,
      keyId,
      "active",
      grant,
    )
    await updatePersistent(async (store) => {
      if (!isCurrent()) throw new AutoSignCancelledError()
      await assertUnchangedPreference(store, identity, previous)
      if ("expectedPredecessor" in options) {
        await assertExpectedPredecessor(store, identity, options.expectedPredecessor)
      }
      await assertPendingConsumption(store, identity, options)
      await preserveReplacedForgottenIdentity(store, identity, encrypted.address)
      writePreference(store, identity, preference)
      store.put(encrypted, walletKey(identity))
      store.put(toPublicIdentity(encrypted), identityKey(identity))
      if (options.consumePendingKeyId) {
        store.delete(pendingWalletKey(identity, options.consumePendingKeyId))
        store.delete(pendingIdentityKey(identity, options.consumePendingKeyId))
      }
    })
  }
  if (typeof navigator !== "undefined") {
    void navigator.storage?.persist?.().catch(() => undefined)
  }
  return preference
}

export async function getAutoSignPublicIdentity(
  identity: AutoSignIdentity,
): Promise<AutoSignPublicIdentity | undefined> {
  const value = await readPersistent<AutoSignPublicIdentity>(identityKey(identity))
  if (!value || !matchesIdentity(value, identity) || !value.address || !value.keyId) {
    return undefined
  }
  return value
}

export async function listAutoSignPublicIdentities(
  owner: string,
  origin: string,
): Promise<AutoSignPublicIdentity[]> {
  try {
    const database = await getDatabase()
    const transaction = database.transaction(STORE_NAME, "readonly")
    const store = transaction.objectStore(STORE_NAME)
    const keys = await request(store.getAllKeys())
    const identities = await Promise.all(
      keys
        .filter(
          (key): key is string => typeof key === "string" && key.startsWith(`identity:${owner}:`),
        )
        .map(async (key) => (await request(store.get(key))) as AutoSignPublicIdentity | undefined),
    )
    await transactionDone(transaction)
    return identities.filter(
      (identity): identity is AutoSignPublicIdentity => !!identity && identity.origin === origin,
    )
  } catch {
    throw new AutoSignStorageError()
  }
}

export async function listOwnerPendingIdentities(
  owner: string,
  origin: string,
): Promise<AutoSignPublicIdentity[]> {
  return (await listAutoSignPublicIdentities(owner, origin)).filter(
    (identity) => identity.state === "pending",
  )
}

/** Public compatibility inventory for historical localStorage mirrors, including unconfigured chains. */
export function listLegacyAutoSignIdentities(owner: string): LegacyAutoSignIdentity[] {
  if (typeof window === "undefined") return []
  try {
    const prefix = `autosign:${owner}:`
    const identities: LegacyAutoSignIdentity[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const address = window.localStorage.getItem(key)
      const chainId = key.slice(prefix.length)
      if (address && chainId) {
        identities.push({ owner, chainId, address, provenance: "legacy-derived" })
      }
    }
    return identities
  } catch {
    return []
  }
}

export async function createPendingRandomAutoSignWallet(
  identity: AutoSignIdentity,
  wallet: DerivedWallet,
  isCurrent: () => boolean = () => true,
): Promise<StoredAutoSignWallet> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const previous = await getAutoSignPreference(identity.owner, identity.origin)
  const supersedes = (await getAutoSignPublicIdentity(identity))?.keyId ?? null
  const keyId = createKeyId()
  const encrypted = await encryptWallet(
    identity,
    wallet,
    "random",
    previous.revision,
    keyId,
    "pending",
    undefined,
    {
      supersedes,
    },
  )
  await updatePersistent(async (store) => {
    if (!isCurrent()) throw new AutoSignCancelledError()
    await assertUnchangedPreference(store, identity, previous)
    await assertExpectedPredecessor(store, identity, supersedes)
    store.put(encrypted, pendingWalletKey(identity, keyId))
    store.put(toPublicIdentity(encrypted), pendingIdentityKey(identity, keyId))
  })
  return { ...wallet, provenance: "random", revision: previous.revision, keyId, state: "pending" }
}

export async function discardPendingAutoSignWallet(
  identity: AutoSignIdentity,
  keyId: string,
): Promise<void> {
  await updatePersistent(async (store) => {
    const pending = (await request(store.get(pendingWalletKey(identity, keyId)))) as
      | EncryptedWalletRecord
      | undefined
    if (!pending || pending.keyId !== keyId || pending.state !== "pending") return
    store.delete(pendingWalletKey(identity, keyId))
    store.delete(pendingIdentityKey(identity, keyId))
  })
}

export async function activatePendingAutoSignWallet(
  identity: AutoSignIdentity,
  keyId: string,
  options: {
    mode?: Exclude<AutoSignStorageMode, "memory">
    isCurrent?: () => boolean
  } = {},
): Promise<{
  revision: number
  keyId: string
  mode: Exclude<AutoSignStorageMode, "memory">
}> {
  const isCurrent = options.isCurrent ?? (() => true)
  if (!isCurrent()) throw new AutoSignCancelledError()
  const pending = await readPersistent<EncryptedWalletRecord>(pendingWalletKey(identity, keyId))
  if (!pending || pending.keyId !== keyId || pending.state !== "pending") {
    throw new AutoSignCancelledError()
  }
  const wallet = await decryptWallet(pending)
  if (!wallet) throw new AutoSignStorageError("Autosign stored key could not be recovered")
  try {
    if (!isCurrent()) throw new AutoSignCancelledError()
    const pendingIdentity = await readPersistent<AutoSignPublicIdentity>(
      pendingIdentityKey(identity, keyId),
    )
    if (
      !isExactAutoSignPublicIdentity(pendingIdentity, identity, keyId) ||
      pendingIdentity.state !== "pending" ||
      pendingIdentity.address !== pending.address ||
      pendingIdentity.publicKey !== pending.publicKey ||
      wallet.address !== pendingIdentity.address
    ) {
      throw new AutoSignCancelledError()
    }
    const previous = await getAutoSignPreference(identity.owner, identity.origin)
    if (!options.mode && previous.forgotten) throw new AutoSignCancelledError()
    const mode = options.mode ?? (previous.stayConnected ? "persistent" : "session")
    const preference = await saveAutoSignWallet(
      identity,
      wallet,
      mode,
      isCurrent,
      pendingIdentity,
      {
        expectedRevision: previous.revision,
        expectedPredecessor: pending.supersedes,
        consumePendingKeyId: keyId,
        pendingRecord: pending,
      },
    )
    return { revision: preference.revision, keyId, mode }
  } finally {
    wallet.privateKey.fill(0)
  }
}

/** Permanently removes a locally held signer after an on-chain revoke succeeds. */
export async function deleteAutoSignWallet(
  identity: AutoSignIdentity,
  keyId: string,
): Promise<void> {
  let deleted = false
  await updatePersistent(async (store) => {
    const existingWallet = (await request(store.get(walletKey(identity)))) as
      | EncryptedWalletRecord
      | undefined
    const existingIdentity = (await request(store.get(identityKey(identity)))) as
      | AutoSignPublicIdentity
      | undefined
    if (existingWallet?.keyId === keyId) {
      store.delete(walletKey(identity))
      deleted = true
    }
    const pendingWallet = (await request(store.get(pendingWalletKey(identity, keyId)))) as
      | EncryptedWalletRecord
      | undefined
    const pendingIdentity = (await request(store.get(pendingIdentityKey(identity, keyId)))) as
      | AutoSignPublicIdentity
      | undefined
    if (pendingWallet?.keyId === keyId && pendingWallet.state === "pending") {
      store.delete(pendingWalletKey(identity, keyId))
      deleted = true
    }
    if (isExactAutoSignPublicIdentity(pendingIdentity, identity, keyId)) {
      store.delete(pendingIdentityKey(identity, keyId))
      deleted = true
    }
    // Tab-scoped signers have no durable wallet ciphertext, but their public
    // identity still has to disappear after the matching on-chain revoke.
    if (isExactAutoSignPublicIdentity(existingIdentity, identity, keyId)) {
      store.delete(identityKey(identity))
      deleted = true
    }
  })
  try {
    const storage = getSessionStorage()
    const key = sessionKey(identity)
    const value = storage.getItem(key)
    if (value && (JSON.parse(value) as SessionWalletRecord).keyId === keyId) {
      storage.removeItem(key)
      deleted = true
    }
  } catch (error) {
    if (!deleted) throw error
  }
}

export async function setAutoSignWalletState(
  identity: AutoSignIdentity,
  keyId: string,
  state: Extract<AutoSignWalletState, "active" | "paused">,
  grant?: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const preference = await getAutoSignPreference(identity.owner, identity.origin)
  if (!preference.stayConnected) {
    const storage = getSessionStorage()
    const key = sessionKey(identity)
    const original = storage.getItem(key)
    let record: SessionWalletRecord | undefined
    try {
      record = JSON.parse(original ?? "") as SessionWalletRecord
    } catch {
      record = undefined
    }
    const hasMatchingSession =
      !!record &&
      record.schemaVersion === SCHEMA_VERSION &&
      matchesIdentity(record, identity) &&
      record.keyId === keyId &&
      record.revision === preference.revision &&
      (record.state === "active" || record.state === "paused")
    const updated = hasMatchingSession
      ? { ...record!, state, ...mergeAutoSignObservation(record!, grant) }
      : undefined
    const serialized = updated ? JSON.stringify(updated) : undefined
    if (serialized) {
      if (!isCurrent()) throw new AutoSignCancelledError()
      storage.setItem(key, serialized)
      if (storage.getItem(key) !== serialized) throw new AutoSignStorageError()
    }
    let pendingOnly = false
    try {
      await updatePersistent(async (store) => {
        if (!isCurrent()) throw new AutoSignCancelledError()
        const latest = await assertUnchangedPreference(store, identity, preference)
        if (latest.stayConnected) throw new AutoSignCancelledError()
        const publicIdentity = (await request(store.get(identityKey(identity)))) as
          | AutoSignPublicIdentity
          | undefined
        if (
          !isExactAutoSignPublicIdentity(publicIdentity, identity, keyId) ||
          publicIdentity.revision !== preference.revision ||
          (publicIdentity.state !== "active" && publicIdentity.state !== "paused")
        ) {
          const pending = (await request(store.get(pendingWalletKey(identity, keyId)))) as
            | EncryptedWalletRecord
            | undefined
          if (pending?.keyId === keyId && pending.state === "pending") {
            pendingOnly = true
            return
          }
          throw new AutoSignCancelledError()
        }
        store.put(
          { ...publicIdentity, state, ...mergeAutoSignObservation(publicIdentity, grant) },
          identityKey(identity),
        )
      })
      if (!isCurrent()) throw new AutoSignCancelledError()
      if (pendingOnly && serialized && storage.getItem(key) === serialized) {
        if (original === null) storage.removeItem(key)
        else storage.setItem(key, original)
      }
      return !pendingOnly
    } catch (error) {
      if (serialized && storage.getItem(key) === serialized) {
        if (original === null) storage.removeItem(key)
        else storage.setItem(key, original)
      }
      throw error
    }
  }

  const existing = await readPersistent<EncryptedWalletRecord>(walletKey(identity))
  if (!existing || existing.keyId !== keyId) {
    const pending = await readPersistent<EncryptedWalletRecord>(pendingWalletKey(identity, keyId))
    if (pending?.keyId === keyId && pending.state === "pending") return false
    throw new AutoSignCancelledError()
  }
  const wallet = await decryptWallet(existing)
  if (!wallet) throw new AutoSignStorageError("Autosign stored key could not be recovered")
  try {
    if (!isCurrent()) throw new AutoSignCancelledError()
    const updated = await encryptWallet(
      identity,
      wallet,
      wallet.provenance,
      existing.revision,
      existing.keyId,
      state,
      mergeAutoSignObservation(existing, grant),
    )
    if (!isCurrent()) throw new AutoSignCancelledError()
    await updatePersistent(async (store) => {
      if (!isCurrent()) throw new AutoSignCancelledError()
      const record = (await request(store.get(walletKey(identity)))) as
        | EncryptedWalletRecord
        | undefined
      if (!record || record.keyId !== keyId) throw new AutoSignCancelledError()
      if (
        record.revision !== existing.revision ||
        !equalBytes(new Uint8Array(record.ciphertext), new Uint8Array(existing.ciphertext))
      ) {
        throw new AutoSignCancelledError()
      }
      store.put(updated, walletKey(identity))
      store.put(toPublicIdentity(updated), identityKey(identity))
    })
    return true
  } finally {
    wallet.privateKey.fill(0)
  }
}

/** Records the grant lifetime for either durable or tab-scoped active signers. */
export async function updateAutoSignWalletObservation(
  identity: AutoSignIdentity,
  keyId: string,
  observation: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration">,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const preference = await getAutoSignPreference(identity.owner, identity.origin)
  if (preference.stayConnected) {
    await setAutoSignWalletState(identity, keyId, "active", observation, isCurrent)
    return
  }

  const storage = getSessionStorage()
  const key = sessionKey(identity)
  const original = storage.getItem(key)
  let record: SessionWalletRecord
  try {
    record = JSON.parse(original ?? "") as SessionWalletRecord
  } catch {
    throw new AutoSignCancelledError()
  }
  if (!isMatchingActiveSessionRecord(record, identity, preference.revision, keyId)) {
    throw new AutoSignCancelledError()
  }
  const grant = mergeAutoSignObservation(record, observation)
  const updated = { ...record, ...grant }
  const serialized = JSON.stringify(updated)
  if (!isCurrent()) throw new AutoSignCancelledError()
  storage.setItem(key, serialized)
  if (storage.getItem(key) !== serialized) throw new AutoSignStorageError()

  try {
    await updatePersistent(async (store) => {
      if (!isCurrent()) throw new AutoSignCancelledError()
      const latestPreference = await assertUnchangedPreference(store, identity, preference)
      if (latestPreference.stayConnected) {
        throw new AutoSignCancelledError()
      }
      const publicIdentity = (await request(store.get(identityKey(identity)))) as
        | AutoSignPublicIdentity
        | undefined
      if (!isMatchingActivePublicIdentity(publicIdentity, identity, preference.revision, keyId)) {
        throw new AutoSignCancelledError()
      }
      store.put({ ...publicIdentity, ...grant }, identityKey(identity))
    })
    if (!isCurrent()) throw new AutoSignCancelledError()
  } catch (error) {
    // Session storage is scoped to this tab. Roll back only our exact write if
    // the durable identity fence rejects the observation.
    if (storage.getItem(key) === serialized) {
      if (original === null) storage.removeItem(key)
      else storage.setItem(key, original)
    }
    throw error
  }
}

export async function setAutoSignStayConnected(
  identity: AutoSignIdentity,
  wallet: DerivedWallet | undefined,
  stayConnected: boolean,
  isCurrent?: () => boolean,
  expectedRevision?: number,
): Promise<AutoSignPreference> {
  if (!stayConnected && !wallet) {
    const current = await getAutoSignPreference(identity.owner, identity.origin)
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new AutoSignCancelledError()
    }
    if (!current.stayConnected) return current
    throw new Error("Unlock autosign before turning off Stay connected")
  }
  if (!wallet) throw new Error("Unlock autosign before enabling Stay connected")
  const existing = await getAutoSignPublicIdentity(identity)
  return saveAutoSignWallet(
    identity,
    wallet,
    stayConnected ? "persistent" : "session",
    isCurrent,
    existing?.address === wallet.address ? existing : undefined,
    { expectedRevision },
  )
}

export async function forgetAutoSignWallet(
  identity: AutoSignIdentity,
): Promise<AutoSignPreference> {
  const current = await getAutoSignPreference(identity.owner, identity.origin)
  const preference: AutoSignPreference = {
    stayConnected: false,
    revision: current.revision + 1,
    forgotten: true,
    explicit: true,
  }
  await updatePersistent(async (store) => {
    await assertUnchangedPreference(store, identity, current)
    writePreference(store, identity, preference)
    await Promise.all([
      deleteOwnerWallets(store, identity.owner),
      markOwnerIdentitiesForgotten(store, identity.owner),
    ])
  })
  try {
    clearAutoSignOwnerSessionWallets(identity.owner)
  } catch {
    // The durable tombstone remains authoritative even if this tab cannot remove its session copy.
  }
  return preference
}
