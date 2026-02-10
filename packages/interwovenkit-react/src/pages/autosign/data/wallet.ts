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
import { useSetAtom, useStore } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useFindChain } from "@/data/chains"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, type DerivedWalletPublic, derivedWalletsAtom } from "./store"

const pendingDerivations = new Map<string, Promise<DerivedWalletPublic>>()
const cancelledDerivations = new Set<string>()
const privateKeyVault = new Map<string, Uint8Array>()

interface MessageEncoder {
  encode: (message: EncodeObject) => Uint8Array
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

export function getExpectedAddress(userAddress: string, chainId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(getExpectedAddressKey(userAddress, chainId))
  } catch {
    return null
  }
}

export function storeExpectedAddress(userAddress: string, chainId: string, address: string): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(getExpectedAddressKey(userAddress, chainId), address)
  } catch {
    // Ignore localStorage write failures (e.g. sandboxed iframes).
  }
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

    if (pendingDerivations.has(key)) {
      return pendingDerivations.get(key)!
    }

    const promiseRef: { current?: Promise<DerivedWalletPublic> } = {}

    const derivationPromise = (async () => {
      try {
        const origin = window.location.origin
        const message = getAutoSignMessage(origin)
        const signature = await signMessageAsync({ message })

        const wallet = await deriveWalletFromSignature(signature as Hex, chain.bech32_prefix)
        const publicWallet = toPublicWallet(wallet)

        if (!cancelledDerivations.has(key)) {
          privateKeyVault.set(key, wallet.privateKey)
          setDerivedWallets((prev) => ({ ...prev, [key]: publicWallet }))
          return publicWallet
        }

        zeroizePrivateKey(wallet.privateKey)
        throw new Error("Wallet derivation was cancelled")
      } finally {
        if (pendingDerivations.get(key) === promiseRef.current) {
          pendingDerivations.delete(key)
        }
        cancelledDerivations.delete(key)
      }
    })()

    promiseRef.current = derivationPromise
    pendingDerivations.set(key, derivationPromise)
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

    if (pendingDerivations.has(key)) {
      cancelledDerivations.add(key)
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
    for (const key of pendingDerivations.keys()) {
      cancelledDerivations.add(key)
    }
    pendingDerivations.clear()
    for (const privateKey of privateKeyVault.values()) {
      zeroizePrivateKey(privateKey)
    }
    privateKeyVault.clear()
    setDerivedWallets({})
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

    const authzExecuteMessage = buildAuthzExecMessages({
      granteeAddress: derivedWallet.address,
      messages,
      encoder: registry,
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
}
