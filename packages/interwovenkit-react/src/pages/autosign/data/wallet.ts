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
import { useSignTypedData } from "wagmi"
import { useAtom } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useFindChain } from "@/data/chains"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { deriveWalletFromSignature, getAutoSignTypedData, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, derivedWalletsAtom } from "./store"

const pendingDerivations = new Map<string, Promise<DerivedWallet>>()
const cancelledDerivations = new Set<string>()

/* Expected address storage for wallet migration detection.
 * Stores the derived wallet address in localStorage to detect when on-chain grants
 * were created by a different derivation method (e.g., previous Privy-based system).
 * Without this, users with previous grants would see auto-sign as "enabled" but transactions
 * would fail because the current derivation produces a different wallet address. */
const AUTOSIGN_STORAGE_PREFIX = "autosign:"

export function getExpectedAddressKey(
  origin: string,
  chainId: string,
  userAddress: string,
): string {
  return `${AUTOSIGN_STORAGE_PREFIX}${origin}:${chainId}:${userAddress}`
}

export function getExpectedAddress(
  origin: string,
  chainId: string,
  userAddress: string,
): string | null {
  return localStorage.getItem(getExpectedAddressKey(origin, chainId, userAddress))
}

export function storeExpectedAddress(
  origin: string,
  chainId: string,
  userAddress: string,
  address: string,
): void {
  localStorage.setItem(getExpectedAddressKey(origin, chainId, userAddress), address)
}

export function clearExpectedAddress(origin: string, chainId: string, userAddress: string): void {
  localStorage.removeItem(getExpectedAddressKey(origin, chainId, userAddress))
}

/* Offline signer implementation for derived wallet */
export class DerivedWalletSigner implements OfflineAminoSigner {
  constructor(private wallet: DerivedWallet) {}

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

    const signature = await Secp256k1.createSignature(messageHashBytes, this.wallet.privateKey)
    const signatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)])

    const encodedSignature = encodeEthSecp256k1Signature(this.wallet.publicKey, signatureBytes)

    return { signed: signDoc, signature: encodedSignature }
  }
}

/* Derive and store wallet from EIP-712 signature for autosign delegation */
export function useDeriveWallet() {
  const [derivedWallets, setDerivedWallets] = useAtom(derivedWalletsAtom)
  const { signTypedDataAsync } = useSignTypedData()
  const findChain = useFindChain()
  const userAddress = useInitiaAddress()

  const deriveWallet = async (chainId: string): Promise<DerivedWallet> => {
    if (!userAddress) {
      throw new Error("User address not available")
    }

    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId, userAddress)

    if (derivedWallets[key]) {
      return derivedWallets[key]
    }

    if (pendingDerivations.has(key)) {
      return pendingDerivations.get(key)!
    }

    const derivationPromise = (async () => {
      try {
        const chain = findChain(chainId)
        const typedData = getAutoSignTypedData(origin, chainId)
        const signature = await signTypedDataAsync({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        })

        const wallet = await deriveWalletFromSignature(signature as Hex, chain.bech32_prefix)

        if (!cancelledDerivations.has(key)) {
          setDerivedWallets((prev) => ({ ...prev, [key]: wallet }))
        }

        return wallet
      } finally {
        pendingDerivations.delete(key)
        cancelledDerivations.delete(key)
      }
    })()

    pendingDerivations.set(key, derivationPromise)
    return derivationPromise
  }

  const getWallet = (chainId: string): DerivedWallet | undefined => {
    if (!userAddress) return undefined

    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId, userAddress)
    return derivedWallets[key]
  }

  const clearWallet = (chainId: string) => {
    if (!userAddress) return

    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId, userAddress)

    if (pendingDerivations.has(key)) {
      cancelledDerivations.add(key)
      pendingDerivations.delete(key)
    }

    clearExpectedAddress(origin, chainId, userAddress)

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

    const keysToRemove = Object.keys(localStorage).filter((key) =>
      key.startsWith(AUTOSIGN_STORAGE_PREFIX),
    )
    keysToRemove.forEach((key) => localStorage.removeItem(key))

    setDerivedWallets({})
  }

  return { deriveWallet, getWallet, clearWallet, clearAllWallets }
}

/* Sign auto-sign transactions with derived wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithDerivedWallet() {
  const { getWallet, deriveWallet } = useDeriveWallet()
  const registry = useRegistry()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    granterAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    let derivedWallet = getWallet(chainId)
    if (!derivedWallet) {
      derivedWallet = await deriveWallet(chainId)
    }

    const authzExecuteMessage: EncodeObject[] = [
      {
        typeUrl: "/cosmos.authz.v1beta1.MsgExec",
        value: MsgExec.fromPartial({
          grantee: derivedWallet.address,
          msgs: messages.map((msg) => ({
            typeUrl: msg.typeUrl,
            value: registry.encode(msg),
          })),
        }),
      },
    ]

    const delegatedFee: StdFee = {
      ...fee,
      granter: granterAddress,
    }

    const derivedSigner = new DerivedWalletSigner(derivedWallet)

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
