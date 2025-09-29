import type { Eip1193Provider } from "ethers"
import { useAccount, useSignMessage } from "wagmi"
import { BrowserProvider, ethers } from "ethers"
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import type {
  AccountData,
  Algo,
  AminoSignResponse,
  OfflineAminoSigner,
  StdFee,
  StdSignDoc,
} from "@cosmjs/amino"
import {
  escapeCharacters,
  makeSignDoc as makeSignDocAmino,
  sortedJsonStringify,
} from "@cosmjs/amino/build/signdoc"
import { Secp256k1, Secp256k1Signature } from "@cosmjs/crypto"
import { fromBase64, fromHex, toHex } from "@cosmjs/encoding"
import { Int53 } from "@cosmjs/math"
import type { EncodeObject, TxBodyEncodeObject } from "@cosmjs/proto-signing"
import { makeAuthInfoBytes, Registry } from "@cosmjs/proto-signing"
import { AminoTypes, SigningStargateClient } from "@cosmjs/stargate"
import { Comet38Client, HttpClient } from "@cosmjs/tendermint-rpc"
import { useMemo } from "react"
import { aminoConverters, protoRegistry } from "@initia/amino-converter"
import { useInitiaAddress } from "@/public/data/hooks"
import { parseAccount } from "./patches/accounts"
import { encodeEthSecp256k1Pubkey } from "./patches/encoding"
import { encodePubkeyInitia } from "./patches/pubkeys"
import { encodeEthSecp256k1Signature } from "./patches/signature"
import { LocalStorageKey } from "./constants"
import { useConfig } from "./config"
import { useFindChain } from "./chains"

export const useRegistry = () => {
  const config = useConfig()
  return new Registry([...protoRegistry, ...(config.protoTypes ?? [])])
}

export const useAminoTypes = () => {
  const config = useConfig()
  return new AminoTypes({ ...aminoConverters, ...config.aminoConverters })
}

export class OfflineSigner implements OfflineAminoSigner {
  constructor(
    private address: string,
    private signMessage: (message: string) => Promise<string>,
  ) {}

  // Cache the public key so we don't have to ask the wallet to sign the
  // identification message every time a transaction is built.
  private cachedPublicKey: Uint8Array | null = null
  private async getCachedPublicKey() {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey
    }

    // Persist the derived key in localStorage so reloads don't trigger another
    // sign request. Note that the host page can also access this key since
    // localStorage is scoped to the embedding origin. The key itself is not
    // secret.
    const storageKey = `${LocalStorageKey.PUBLIC_KEY}:${this.address}`
    const localPublicKey = localStorage.getItem(storageKey)
    if (localPublicKey) {
      this.cachedPublicKey = fromHex(localPublicKey)
      return fromHex(localPublicKey)
    }

    const publicKey = await this.getPublicKey()
    this.cachedPublicKey = publicKey
    localStorage.setItem(storageKey, toHex(publicKey))

    return publicKey
  }

  private async getPublicKey() {
    // Recover the public key by having the wallet sign a fixed message once.
    // EIP-191 is supported across wallets and doesn't require a prior key
    // exchange. Because the message is constant it could be reused by a
    // malicious host to derive the user's public key without explicit consent.
    // The key itself is not sensitive.
    const message = "Sign this message to identify your Initia account."
    const signature = await this.signMessage(message)
    const messageHash = ethers.hashMessage(message)
    const uncompressedPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature)
    return Secp256k1.compressPubkey(fromHex(uncompressedPublicKey.replace("0x", "")))
  }

  async getAccounts(): Promise<readonly AccountData[]> {
    return [
      {
        address: this.address,
        algo: "ethsecp256k1" as Algo,
        pubkey: await this.getCachedPublicKey(),
      },
    ]
  }

  async signAmino(signerAddress: string, signDoc: StdSignDoc): Promise<AminoSignResponse> {
    if (this.address !== signerAddress) {
      throw new Error("Signer address does not match the provided address")
    }

    const signDocAminoJSON = escapeCharacters(sortedJsonStringify(signDoc))
    const signatureHex = await this.signMessage(signDocAminoJSON)
    const signatureFromHex = fromHex(signatureHex.replace("0x", "")).subarray(0, -1)
    const secp256signature = Secp256k1Signature.fromFixedLength(signatureFromHex)
    const signatureBytes = secp256signature.toFixedLength()
    const signature = encodeEthSecp256k1Signature(await this.getCachedPublicKey(), signatureBytes)

    return { signed: signDoc, signature }
  }
}

