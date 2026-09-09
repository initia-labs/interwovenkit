import type {
  AccountData,
  Algo,
  AminoSignResponse,
  OfflineAminoSigner,
  StdFee,
  StdSignDoc,
} from "@cosmjs/amino"
import { escapeCharacters, sortedJsonStringify } from "@cosmjs/amino/build/signdoc"
import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex } from "@cosmjs/encoding"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { ethers } from "ethers"
import type { Hex } from "viem"
import { useSignMessage } from "wagmi"
import { useEffect, useRef } from "react"
import { useStore } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { recoverPublicKey, storePublicKey } from "@/data/public-key"
import { useInitiaAddress } from "@/public/data/hooks"
import {
  createRandomWallet,
  deriveWalletFromSignature,
  getAutoSignMessage,
  getDerivedWalletKey,
} from "./derivation"
import {
  assertAutoSignRevision,
  AutoSignCancelledError,
  broadcastAutoSignEvent,
  subscribeAutoSignEvents,
  withAutoSignOperation,
} from "./lifecycle"
import {
  activatePendingAutoSignWallet,
  type AutoSignIdentity,
  type AutoSignPublicIdentity,
  type AutoSignStorageMode,
  clearAutoSignOwnerSessionWallets,
  createPendingRandomAutoSignWallet,
  deleteAutoSignWallet,
  discardPendingAutoSignWallet,
  forgetAutoSignWallet,
  getAutoSignPreference,
  getAutoSignPublicIdentity,
  listAutoSignPublicIdentities,
  loadAutoSignWallet,
  saveAutoSignWallet,
  setAutoSignStayConnected,
  setAutoSignWalletState,
  type StoredAutoSignWallet,
  updateAutoSignWalletObservation,
} from "./storage"
import {
  activeWalletOwnerAtom,
  derivationSequenceAtom,
  type DerivedWallet,
  derivedWalletPrivateKeysAtom,
  type DerivedWalletPublic,
  derivedWalletsAtom,
  pendingAutoSignRequestAtom,
  pendingDerivationsAtom,
  type PendingDerivationState,
  walletGenerationAtom,
  walletProvenanceAtom,
  type WalletRevision,
  walletRevisionsAtom,
} from "./store"

export interface KeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

interface MessageEncoder {
  encode: (message: EncodeObject) => Uint8Array
}

interface SignWithEthSecp256k1Fn {
  (
    chainId: string,
    signerAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
    options?: { incrementSequence?: number; customSigner?: OfflineAminoSigner },
  ): Promise<TxRaw>
}

const RESTORE_TIMEOUT_MS = 5_000

