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

function preferenceKey(owner: string) {
  return `preference:${owner}`
}

function walletKey(identity: AutoSignIdentity) {
  return `wallet:${identity.owner}:${identity.chainId}:${identity.bech32Prefix}`
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

function toPublicIdentity(record: EncryptedWalletRecord): AutoSignPublicIdentity {
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
    if (error instanceof AutoSignStorageError || error instanceof AutoSignCancelledError)
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
    if (error instanceof AutoSignStorageError || error instanceof AutoSignCancelledError)
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
    record.owner === identity.owner &&
    record.chainId === identity.chainId &&
    record.bech32Prefix === identity.bech32Prefix &&
    record.origin === identity.origin &&
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
  return (
    !!value &&
    value.owner === identity.owner &&
    value.chainId === identity.chainId &&
    value.bech32Prefix === identity.bech32Prefix &&
    value.origin === identity.origin &&
    value.keyId === keyId
  )
}

function isMatchingActivePublicIdentity(
  value: AutoSignPublicIdentity | undefined,
  identity: AutoSignIdentity,
  revision: number,
  keyId: string,
): value is AutoSignPublicIdentity {
  return (
    !!value &&
    value.owner === identity.owner &&
    value.chainId === identity.chainId &&
    value.bech32Prefix === identity.bech32Prefix &&
    value.origin === identity.origin &&
    value.keyId === keyId &&
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
      writeSessionRecord(
        record,
        toSessionRecord(record, wallet, record.keyId, record.state, revision, {
          requestedDurationMs: record.requestedDurationMs,
          observedExpiration: record.observedExpiration,
        }),
      )
    } finally {
      wallet.privateKey.fill(0)
    }
  }
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
}: {
  identity: AutoSignIdentity
  wallet: DerivedWallet
  provenance: AutoSignKeyProvenance
  keyId: string
  grant: Pick<AutoSignPublicIdentity, "requestedDurationMs" | "observedExpiration"> | undefined
  preference: AutoSignPreference
  previous: AutoSignPreference
  isCurrent: () => boolean
}) {
  const sessions = await ownerSessionWallets(identity.owner, previous.revision)
  const siblings = sessions.filter(
    ({ identity: candidate }) =>
      candidate.chainId !== identity.chainId || candidate.bech32Prefix !== identity.bech32Prefix,
  )
  try {
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
      const current = currentPreference(
        (await request(store.get(preferenceKey(identity.owner)))) as StoredPreference | undefined,
        identity.owner,
        identity.origin,
      )
      if (current.revision !== previous.revision || current.explicit !== previous.explicit) {
        throw new AutoSignCancelledError()
      }
      store.put(
        {
          ...preference,
          schemaVersion: SCHEMA_VERSION,
          owner: identity.owner,
          origin: identity.origin,
        },
        preferenceKey(identity.owner),
      )
      for (const record of encrypted) {
        store.put(record, walletKey(record))
        store.put(toPublicIdentity(record), identityKey(record))
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
      record.owner !== identity.owner ||
      record.chainId !== identity.chainId ||
      record.bech32Prefix !== identity.bech32Prefix ||
      record.origin !== identity.origin ||
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
      return await parseSessionWallet(
        getSessionStorage().getItem(sessionKey(identity)),
        identity,
        preference.revision,
      )
    } catch (error) {
      if (error instanceof AutoSignStorageError) throw error
      return undefined
    }
  }

  const record = await readPersistent<EncryptedWalletRecord>(walletKey(identity))
  if (!record || record.revision !== preference.revision || record.state !== "active")
    return undefined
  if (
    record.owner !== identity.owner ||
    record.chainId !== identity.chainId ||
    record.bech32Prefix !== identity.bech32Prefix ||
    record.origin !== identity.origin
  ) {
    return undefined
  }
  return decryptWallet(record)
}

