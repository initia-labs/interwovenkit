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
import { useSetAtom, useStore } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useFindChain } from "@/data/chains"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, type DerivedWalletPublic, derivedWalletsAtom } from "./store"

interface PendingDerivation {
  promise: Promise<DerivedWalletPublic>
  token: string
}

const pendingDerivations = new Map<string, PendingDerivation>()
const cancelledDerivationTokens = new Set<string>()
const privateKeyVault = new Map<string, Uint8Array>()
let derivationSequence = 0

function createDerivationToken(key: string): string {
  derivationSequence += 1
  return `${key}:${derivationSequence}`
}

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

function clearAllWalletState(
  setDerivedWallets: (wallets: Record<string, DerivedWalletPublic>) => void,
) {
  for (const { token } of pendingDerivations.values()) {
    cancelledDerivationTokens.add(token)
  }
  pendingDerivations.clear()
  for (const privateKey of privateKeyVault.values()) {
    zeroizePrivateKey(privateKey)
  }
  privateKeyVault.clear()
  setDerivedWallets({})
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
  const setDerivedWallets = useSetAtom(derivedWalletsAtom)
  const previousAddressRef = useRef(userAddress)

  useEffect(() => {
    const previousUserAddress = previousAddressRef.current
    if (shouldClearWalletsOnAddressChange(previousUserAddress, userAddress)) {
      clearAllWalletState(setDerivedWallets)
    }
    previousAddressRef.current = userAddress
  }, [setDerivedWallets, userAddress])
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
  const setDerivedWallets = useSetAtom(derivedWalletsAtom)
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

    if (currentWallet && privateKeyVault.has(key)) {
      return currentWallet
    }

    const pendingDerivation = pendingDerivations.get(key)
    if (pendingDerivation) {
      return pendingDerivation.promise
    }

    const token = createDerivationToken(key)

    const derivationPromise = (async () => {
      try {
        const origin = window.location.origin
        const message = getAutoSignMessage(origin)
        const signature = await signMessageAsync({ message })

        const wallet = await deriveWalletFromSignature(signature as Hex, chain.bech32_prefix)
        const publicWallet = toPublicWallet(wallet)

        if (!cancelledDerivationTokens.has(token)) {
          privateKeyVault.set(key, wallet.privateKey)
          setDerivedWallets((prev) => ({ ...prev, [key]: publicWallet }))
          return publicWallet
        }

        zeroizePrivateKey(wallet.privateKey)
        throw new Error("Wallet derivation was cancelled")
      } finally {
        if (pendingDerivations.get(key)?.token === token) {
          pendingDerivations.delete(key)
        }
        cancelledDerivationTokens.delete(token)
      }
    })()

    pendingDerivations.set(key, { promise: derivationPromise, token })
    return derivationPromise
  }

  const getWallet = (chainId: string): DerivedWalletPublic | undefined => {
    if (!userAddress) return undefined
    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    if (!privateKeyVault.has(key)) return undefined
    return store.get(derivedWalletsAtom)[key]
  }

  const getWalletPrivateKey = (chainId: string): Uint8Array | undefined => {
    if (!userAddress) return undefined
    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    return privateKeyVault.get(key)
  }

  const clearWallet = (chainId: string) => {
    if (!userAddress) return

    const chain = findChain(chainId)
    const key = getDerivedWalletKey(userAddress, chain.bech32_prefix)
    const privateKey = privateKeyVault.get(key)

    const pendingDerivation = pendingDerivations.get(key)
    if (pendingDerivation) {
      cancelledDerivationTokens.add(pendingDerivation.token)
      pendingDerivations.delete(key)
    }

    zeroizePrivateKey(privateKey)
    privateKeyVault.delete(key)

    setDerivedWallets((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const clearAllWallets = () => {
    clearAllWalletState(setDerivedWallets)
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

  const derivedSigner = new DerivedWalletSigner(derivedWallet, privateKey)

  return await signWithEthSecp256k1(
    chainId,
    derivedWallet.address,
    authzExecuteMessage,
    delegatedFee,
    memo,
    { customSigner: derivedSigner },
  )
}

/* Sign auto-sign transactions with derived wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithDerivedWallet() {
  const { getWallet, deriveWallet, getWalletPrivateKey } = useDeriveWallet()
  const registry = useRegistry()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    granterAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
    derivedWalletOverride?: DerivedWalletPublic,
  ): Promise<TxRaw> => {
    let derivedWallet = derivedWalletOverride ?? getWallet(chainId)
    if (!derivedWallet) {
      derivedWallet = await deriveWallet(chainId)
    }
    const privateKey = getWalletPrivateKey(chainId)
    if (!privateKey) {
      throw new Error("Derived wallet key not initialized")
    }

    return await signWithDerivedWalletWithPrivateKey({
      chainId,
      granterAddress,
      messages,
      fee,
      memo,
      derivedWallet,
      privateKey,
      encoder: registry,
      signWithEthSecp256k1,
    })
  }
}