export function useSignWithEthSecp256k1() {
  const registry = useRegistry()
  const aminoTypes = useAminoTypes()
  const signer = useOfflineSigner()
  const createSigningStargateClient = useCreateSigningStargateClient()

  return async function (
    chainId: string,
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo: string,
    options?: { incrementSequence?: number },
  ): Promise<TxRaw> {
    if (!signer) throw new Error("Signer not initialized")
    const client = await createSigningStargateClient(chainId)
    const { accountNumber, ...account } = await client.getSequence(signerAddress)
    // Optionally increment sequence to handle concurrent transactions on the same chain
    const sequence = account.sequence + (options?.incrementSequence ?? 0)

    // Returns a signed tx that includes `signerInfos`, `fee`, and the `signatures` created with OfflineSigner's `signAmino()`.
    // https://github.com/cosmos/cosmjs/blob/main/packages/stargate/src/signingstargateclient.ts
    // This overrides SigningStargateClient's `signAmino()` method because
    // 1. it doesn't support Initia's `EthSecp256k1Pubkey`
    // 2. it forces the `signMode` to `SIGN_MODE_LEGACY_AMINO_JSON`.
    const [accountFromSigner] = await signer.getAccounts()
    /* 1 */ const pubkey = encodePubkeyInitia(encodeEthSecp256k1Pubkey(accountFromSigner.pubkey))
    /* 2 */ const signMode = SignMode.SIGN_MODE_EIP_191
    const msgs = messages.map((msg) => aminoTypes.toAmino(msg))
    const signDoc = makeSignDocAmino(msgs, fee, chainId, memo, accountNumber, sequence)
    const { signature, signed } = await signer.signAmino(signerAddress, signDoc)
    const signedTxBody = {
      messages: signed.msgs.map((msg) => aminoTypes.fromAmino(msg)),
      memo,
    }
    const signedTxBodyEncodeObject: TxBodyEncodeObject = {
      typeUrl: "/cosmos.tx.v1beta1.TxBody",
      value: signedTxBody,
    }
    const signedTxBodyBytes = registry.encode(signedTxBodyEncodeObject)
    const signedGasLimit = Int53.fromString(signed.fee.gas).toNumber()
    const signedSequence = Int53.fromString(signed.sequence).toNumber()
    const signedAuthInfoBytes = makeAuthInfoBytes(
      [{ pubkey, sequence: signedSequence }],
      signed.fee.amount,
      signedGasLimit,
      signed.fee.granter,
      signed.fee.payer,
      signMode,
    )
    return TxRaw.fromPartial({
      bodyBytes: signedTxBodyBytes,
      authInfoBytes: signedAuthInfoBytes,
      signatures: [fromBase64(signature.signature)],
    })
  }
}

export function useOfflineSigner() {
  const address = useInitiaAddress()
  const { signMessageAsync } = useSignMessage()
  return useMemo(
    () => new OfflineSigner(address, (message) => signMessageAsync({ message })),
    [address, signMessageAsync],
  )
}

// Keep one client per chain to avoid repeatedly establishing RPC connections.
const comet38ClientCache = new Map<string, Comet38Client>()
const signingStargateClientCache = new Map<string, SigningStargateClient>()

export function useCreateComet38Client() {
  const findChain = useFindChain()

  return async (chainId: string) => {
    if (comet38ClientCache.has(chainId)) {
      return comet38ClientCache.get(chainId)!
    }

    const { rpcUrl } = findChain(chainId)
    const cometClient = await Comet38Client.create(new HttpClient(rpcUrl))

    comet38ClientCache.set(chainId, cometClient)
    return cometClient
  }
}

export function useCreateSigningStargateClient() {
  const registry = useRegistry()
  const aminoTypes = useAminoTypes()
  const offlineSigner = useOfflineSigner()
  const address = useInitiaAddress()
  const createComet38Client = useCreateComet38Client()

  return async (chainId: string) => {
    const cacheKey = `${address}:${chainId}`
    if (signingStargateClientCache.has(cacheKey)) {
      return signingStargateClientCache.get(cacheKey)!
    }

    if (!offlineSigner) throw new Error("Signer not initialized")

    const cometClient = await createComet38Client(chainId)
    const client = await SigningStargateClient.createWithSigner(cometClient, offlineSigner, {
      registry,
      aminoTypes,
      accountParser: parseAccount,
      broadcastPollIntervalMs: 1000,
    })

    signingStargateClientCache.set(cacheKey, client)
    return client
  }
}

export function useGetProvider() {
  const { connector } = useAccount()
  return async () => {
    if (!connector) throw new Error("Wallet not connected")
    return new BrowserProvider((await connector.getProvider()) as Eip1193Provider)
  }
}