export async function saveAutoSignWallet(
  identity: AutoSignIdentity,
  wallet: DerivedWallet,
  mode: Exclude<AutoSignStorageMode, "memory">,
  isCurrent: () => boolean = () => true,
  existing?: AutoSignPublicIdentity,
): Promise<AutoSignPreference> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const previous = await getAutoSignPreference(identity.owner, identity.origin)
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

  const assertUnchangedPreference = async (store: IDBObjectStore) => {
    if (!isCurrent()) throw new AutoSignCancelledError()
    const current = currentPreference(
      (await request(store.get(preferenceKey(identity.owner)))) as StoredPreference | undefined,
      identity.owner,
      identity.origin,
    )
    if (current.revision !== previous.revision || current.explicit !== previous.explicit) {
      throw new AutoSignCancelledError()
    }
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
    try {
      if (previous.stayConnected) {
        await handoffOwnerWalletsToSession(identity.owner, preference.revision, isCurrent)
      }
      serialized = writeSessionRecord(identity, sessionRecord)
      if (!isCurrent()) throw new AutoSignCancelledError()
      await updatePersistent(async (store) => {
        await assertUnchangedPreference(store)
        await preserveReplacedForgottenIdentity(store, identity, sessionRecord.address)
        store.put(
          {
            ...preference,
            schemaVersion: SCHEMA_VERSION,
            owner: identity.owner,
            origin: identity.origin,
          },
          preferenceKey(identity.owner),
        )
        store.put(
          {
            ...identity,
            address: sessionRecord.address,
            publicKey: sessionRecord.publicKey,
            provenance: sessionRecord.provenance,
            keyId: sessionRecord.keyId,
            state: sessionRecord.state,
            revision: sessionRecord.revision,
            requestedDurationMs: sessionRecord.requestedDurationMs,
            observedExpiration: sessionRecord.observedExpiration,
          } satisfies AutoSignPublicIdentity,
          identityKey(identity),
        )
        if (previous.stayConnected) {
          await markOwnerPendingIdentitiesForgotten(store, identity.owner, isCurrent)
          if (!isCurrent()) throw new AutoSignCancelledError()
          await deleteOwnerWallets(store, identity.owner)
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
      if (error instanceof AutoSignStorageError || error instanceof AutoSignCancelledError)
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
      await assertUnchangedPreference(store)
      await preserveReplacedForgottenIdentity(store, identity, encrypted.address)
      store.put(
        {
          ...preference,
          schemaVersion: SCHEMA_VERSION,
          owner: identity.owner,
          origin: identity.origin,
        },
        preferenceKey(identity.owner),
      )
      store.put(encrypted, walletKey(identity))
      store.put(toPublicIdentity(encrypted), identityKey(identity))
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
  if (
    !value ||
    value.owner !== identity.owner ||
    value.chainId !== identity.chainId ||
    value.bech32Prefix !== identity.bech32Prefix ||
    value.origin !== identity.origin ||
    !value.address ||
    !value.keyId
  ) {
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
  // Creating a random candidate is an explicit Stay connected choice. A pending
  // record must be readable after the grant succeeds, including after Forget or
  // an earlier tab-only preference.
  const preference: AutoSignPreference = previous.stayConnected
    ? previous
    : {
        stayConnected: true,
        revision: previous.revision + 1,
        forgotten: false,
        explicit: true,
      }
  const sessions = previous.stayConnected
    ? []
    : await ownerSessionWallets(identity.owner, previous.revision)
  const keyId = createKeyId()
  try {
    const [encrypted, ...migratedSessions] = await Promise.all([
      encryptWallet(identity, wallet, "random", preference.revision, keyId, "pending"),
      ...sessions.map(({ identity: sessionIdentity, record, wallet: sessionWallet }) =>
        encryptWallet(
          sessionIdentity,
          sessionWallet,
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
      const current = currentPreference(
        (await request(store.get(preferenceKey(identity.owner)))) as StoredPreference | undefined,
        identity.owner,
        identity.origin,
      )
      if (current.revision !== previous.revision || current.explicit !== previous.explicit) {
        throw new AutoSignCancelledError()
      }
      if (!current.stayConnected) {
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
      for (const migrated of migratedSessions) {
        store.put(migrated, walletKey(migrated))
        store.put(toPublicIdentity(migrated), identityKey(migrated))
      }
      store.put(encrypted, pendingWalletKey(identity, keyId))
      store.put(toPublicIdentity(encrypted), pendingIdentityKey(identity, keyId))
    })
    if (sessions.length) clearAutoSignOwnerSessionWallets(identity.owner)
  } finally {
    for (const { wallet: sessionWallet } of sessions) sessionWallet.privateKey.fill(0)
  }
  return { ...wallet, provenance: "random", revision: preference.revision, keyId, state: "pending" }
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
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const pending = await readPersistent<EncryptedWalletRecord>(pendingWalletKey(identity, keyId))
  if (!pending || pending.keyId !== keyId || pending.state !== "pending") {
    throw new AutoSignCancelledError()
  }
  const wallet = await decryptWallet(pending)
  if (!wallet) throw new AutoSignStorageError("Autosign stored key could not be recovered")
  if (!isCurrent()) {
    wallet.privateKey.fill(0)
    throw new AutoSignCancelledError()
  }
  const active = await encryptWallet(
    identity,
    wallet,
    "random",
    pending.revision,
    pending.keyId,
    "active",
  )
  wallet.privateKey.fill(0)
  await updatePersistent(async (store) => {
    if (!isCurrent()) throw new AutoSignCancelledError()
    const current = (await request(store.get(pendingWalletKey(identity, keyId)))) as
      | EncryptedWalletRecord
      | undefined
    if (!current || current.keyId !== keyId || current.state !== "pending") {
      throw new AutoSignCancelledError()
    }
    store.put(active, walletKey(identity))
    store.put(toPublicIdentity(active), identityKey(identity))
    store.delete(pendingWalletKey(identity, keyId))
    store.delete(pendingIdentityKey(identity, keyId))
  })
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
): Promise<void> {
  if (!isCurrent()) throw new AutoSignCancelledError()
  const existing = await readPersistent<EncryptedWalletRecord>(walletKey(identity))
  if (!existing || existing.keyId !== keyId) throw new AutoSignCancelledError()
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
      const latestPreference = currentPreference(
        (await request(store.get(preferenceKey(identity.owner)))) as StoredPreference | undefined,
        identity.owner,
        identity.origin,
      )
      if (
        latestPreference.stayConnected ||
        latestPreference.revision !== preference.revision ||
        latestPreference.explicit !== preference.explicit
      ) {
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
): Promise<AutoSignPreference> {
  if (!stayConnected && !wallet) {
    const current = await getAutoSignPreference(identity.owner, identity.origin)
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
  try {
    clearAutoSignOwnerSessionWallets(identity.owner)
  } catch {
    // The durable tombstone remains authoritative even if this tab cannot remove its session copy.
  }
  await updatePersistent((store) => {
    return request(store.get(preferenceKey(identity.owner))).then((value) => {
      const latest = currentPreference(
        value as StoredPreference | undefined,
        identity.owner,
        identity.origin,
      )
      if (latest.revision !== current.revision || latest.explicit !== current.explicit) {
        throw new AutoSignCancelledError()
      }
      store.put(
        {
          ...preference,
          schemaVersion: SCHEMA_VERSION,
          owner: identity.owner,
          origin: identity.origin,
        },
        preferenceKey(identity.owner),
      )
      return Promise.all([
        deleteOwnerWallets(store, identity.owner),
        markOwnerIdentitiesForgotten(store, identity.owner),
      ]).then(() => undefined)
    })
  })
  return preference
}