export async function awaitWalletRestore<T>(
  restore: Promise<T>,
  timeoutMs = RESTORE_TIMEOUT_MS,
  onLateResult?: (result: T) => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      restore,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Autosign browser storage timed out")),
          timeoutMs,
        )
      }),
    ])
  } catch (error) {
    if (onLateResult) {
      void restore.then(onLateResult).catch(() => undefined)
    }
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

/* Expected address storage for wallet migration detection.
 * Stores the derived wallet address in localStorage per chain to detect when on-chain
 * grants were created by a different derivation method (e.g., previous Privy-based system).
 * Without this, users with previous grants would see auto-sign as "enabled" but transactions
 * would fail because the current derivation produces a different wallet address.
 * Note: origin is not included in key since each origin has its own localStorage namespace. */
const AUTOSIGN_STORAGE_PREFIX = "autosign:"

type WalletStore = ReturnType<typeof useStore>

function createDerivationToken(store: WalletStore, key: string): string {
  const nextSequence = store.get(derivationSequenceAtom) + 1
  store.set(derivationSequenceAtom, nextSequence)
  return `${key}:${nextSequence}`
}

function getPendingDerivation(store: WalletStore, key: string): PendingDerivationState | undefined {
  return store.get(pendingDerivationsAtom)[key]
}

function setPendingDerivation(store: WalletStore, key: string, pending: PendingDerivationState) {
  store.set(pendingDerivationsAtom, (prev: Record<string, PendingDerivationState>) => ({
    ...prev,
    [key]: pending,
  }))
}

function clearPendingDerivation(store: WalletStore, key: string) {
  store.set(pendingDerivationsAtom, (prev: Record<string, PendingDerivationState>) => {
    const next = { ...prev }
    delete next[key]
    return next
  })
}

function clearPendingDerivationIfMatching(store: WalletStore, key: string, token: string) {
  const pending = getPendingDerivation(store, key)
  if (!pending || pending.token !== token) return
  clearPendingDerivation(store, key)
}

function shouldPersistDerivedWallet(store: WalletStore, key: string, token: string): boolean {
  const pending = getPendingDerivation(store, key)
  return !!pending && pending.token === token
}

function getWalletPrivateKeyByKey(store: WalletStore, key: string): Uint8Array | undefined {
  return store.get(derivedWalletPrivateKeysAtom)[key]
}

function setWalletPrivateKeyByKey(store: WalletStore, key: string, privateKey: Uint8Array) {
  store.set(derivedWalletPrivateKeysAtom, (prev: Record<string, Uint8Array>) => ({
    ...prev,
    [key]: privateKey,
  }))
}

function deleteWalletPrivateKeyByKey(store: WalletStore, key: string) {
  store.set(derivedWalletPrivateKeysAtom, (prev: Record<string, Uint8Array>) => {
    const next = { ...prev }
    delete next[key]
    return next
  })
}

function setDerivedWalletByKey(store: WalletStore, key: string, wallet: DerivedWalletPublic) {
  store.set(derivedWalletsAtom, (prev: Record<string, DerivedWalletPublic>) => ({
    ...prev,
    [key]: wallet,
  }))
}

function deleteDerivedWalletByKey(store: WalletStore, key: string) {
  store.set(derivedWalletsAtom, (prev: Record<string, DerivedWalletPublic>) => {
    const next = { ...prev }
    delete next[key]
    return next
  })
}

function setWalletMetadata(
  store: WalletStore,
  key: string,
  revision: WalletRevision,
  provenance: "legacy-derived" | "random" = "legacy-derived",
) {
  store.set(walletRevisionsAtom, (previous) => ({ ...previous, [key]: revision }))
  store.set(walletProvenanceAtom, (previous) => ({ ...previous, [key]: provenance }))
}

export function shouldBroadcastStorageMode(params: {
  previousRevision: number
  nextRevision: number
  previousKeyId?: string
  nextKeyId?: string
}): boolean {
  return (
    params.nextRevision !== params.previousRevision ||
    (params.nextKeyId !== undefined && params.nextKeyId !== params.previousKeyId)
  )
}

export function refreshOwnerWalletRevisions(
  store: WalletStore,
  owner: string,
  storageRevision: number,
) {
  store.set(walletRevisionsAtom, (previous) =>
    Object.fromEntries(
      Object.entries(previous).map(([key, revision]) => [
        key,
        revision.owner === owner ? { ...revision, storageRevision } : revision,
      ]),
    ),
  )
}

function deleteWalletMetadata(store: WalletStore, key: string) {
  store.set(walletRevisionsAtom, (previous) => {
    const next = { ...previous }
    delete next[key]
    return next
  })
  store.set(walletProvenanceAtom, (previous) => {
    const next = { ...previous }
    delete next[key]
    return next
  })
}

export function getExpectedAddressKey(userAddress: string, chainId: string): string {
  return `${AUTOSIGN_STORAGE_PREFIX}${userAddress}:${chainId}`
}

export function readExpectedAddressFromStorage(
  storage: KeyValueStorage,
  userAddress: string,
  chainId: string,
): string | null {
  try {
    return storage.getItem(getExpectedAddressKey(userAddress, chainId))
  } catch {
    return null
  }
}

export function writeExpectedAddressToStorage(
  storage: KeyValueStorage,
  userAddress: string,
  chainId: string,
  address: string,
): void {
  try {
    storage.setItem(getExpectedAddressKey(userAddress, chainId), address)
  } catch {
    // Ignore localStorage write failures (e.g. sandboxed iframes).
  }
}

/** Removes a legacy mirror only when it still identifies the confirmed revoked grantee. */
export function clearExpectedAddressFromStorage(
  storage: Pick<KeyValueStorage, "getItem"> & { removeItem: (key: string) => void },
  userAddress: string,
  chainId: string,
  expectedGrantee: string,
): boolean {
  try {
    const key = getExpectedAddressKey(userAddress, chainId)
    if (storage.getItem(key) !== expectedGrantee) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function getStorage(): KeyValueStorage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function getExpectedAddress(
  userAddress: string,
  chainId: string,
): string | null | undefined {
  const storage = getStorage()
  if (!storage) return undefined
  return readExpectedAddressFromStorage(storage, userAddress, chainId)
}

export function storeExpectedAddress(userAddress: string, chainId: string, address: string): void {
  const storage = getStorage()
  if (!storage) return
  writeExpectedAddressToStorage(storage, userAddress, chainId, address)
}

/** Clears only the exact legacy grant mirror after its on-chain revocation is confirmed. */
export function clearExpectedAddress(
  userAddress: string,
  chainId: string,
  expectedGrantee: string,
): boolean {
  const storage = getStorage()
  if (!storage?.removeItem) return false
  return clearExpectedAddressFromStorage(
    storage as Required<KeyValueStorage>,
    userAddress,
    chainId,
    expectedGrantee,
  )
}

function toPublicWallet(wallet: DerivedWallet): DerivedWalletPublic {
  return {
    publicKey: wallet.publicKey,
    address: wallet.address,
  }
}

/** Keeps the complete durable metadata only for the same active grantee. */
export function getMatchingActiveAutoSignIdentity(
  identity: AutoSignPublicIdentity | undefined,
  address: string,
): AutoSignPublicIdentity | undefined {
  return identity?.state === "active" && identity.address === address ? identity : undefined
}

function zeroizePrivateKey(privateKey: Uint8Array | undefined) {
  if (!privateKey) return
  privateKey.fill(0)
}

function getWalletCacheKey(identity: AutoSignIdentity): string {
  return `${getDerivedWalletKey(identity.owner, identity.bech32Prefix)}:${identity.chainId}`
}

export function clearAllWalletState(store: WalletStore) {
  store.set(pendingDerivationsAtom, {})

  const privateKeys: Record<string, Uint8Array> = store.get(derivedWalletPrivateKeysAtom)
  for (const privateKey of Object.values(privateKeys)) {
    zeroizePrivateKey(privateKey)
  }
  store.set(derivedWalletPrivateKeysAtom, {})
  store.set(derivedWalletsAtom, {})
  store.set(walletRevisionsAtom, {})
  store.set(walletProvenanceAtom, {})
  store.set(walletGenerationAtom, (generation) => generation + 1)
}

export function shouldClearWalletsOnAddressChange(
  previousUserAddress: string,
  nextUserAddress: string,
): boolean {
  return previousUserAddress !== "" && previousUserAddress !== nextUserAddress
}

/* Clear in-memory derived wallets whenever the connected account changes so keys from
 * the previous account do not remain resident until explicit disconnect. */
export function useClearWalletsOnAddressChange() {
  const userAddress = useInitiaAddress()
  const store = useStore()
  const previousAddressRef = useRef(userAddress)

  useEffect(() => {
    const previousUserAddress = previousAddressRef.current
    if (previousUserAddress !== userAddress) {
      const pendingRequest = store.get(pendingAutoSignRequestAtom)
      if (pendingRequest) {
        pendingRequest.reject(new AutoSignCancelledError())
        store.set(pendingAutoSignRequestAtom, null)
      }
    }
    if (shouldClearWalletsOnAddressChange(previousUserAddress, userAddress)) {
      clearAllWalletState(store)
    }
    store.set(activeWalletOwnerAtom, userAddress)
    previousAddressRef.current = userAddress
  }, [store, userAddress])
}

/* Offline signer implementation for derived wallet */
export class DerivedWalletSigner implements OfflineAminoSigner {
  constructor(
    private wallet: DerivedWalletPublic,
    private privateKey: Uint8Array,
  ) {}

  async getAccounts(): Promise<readonly AccountData[]> {
    return [
      {
        address: this.wallet.address,
        algo: "ethsecp256k1" as Algo,
        pubkey: this.wallet.publicKey,
      },
    ]
  }

  /* Initia uses ethsecp256k1 with Amino signing. The sign doc is serialized to JSON
   * and hashed with EIP-191 personal message prefix before signing. */
  async signAmino(signerAddress: string, signDoc: StdSignDoc): Promise<AminoSignResponse> {
    if (this.wallet.address !== signerAddress) {
      throw new Error("Signer address does not match the derived wallet address")
    }

    const signDocAminoJSON = escapeCharacters(sortedJsonStringify(signDoc))
    const messageHash = ethers.hashMessage(signDocAminoJSON)
    const messageHashBytes = fromHex(messageHash.replace("0x", ""))

    const signature = await Secp256k1.createSignature(messageHashBytes, this.privateKey)
    const signatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)])

    const encodedSignature = encodeEthSecp256k1Signature(this.wallet.publicKey, signatureBytes)

    return { signed: signDoc, signature: encodedSignature }
  }
}

