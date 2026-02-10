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
import { useAtom } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useFindChain } from "@/data/chains"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { deriveWalletFromSignature, getAutoSignMessage, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, derivedWalletsAtom } from "./store"

const pendingDerivations = new Map<string, Promise<DerivedWallet>>()
const cancelledDerivations = new Set<string>()

interface MessageEncoder {
  encode: (message: EncodeObject) => Uint8Array
}

/* Expected address storage for wallet migration detection.
 * Stores the derived wallet address in localStorage to detect when on-chain grants
 * were created by a different derivation method (e.g., previous Privy-based system).
 * Without this, users with previous grants would see auto-sign as "enabled" but transactions
 * would fail because the current derivation produces a different wallet address.
 * Note: origin is not included in key since each origin has its own localStorage namespace. */
const AUTOSIGN_STORAGE_PREFIX = "autosign:"

export function getExpectedAddressKey(userAddress: string): string {
  return `${AUTOSIGN_STORAGE_PREFIX}${userAddress}`
}

export function getExpectedAddress(userAddress: string): string | null {
  return localStorage.getItem(getExpectedAddressKey(userAddress))
}

export function storeExpectedAddress(userAddress: string, address: string): void {
  localStorage.setItem(getExpectedAddressKey(userAddress), address)
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

/* Derive and store wallet from EIP-191 signature for autosign delegation.
 * Uses personal_sign instead of signTypedData for better hardware wallet compatibility.
 * The same derived wallet is used across all chains for the same user. */
export function useDeriveWallet() {
  const [derivedWallets, setDerivedWallets] = useAtom(derivedWalletsAtom)
  const { signMessageAsync } = useSignMessage()
  const findChain = useFindChain()
  const userAddress = useInitiaAddress()

  const deriveWallet = async (chainId: string): Promise<DerivedWallet> => {
    if (!userAddress) {
      throw new Error("User address not available")
    }

    const key = getDerivedWalletKey(userAddress)

    if (derivedWallets[key]) {
      return derivedWallets[key]
    }

    if (pendingDerivations.has(key)) {
      return pendingDerivations.get(key)!
    }

    const promiseRef: { current?: Promise<DerivedWallet> } = {}

    const derivationPromise = (async () => {
      try {
        const chain = findChain(chainId)
        const origin = window.location.origin
        const message = getAutoSignMessage(origin)
        const signature = await signMessageAsync({ message })

        const wallet = await deriveWalletFromSignature(signature as Hex, chain.bech32_prefix)

        if (!cancelledDerivations.has(key)) {
          setDerivedWallets((prev) => ({ ...prev, [key]: wallet }))
        }

        return wallet
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

  const getWallet = (): DerivedWallet | undefined => {
    if (!userAddress) return undefined
    const key = getDerivedWalletKey(userAddress)
    return derivedWallets[key]
  }

  const clearWallet = () => {
    if (!userAddress) return

    const key = getDerivedWalletKey(userAddress)

    if (pendingDerivations.has(key)) {
      cancelledDerivations.add(key)
      pendingDerivations.delete(key)
    }

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
    setDerivedWallets({})
  }

  return { deriveWallet, getWallet, clearWallet, clearAllWallets }
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
    let derivedWallet = getWallet()
    if (!derivedWallet) {
      derivedWallet = await deriveWallet(chainId)
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
