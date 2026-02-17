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
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useInitiaAddress } from "@/public/data/hooks"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"
import {
  cancelledDerivationTokensAtom,
  derivationSequenceAtom,
  type DerivedWallet,
  derivedWalletPrivateKeysAtom,
  type DerivedWalletPublic,
  derivedWalletsAtom,
  pendingDerivationsAtom,
  type PendingDerivationState,
} from "./store"

export interface KeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
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

function isDerivationCancelled(store: WalletStore, token: string): boolean {
  return !!store.get(cancelledDerivationTokensAtom)[token]
}

function markDerivationCancelled(store: WalletStore, token: string) {
  store.set(cancelledDerivationTokensAtom, (prev: Record<string, true>) => ({
    ...prev,
    [token]: true,
  }))
}

function clearDerivationCancelledToken(store: WalletStore, token: string) {
  store.set(cancelledDerivationTokensAtom, (prev: Record<string, true>) => {
    const next = { ...prev }
    delete next[token]
    return next
  })
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

function toPublicWallet(wallet: DerivedWallet): DerivedWalletPublic {
  return {
    publicKey: wallet.publicKey,
    address: wallet.address,
  }
}

function zeroizePrivateKey(privateKey: Uint8Array | undefined) {
  if (!privateKey) return
  privateKey.fill(0)
}

export function clearAllWalletState(store: WalletStore) {
  const pendingDerivations: Record<string, PendingDerivationState> =
    store.get(pendingDerivationsAtom)
  for (const { token } of Object.values(pendingDerivations)) {
    markDerivationCancelled(store, token)
  }

  store.set(pendingDerivationsAtom, {})

  const privateKeys: Record<string, Uint8Array> = store.get(derivedWalletPrivateKeysAtom)
  for (const privateKey of Object.values(privateKeys)) {
    zeroizePrivateKey(privateKey)
  }
  store.set(derivedWalletPrivateKeysAtom, {})
  // Keep cancellation tokens until each in-flight derivation clears its own token in finally.
  // Clearing this map early can allow cancelled derivations to repopulate key material.
  store.set(derivedWalletsAtom, {})
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
    if (shouldClearWalletsOnAddressChange(previousUserAddress, userAddress)) {
      clearAllWalletState(store)
    }
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
 * Wallets are cached per user + bech32 prefix to avoid cross-chain prefix mismatches. */
export function useDeriveWallet() {
  const store = useStore()
  const { signMessageAsync } = useSignMessage()
  const findChain = useFindChain()
  const userAddress = useInitiaAddress()

  const deriveWallet = async (chainId: string): Promise<DerivedWalletPublic> => {
    if (!userAddress) {
      throw new Error("User address not available")
    }

    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    const currentWallet = store.get(derivedWalletsAtom)[key]

    if (currentWallet && getWalletPrivateKeyByKey(store, key)) {
      return currentWallet
    }

    const pendingDerivation = getPendingDerivation(store, key)
    if (pendingDerivation) {
      return pendingDerivation.promise
    }

    const token = createDerivationToken(store, key)

    const derivationPromise = (async () => {
      try {
        const origin = window.location.origin
        const message = getAutoSignMessage(origin)
        const signature = await signMessageAsync({ message })

        const wallet = await deriveWalletFromSignature(signature as Hex, chain.bech32_prefix)
        const publicWallet = toPublicWallet(wallet)

        if (!isDerivationCancelled(store, token)) {
          setWalletPrivateKeyByKey(store, key, wallet.privateKey)
          setDerivedWalletByKey(store, key, publicWallet)
          return publicWallet
        }

        zeroizePrivateKey(wallet.privateKey)
        throw new Error("Wallet derivation was cancelled")
      } finally {
        clearPendingDerivationIfMatching(store, key, token)
        clearDerivationCancelledToken(store, token)
      }
    })()

    setPendingDerivation(store, key, { promise: derivationPromise, token })
    return derivationPromise
  }

  const getWallet = (chainId: string): DerivedWalletPublic | undefined => {
    if (!userAddress) return undefined
    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    if (!getWalletPrivateKeyByKey(store, key)) return undefined
    return store.get(derivedWalletsAtom)[key]
  }

  const getWalletPrivateKey = (chainId: string): Uint8Array | undefined => {
    if (!userAddress) return undefined
    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    return getWalletPrivateKeyByKey(store, key)
  }

  const clearWallet = (chainId: string) => {
    if (!userAddress) return

    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    const privateKey = getWalletPrivateKeyByKey(store, key)

    const pendingDerivation = getPendingDerivation(store, key)
    if (pendingDerivation) {
      markDerivationCancelled(store, pendingDerivation.token)
      clearPendingDerivation(store, key)
    }

    zeroizePrivateKey(privateKey)
    deleteWalletPrivateKeyByKey(store, key)
    deleteDerivedWalletByKey(store, key)
  }

  const clearAllWallets = () => {
    clearAllWalletState(store)
  }

  return { deriveWallet, getWallet, getWalletPrivateKey, clearWallet, clearAllWallets }
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
