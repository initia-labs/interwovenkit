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
import { InitiaAddress } from "@initia/utils"
import { useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
import { useIsPrivyConnected } from "@/data/privy"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { deriveWalletFromSignature, getAutoSignTypedData, getDerivedWalletKey } from "./derivation"
import { type DerivedWallet, derivedWalletsAtom } from "./store"

/* Offline signer implementation for derived wallet */
class DerivedWalletSigner implements OfflineAminoSigner {
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

  const deriveWallet = async (chainId: string): Promise<DerivedWallet> => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)

    if (derivedWallets[key]) {
      return derivedWallets[key]
    }

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

/* Get derived wallet address for current origin and chain */
export function useDerivedWalletAddress(chainId: string) {
  const { getWallet } = useDeriveWallet()
  return getWallet(chainId)?.address
}

/* Sign auto-sign transactions with derived wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithDerivedWallet() {
  const { getWallet } = useDeriveWallet()
  const registry = useRegistry()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    granterAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    const derivedWallet = getWallet(chainId)
    if (!derivedWallet) {
      throw new Error("Derived wallet not found. Please unlock auto-sign first.")
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

/* Retrieve embedded wallet instance from Privy context for auto-sign delegation */
export function useEmbeddedWallet() {
  const { privyContext } = useConfig()
  const isConnected = useIsPrivyConnected()
  if (!privyContext || !isConnected) return undefined
  return privyContext.wallets.find((wallet) => wallet.connectorType === "embedded")
}

/* Extract embedded wallet address and convert to Initia Bech32 format */
export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()
  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

/* Sign auto-sign transactions with embedded wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithEmbeddedWallet() {
  const embeddedWallet = useEmbeddedWallet()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const registry = useRegistry()
  const findChain = useFindChain()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    address: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    if (!embeddedWallet || !embeddedWalletAddress) {
      throw new Error("Embedded wallet not initialized")
    }

    // Wrap messages in MsgExec for authz delegation
    const authzExecuteMessage: EncodeObject[] = [
      {
        typeUrl: "/cosmos.authz.v1beta1.MsgExec",
        value: MsgExec.fromPartial({
          grantee: embeddedWalletAddress,
          msgs: messages.map((msg) => ({
            typeUrl: msg.typeUrl,
            value: registry.encode(msg),
          })),
        }),
      },
    ]

    // Set fee granter for delegated transaction
    const delegatedFee: StdFee = {
      ...fee,
      granter: address,
    }

    // Create signer instance for delegate wallet
    const delegateSigner = new OfflineSigner(
      embeddedWalletAddress,
      embeddedWallet.sign,
      findChain(chainId).restUrl,
    )

    // Sign transaction with delegate wallet
    return await signWithEthSecp256k1(
      chainId,
      embeddedWalletAddress,
      authzExecuteMessage,
      delegatedFee,
      memo,
      { customSigner: delegateSigner },
    )
  }
}