/* Derive and store wallet from EIP-191 signature for autosign delegation.
 * Uses personal_sign instead of signTypedData for better hardware wallet compatibility.
 * Wallets are cached per owner + chain ID + bech32 prefix, independently of RPC providers. */
export function useDeriveWallet() {
  const store = useStore()
  const { signMessageAsync } = useSignMessage()
  const findChain = useFindChain()
  const userAddress = useInitiaAddress()
  const { autoSignStorage } = useConfig()

  useEffect(() => {
    store.set(activeWalletOwnerAtom, userAddress)
  }, [store, userAddress])

  useEffect(() => {
    if (!userAddress) return
    return subscribeAutoSignEvents((event, isLocal) => {
      // Local UI listeners still receive the event. This listener only clears
      // stale key state after a different document changes the storage mode.
      if (isLocal || event.topic !== "storage-mode" || event.owner !== userAddress) return
      try {
        clearAutoSignOwnerSessionWallets(event.owner)
      } catch {
        // Durable revision fencing still prevents stale session data from loading.
      }
      clearAllWalletState(store)
      store.set(activeWalletOwnerAtom, userAddress)
    })
  }, [store, userAddress])

  const getIdentity = (chainId: string): AutoSignIdentity => {
    if (!userAddress || typeof window === "undefined") {
      throw new AutoSignCancelledError()
    }
    const chain = findChain(chainId)
    return {
      owner: userAddress,
      chainId,
      bech32Prefix: chain.bech32_prefix,
      origin: window.location.origin,
    }
  }

  const getKey = (chainId: string) => {
    const identity = getIdentity(chainId)
    return { identity, key: getWalletCacheKey(identity) }
  }

  const setCurrentWallet = (
    key: string,
    wallet: DerivedWallet,
    storageRevision: number,
    provenance: "legacy-derived" | "random" = "legacy-derived",
    keyId = `memory:${store.get(walletGenerationAtom)}`,
  ) => {
    setWalletPrivateKeyByKey(store, key, wallet.privateKey)
    setDerivedWalletByKey(store, key, toPublicWallet(wallet))
    setWalletMetadata(
      store,
      key,
      {
        owner: userAddress,
        generation: store.get(walletGenerationAtom),
        storageRevision,
        keyId,
      },
      provenance,
    )
    return toPublicWallet(wallet)
  }

  const isCurrentWalletOperation = (owner: string, generation: number) =>
    store.get(activeWalletOwnerAtom) === owner && store.get(walletGenerationAtom) === generation

  const resolveStorageMode = async (
    identity: AutoSignIdentity,
    stayConnected?: boolean,
  ): Promise<AutoSignStorageMode> => {
    if (autoSignStorage === "memory") return "memory"
    if (stayConnected !== undefined) return stayConnected ? "persistent" : "session"
    const preference = await getAutoSignPreference(identity.owner, identity.origin)
    return preference.stayConnected ? "persistent" : "session"
  }

  const deriveWallet = async (
    chainId: string,
    options?: { stayConnected?: boolean },
  ): Promise<DerivedWalletPublic> => {
    if (!userAddress) {
      throw new Error("User address not available")
    }

    const { identity, key } = getKey(chainId)
    const currentWallet = store.get(derivedWalletsAtom)[key]

    if (currentWallet && getWalletPrivateKeyByKey(store, key)) {
      if (store.get(walletProvenanceAtom)[key] === "random") {
        throw new Error("Random autosign signer must be restored instead of derived")
      }
      const expectedAddress = getExpectedAddress(identity.owner, identity.chainId)
      if (expectedAddress && expectedAddress !== currentWallet.address) {
        throw new Error("Stored autosign wallet does not match the expected grantee")
      }
      if (autoSignStorage !== "memory") {
        let activeIdentity: AutoSignPublicIdentity | undefined
        try {
          activeIdentity = await getAutoSignPublicIdentity(identity)
        } catch (error) {
          if (error instanceof AutoSignCancelledError) throw error
        }
        if (
          activeIdentity?.state === "active" &&
          activeIdentity.address !== currentWallet.address
        ) {
          throw new Error("Stored autosign wallet does not match the active grantee")
        }
      }
      if (autoSignStorage !== "memory" && options?.stayConnected !== undefined) {
        const privateKey = getWalletPrivateKeyByKey(store, key)!
        const generation = store.get(walletGenerationAtom)
        const preference = await setAutoSignStayConnected(
          identity,
          { ...currentWallet, privateKey },
          options.stayConnected,
          () => isCurrentWalletOperation(identity.owner, generation),
        )
        if (!isCurrentWalletOperation(identity.owner, generation))
          throw new AutoSignCancelledError()
        const savedIdentity = await getAutoSignPublicIdentity(identity)
        if (!savedIdentity) throw new AutoSignCancelledError()
        setWalletMetadata(
          store,
          key,
          {
            owner: userAddress,
            generation: store.get(walletGenerationAtom),
            storageRevision: preference.revision,
            keyId: savedIdentity.keyId,
          },
          savedIdentity.provenance,
        )
      }
      return currentWallet
    }

    const pendingDerivation = getPendingDerivation(store, key)
    if (pendingDerivation) {
      return pendingDerivation.promise
    }

    const token = createDerivationToken(store, key)
    const generation = store.get(walletGenerationAtom)

    const derivationPromise = (async () => {
      try {
        const origin = window.location.origin
        const message = getAutoSignMessage(origin)
        const signature = await signMessageAsync({ message })

        // The derivation signature also reveals the user's own public key. Caching it here
        // lets the grant transaction that follows (gas simulation and signing) proceed
        // without an identification signature, which would be a second wallet popup.
        storePublicKey(userAddress, recoverPublicKey(message, signature))

        const wallet = await deriveWalletFromSignature(signature as Hex, identity.bech32Prefix)
        const publicWallet = toPublicWallet(wallet)
        const expectedAddress = getExpectedAddress(identity.owner, identity.chainId)
        if (expectedAddress && expectedAddress !== publicWallet.address) {
          wallet.privateKey.fill(0)
          throw new Error("Derived autosign wallet does not match the expected grantee")
        }
        let matchingActiveIdentity: AutoSignPublicIdentity | undefined
        if (autoSignStorage !== "memory") {
          let storedIdentity: AutoSignPublicIdentity | undefined
          try {
            storedIdentity = await getAutoSignPublicIdentity(identity)
          } catch (error) {
            if (error instanceof AutoSignCancelledError) {
              wallet.privateKey.fill(0)
              throw error
            }
          }
          matchingActiveIdentity = getMatchingActiveAutoSignIdentity(
            storedIdentity,
            publicWallet.address,
          )
          if (storedIdentity?.state === "active" && !matchingActiveIdentity) {
            wallet.privateKey.fill(0)
            throw new Error("Derived autosign wallet does not match the active grantee")
          }
        }

        if (
          shouldPersistDerivedWallet(store, key, token) &&
          isCurrentWalletOperation(identity.owner, generation)
        ) {
          const mode = await resolveStorageMode(identity, options?.stayConnected)
          if (mode === "memory") {
            setCurrentWallet(key, wallet, 0)
          } else {
            const isCurrentDerivation = () =>
              shouldPersistDerivedWallet(store, key, token) &&
              isCurrentWalletOperation(identity.owner, generation)
            const preference = await saveAutoSignWallet(
              identity,
              wallet,
              mode,
              isCurrentDerivation,
              matchingActiveIdentity,
            )
            if (!isCurrentDerivation()) {
              wallet.privateKey.fill(0)
              throw new AutoSignCancelledError()
            }
            const savedIdentity = await getAutoSignPublicIdentity(identity)
            if (!savedIdentity || !isCurrentDerivation()) {
              wallet.privateKey.fill(0)
              throw new AutoSignCancelledError()
            }
            setCurrentWallet(
              key,
              wallet,
              preference.revision,
              "legacy-derived",
              savedIdentity.keyId,
            )
            // A saved legacy-derived signer is safe to recognize on the next
            // enable attempt even if its initial grant transaction fails.
            storeExpectedAddress(identity.owner, identity.chainId, publicWallet.address)
          }
          return publicWallet
        }

        zeroizePrivateKey(wallet.privateKey)
        throw new Error("Wallet derivation was cancelled")
      } finally {
        clearPendingDerivationIfMatching(store, key, token)
      }
    })()

    setPendingDerivation(store, key, { promise: derivationPromise, token })
    return derivationPromise
  }

  const getWallet = (chainId: string): DerivedWalletPublic | undefined => {
    if (!userAddress) return undefined
    const { key } = getKey(chainId)
    if (!getWalletPrivateKeyByKey(store, key)) return undefined
    return store.get(derivedWalletsAtom)[key]
  }

  const getWalletPrivateKey = (chainId: string): Uint8Array | undefined => {
    if (!userAddress) return undefined
    const { key } = getKey(chainId)
    return getWalletPrivateKeyByKey(store, key)
  }

  const clearWallet = (chainId: string) => {
    if (!userAddress) return

    const { key } = getKey(chainId)
    const privateKey = getWalletPrivateKeyByKey(store, key)

    const pendingDerivation = getPendingDerivation(store, key)
    if (pendingDerivation) {
      clearPendingDerivation(store, key)
    }

    zeroizePrivateKey(privateKey)
    deleteWalletPrivateKeyByKey(store, key)
    deleteDerivedWalletByKey(store, key)
    deleteWalletMetadata(store, key)
  }

  const clearAllWallets = () => {
    clearAllWalletState(store)
  }

  const restoreWallet = async (chainId: string): Promise<DerivedWalletPublic | undefined> => {
    if (!userAddress || autoSignStorage === "memory") return undefined
    const { identity, key } = getKey(chainId)
    const generation = store.get(walletGenerationAtom)
    const restore = loadAutoSignWallet(identity)
    const restored = await awaitWalletRestore(restore, RESTORE_TIMEOUT_MS, (late) =>
      late?.privateKey.fill(0),
    )
    if (!restored) return undefined
    if (
      store.get(walletGenerationAtom) !== generation ||
      store.get(activeWalletOwnerAtom) !== identity.owner
    ) {
      restored.privateKey.fill(0)
      throw new AutoSignCancelledError()
    }
    const expectedAddress = getExpectedAddress(identity.owner, identity.chainId)
    if (
      restored.provenance === "legacy-derived" &&
      expectedAddress &&
      expectedAddress !== restored.address
    ) {
      restored.privateKey.fill(0)
      return undefined
    }
    setCurrentWallet(key, restored, restored.revision, restored.provenance, restored.keyId)
    return toPublicWallet(restored)
  }

  const createWallet = async (
    chainId: string,
    options?: { stayConnected?: boolean; random?: boolean },
  ): Promise<DerivedWalletPublic> => {
    if (!options?.random) return deriveWallet(chainId, options)
    if (autoSignStorage === "memory") {
      throw new Error("Random autosign keys require browser storage")
    }
    const { identity, key } = getKey(chainId)
    const mode = await resolveStorageMode(identity, options.stayConnected)
    if (mode !== "persistent") throw new Error("Random autosign keys require Stay connected")
    const generation = store.get(walletGenerationAtom)
    const wallet = await createRandomWallet(identity.bech32Prefix)
    const pending = await createPendingRandomAutoSignWallet(identity, wallet, () =>
      isCurrentWalletOperation(identity.owner, generation),
    )
    if (!isCurrentWalletOperation(identity.owner, generation)) {
      wallet.privateKey.fill(0)
      throw new AutoSignCancelledError()
    }
    setCurrentWallet(key, pending, pending.revision, pending.provenance, pending.keyId)
    return toPublicWallet(pending)
  }

  const activatePendingIdentity = async (chainId: string, keyId: string) => {
    const { identity } = getKey(chainId)
    const generation = store.get(walletGenerationAtom)
    await activatePendingAutoSignWallet(identity, keyId, () =>
      isCurrentWalletOperation(identity.owner, generation),
    )
    if (!isCurrentWalletOperation(identity.owner, generation)) throw new AutoSignCancelledError()
    broadcastAutoSignEvent({ topic: "wallet-active", owner: identity.owner, id: keyId })
  }

  const activateWallet = async (chainId: string) => {
    const { key } = getKey(chainId)
    const revision = store.get(walletRevisionsAtom)[key]
    if (!revision) throw new AutoSignCancelledError()
    await activatePendingIdentity(chainId, revision.keyId)
  }

  const pauseWallet = async (chainId: string): Promise<StoredAutoSignWallet | undefined> => {
    const { identity, key } = getKey(chainId)
    const revision = store.get(walletRevisionsAtom)[key]
    const wallet = getWallet(chainId)
    const privateKey = getWalletPrivateKey(chainId)
    if (!revision || !wallet || !privateKey) return undefined
    const paused: StoredAutoSignWallet = {
      ...wallet,
      privateKey: new Uint8Array(privateKey),
      provenance: store.get(walletProvenanceAtom)[key] ?? "legacy-derived",
      revision: revision.storageRevision,
      keyId: revision.keyId,
      state: "paused",
    }
    try {
      if (autoSignStorage !== "memory" && (await getStorageMode(chainId)) === "persistent") {
        await setAutoSignWalletState(identity, revision.keyId, "paused")
      }
      clearWallet(chainId)
      broadcastAutoSignEvent({ topic: "wallet-paused", owner: identity.owner, id: revision.keyId })
      return paused
    } catch (error) {
      paused.privateKey.fill(0)
      throw error
    }
  }

  const discardPausedWallet = (paused: StoredAutoSignWallet | undefined) => {
    paused?.privateKey.fill(0)
  }

  const deleteWalletAfterConfirmedRevoke = async (
    chainId: string,
    paused: StoredAutoSignWallet | undefined,
    keyId?: string,
  ) => {
    const targetKeyId = paused?.keyId ?? keyId
    if (!targetKeyId) return
    const { identity } = getKey(chainId)
    if (autoSignStorage !== "memory") {
      await deleteAutoSignWallet(identity, targetKeyId)
    }
    discardPausedWallet(paused)
  }

  const resumeWallet = async (chainId: string, paused: StoredAutoSignWallet | undefined) => {
    if (!paused) return undefined
    const { identity, key } = getKey(chainId)
    const generation = store.get(walletGenerationAtom)
    try {
      if (autoSignStorage !== "memory" && (await getStorageMode(chainId)) === "persistent") {
        await setAutoSignWalletState(identity, paused.keyId, "active")
      }
      if (!isCurrentWalletOperation(identity.owner, generation)) throw new AutoSignCancelledError()
      setCurrentWallet(key, paused, paused.revision, paused.provenance, paused.keyId)
      broadcastAutoSignEvent({ topic: "wallet-active", owner: identity.owner, id: paused.keyId })
      return toPublicWallet(paused)
    } catch (error) {
      paused.privateKey.fill(0)
      throw error
    }
  }

  const getWalletIdentities = async (chainId: string) => {
    if (!userAddress || autoSignStorage === "memory") return []
    const { identity } = getKey(chainId)
    const identities = await listAutoSignPublicIdentities(identity.owner, identity.origin)
    return identities.filter(
      (candidate) =>
        candidate.chainId === identity.chainId && candidate.bech32Prefix === identity.bech32Prefix,
    )
  }

  const getActiveIdentity = async (chainId: string) => {
    return (await getWalletIdentities(chainId)).find((candidate) => candidate.state === "active")
  }

  const getPendingIdentities = async (chainId: string) => {
    return (await getWalletIdentities(chainId)).filter((candidate) => candidate.state === "pending")
  }

  const getPendingIdentity = async (chainId: string) => (await getPendingIdentities(chainId))[0]

  const discardPendingIdentity = async (chainId: string, keyId: string) => {
    if (!userAddress || autoSignStorage === "memory") return
    const { identity, key } = getKey(chainId)
    const generation = store.get(walletGenerationAtom)
    await discardPendingAutoSignWallet(identity, keyId)
    if (!isCurrentWalletOperation(identity.owner, generation)) throw new AutoSignCancelledError()
    if (store.get(walletRevisionsAtom)[key]?.keyId === keyId) clearWallet(chainId)
  }

  const updateWalletObservation = async (
    chainId: string,
    observation: { requestedDurationMs?: number; observedExpiration?: string },
  ) => {
    if (autoSignStorage === "memory") return
    const { identity, key } = getKey(chainId)
    const revision = store.get(walletRevisionsAtom)[key]
    const generation = store.get(walletGenerationAtom)
    if (!revision) throw new AutoSignCancelledError()
    const isCurrentObservation = () => {
      const current = store.get(walletRevisionsAtom)[key]
      return (
        isCurrentWalletOperation(identity.owner, generation) &&
        current?.keyId === revision.keyId &&
        current.storageRevision === revision.storageRevision
      )
    }
    await updateAutoSignWalletObservation(
      identity,
      revision.keyId,
      observation,
      isCurrentObservation,
    )
    if (!isCurrentObservation()) throw new AutoSignCancelledError()
  }

  const getWalletRevision = (chainId: string): WalletRevision | undefined => {
    if (!userAddress) return undefined
    const { key } = getKey(chainId)
    return store.get(walletRevisionsAtom)[key]
  }

  const assertWalletRevision = async (chainId: string, revision: WalletRevision | undefined) => {
    if (!revision || !userAddress || revision.owner !== userAddress)
      throw new AutoSignCancelledError()
    if (store.get(activeWalletOwnerAtom) !== revision.owner) throw new AutoSignCancelledError()
    if (store.get(walletGenerationAtom) !== revision.generation) throw new AutoSignCancelledError()
    if (autoSignStorage !== "memory") {
      const { identity } = getKey(chainId)
      await assertAutoSignRevision({
        owner: identity.owner,
        origin: identity.origin,
        revision: revision.storageRevision,
      })
      const current = await getAutoSignPublicIdentity(identity)
      if (!current || current.keyId !== revision.keyId || current.state !== "active") {
        throw new AutoSignCancelledError()
      }
      if (store.get(activeWalletOwnerAtom) !== revision.owner) throw new AutoSignCancelledError()
      if (store.get(walletGenerationAtom) !== revision.generation)
        throw new AutoSignCancelledError()
    }
  }

  const getStayConnected = async (chainId: string): Promise<boolean> => {
    if (autoSignStorage === "memory") return false
    const { identity } = getKey(chainId)
    return (await getAutoSignPreference(identity.owner, identity.origin)).stayConnected
  }

  const getStorageMode = async (chainId: string): Promise<AutoSignStorageMode> => {
    if (autoSignStorage === "memory") return "memory"
    const { identity } = getKey(chainId)
    return (await getAutoSignPreference(identity.owner, identity.origin)).stayConnected
      ? "persistent"
      : "session"
  }

  const setStayConnected = async (
    chainId: string,
    stayConnected: boolean,
    options?: { alreadyLocked?: boolean },
  ) => {
    if (autoSignStorage === "memory") {
      throw new Error("Autosign is configured for memory-only storage")
    }
    const { identity, key } = getKey(chainId)
    const update = async () => {
      const wallet = getWallet(chainId)
      const privateKey = getWalletPrivateKey(chainId)
      const previousRevision = (await getAutoSignPreference(identity.owner, identity.origin))
        .revision
      const previousKeyId = store.get(walletRevisionsAtom)[key]?.keyId
      const generation = store.get(walletGenerationAtom)
      const preference = await setAutoSignStayConnected(
        identity,
        wallet && privateKey ? { ...wallet, privateKey } : undefined,
        stayConnected,
        () => isCurrentWalletOperation(identity.owner, generation),
      )
      if (!isCurrentWalletOperation(identity.owner, generation)) throw new AutoSignCancelledError()
      refreshOwnerWalletRevisions(store, identity.owner, preference.revision)
      let savedIdentity: AutoSignPublicIdentity | undefined
      if (wallet && privateKey) {
        savedIdentity = await getAutoSignPublicIdentity(identity)
        if (!savedIdentity) throw new AutoSignCancelledError()
        setWalletMetadata(
          store,
          key,
          {
            owner: userAddress,
            generation: store.get(walletGenerationAtom),
            storageRevision: preference.revision,
            keyId: savedIdentity.keyId,
          },
          savedIdentity.provenance,
        )
      }
      // A redundant preference write should not evict other tabs' in-memory
      // signers. Still notify them if an unexpected identity replacement did
      // occur without a revision change.
      if (
        shouldBroadcastStorageMode({
          previousRevision,
          nextRevision: preference.revision,
          previousKeyId,
          nextKeyId: savedIdentity?.keyId,
        })
      ) {
        broadcastAutoSignEvent({
          topic: "storage-mode",
          owner: identity.owner,
          revision: preference.revision,
        })
      }
    }
    return options?.alreadyLocked ? update() : withAutoSignOperation(identity.owner, update)
  }

  const forgetWallet = async (chainId: string) => {
    if (!userAddress || autoSignStorage === "memory") {
      clearWallet(chainId)
      return
    }
    const { identity } = getKey(chainId)
    const preference = await forgetAutoSignWallet(identity)
    clearWallet(chainId)
    broadcastAutoSignEvent({
      topic: "storage-mode",
      owner: identity.owner,
      revision: preference.revision,
    })
  }

  const getWalletProvenance = (chainId: string) => {
    if (!userAddress) return undefined
    const { key } = getKey(chainId)
    return store.get(walletProvenanceAtom)[key]
  }

  return {
    deriveWallet,
    getWallet,
    getWalletPrivateKey,
    clearWallet,
    clearAllWallets,
    restoreWallet,
    createWallet,
    activateWallet,
    activatePendingIdentity,
    pauseWallet,
    discardPausedWallet,
    deleteWalletAfterConfirmedRevoke,
    resumeWallet,
    getWalletIdentities,
    getActiveIdentity,
    getPendingIdentity,
    getPendingIdentities,
    discardPendingIdentity,
    updateWalletObservation,
    getWalletRevision,
    assertWalletRevision,
    getStayConnected,
    getStorageMode,
    setStayConnected,
    forgetWallet,
    getWalletProvenance,
  }
}

