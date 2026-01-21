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
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { deriveWalletFromSignature, getAutoSignTypedData, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, derivedWalletsAtom } from "./store"

const pendingDerivations = new Map<string, Promise<DerivedWallet>>()

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

/**
 * Manage deriving, caching, and lifecycle of derived wallets for the current origin and a given chainId.
 *
 * Derives a wallet from an EIP-712 signature (prompting the user once per origin+chainId), caches derived wallets in state, deduplicates concurrent derivations, and provides accessors to retrieve or clear stored wallets.
 *
 * @returns An object with:
 * - `deriveWallet(chainId)` - Derives (or returns a cached) `DerivedWallet` for the current origin and `chainId`; concurrent calls for the same origin+chainId return the same in-flight promise.
 * - `getWallet(chainId)` - Returns the cached `DerivedWallet` for the current origin and `chainId`, or `undefined` if none exists.
 * - `clearWallet(chainId)` - Removes the cached derived wallet for the current origin and `chainId`.
 * - `clearAllWallets()` - Clears all cached derived wallets for the current origin.
 */
export function useDeriveWallet() {
  const [derivedWallets, setDerivedWallets] = useAtom(derivedWalletsAtom)
  const { signTypedDataAsync } = useSignTypedData()

  const deriveWallet = async (chainId: string): Promise<DerivedWallet> => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)

    if (derivedWallets[key]) {
      return derivedWallets[key]
    }

    if (pendingDerivations.has(key)) {
      return pendingDerivations.get(key)!
    }

    const derivationPromise = (async () => {
      try {
        const typedData = getAutoSignTypedData(origin, chainId)
        const signature = await signTypedDataAsync({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        })

        const wallet = await deriveWalletFromSignature(signature as Hex)
        setDerivedWallets((prev) => ({ ...prev, [key]: wallet }))
        return wallet
      } finally {
        pendingDerivations.delete(key)
      }
    })()

    pendingDerivations.set(key, derivationPromise)
    return derivationPromise
  }

  const getWallet = (chainId: string): DerivedWallet | undefined => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)
    return derivedWallets[key]
  }

  const clearWallet = (chainId: string) => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)
    setDerivedWallets((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const clearAllWallets = () => {
    setDerivedWallets({})
  }

  return { deriveWallet, getWallet, clearWallet, clearAllWallets }
}

/**
 * Get the derived wallet address for the current origin and given chain ID.
 *
 * @param chainId - The target chain identifier
 * @returns The derived wallet address for the origin and `chainId`, or `undefined` if no derived wallet exists
 */
export function useDerivedWalletAddress(chainId: string) {
  const { getWallet } = useDeriveWallet()
  return getWallet(chainId)?.address
}

/**
 * Provide a signer function that wraps messages in an authz MsgExec and signs the delegated transaction with a derived wallet.
 *
 * The returned async function will ensure a derived wallet exists for the given chainId (deriving one if necessary), wrap the provided messages in a MsgExec with the derived wallet as grantee, set the fee's granter to the provided granter address, and produce a signed TxRaw using the derived wallet.
 *
 * @returns An async function (chainId, granterAddress, messages, fee, memo) that signs the delegated transaction and resolves to the resulting `TxRaw`.
 */
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