export function buildAuthzExecMessages({
  granteeAddress,
  messages,
  encoder,
}: {
  granteeAddress: string
  messages: EncodeObject[]
  encoder: MessageEncoder
}): EncodeObject[] {
  return [
    {
      typeUrl: "/cosmos.authz.v1beta1.MsgExec",
      value: MsgExec.fromPartial({
        grantee: granteeAddress,
        msgs: messages.map((msg) => ({
          typeUrl: msg.typeUrl,
          value: encoder.encode(msg),
        })),
      }),
    },
  ]
}

export async function signWithDerivedWalletWithPrivateKey({
  chainId,
  granterAddress,
  messages,
  fee,
  memo,
  derivedWallet,
  privateKey,
  encoder,
  signWithEthSecp256k1,
}: {
  chainId: string
  granterAddress: string
  messages: EncodeObject[]
  fee: StdFee
  memo: string
  derivedWallet: DerivedWalletPublic
  privateKey: Uint8Array
  encoder: MessageEncoder
  signWithEthSecp256k1: SignWithEthSecp256k1Fn
}): Promise<TxRaw> {
  const authzExecuteMessage = buildAuthzExecMessages({
    granteeAddress: derivedWallet.address,
    messages,
    encoder,
  })

  const delegatedFee: StdFee = {
    ...fee,
    granter: granterAddress,
  }

  // Snapshot key material so concurrent wallet cleanup cannot mutate in-flight signing state.
  const signingPrivateKey = new Uint8Array(privateKey)
  const derivedSigner = new DerivedWalletSigner(derivedWallet, signingPrivateKey)

  try {
    return await signWithEthSecp256k1(
      chainId,
      derivedWallet.address,
      authzExecuteMessage,
      delegatedFee,
      memo,
      { customSigner: derivedSigner },
    )
  } finally {
    zeroizePrivateKey(signingPrivateKey)
  }
}
