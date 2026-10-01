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
import { Secp256k1Signature } from "@cosmjs/crypto"
import { fromBase64, fromHex } from "@cosmjs/encoding"
import { Int53 } from "@cosmjs/math"
import type { EncodeObject, TxBodyEncodeObject } from "@cosmjs/proto-signing"
import { makeAuthInfoBytes, Registry } from "@cosmjs/proto-signing"
import { AminoTypes, SigningStargateClient } from "@cosmjs/stargate"
import { Comet38Client, HttpClient } from "@cosmjs/tendermint-rpc"
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import type { Eip1193Provider } from "ethers"
import { BrowserProvider } from "ethers"
import ky from "ky"
import { useAccount, useSignMessage } from "wagmi"
import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { protoRegistry } from "@initia/amino-converter"
import { useInitiaAddress } from "@/public/data/hooks"
import { parseAccount } from "./patches/accounts"
import { patchedAminoConverters } from "./patches/amino"
import { encodeEthSecp256k1Pubkey } from "./patches/encoding"
import { encodePubkeyInitia } from "./patches/pubkeys"
import { encodeEthSecp256k1Signature } from "./patches/signature"
import { accountQueryKeys } from "./account"
import { useFindChain, useLayer1 } from "./chains"
import { useConfig } from "./config"
import { loadPublicKey, recoverPublicKey, storePublicKey } from "./public-key"

export const useRegistry = () => {
  const config = useConfig()
  return new Registry([...protoRegistry, ...(config.protoTypes ?? [])])
}

export const useAminoConverters = () => {
  const config = useConfig()
  return { ...patchedAminoConverters, ...config.aminoConverters }
}

export const useAminoTypes = () => {
  const aminoConverters = useAminoConverters()
  return new AminoTypes(aminoConverters)
}

export class OfflineSigner implements OfflineAminoSigner {
  constructor(
    private address: string,
    private signMessage: (message: string) => Promise<string>,
    private restUrl: string,
  ) {}

  // Cache the public key so we don't have to ask the wallet to sign the
  // identification message every time a transaction is built.
  private cachedPublicKey: Uint8Array | null = null
  private setCachedPublicKey(publicKey: Uint8Array) {
    this.cachedPublicKey = publicKey
    storePublicKey(this.address, publicKey)
  }

  private async getCachedPublicKey() {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey
    }

    const storedPublicKey = loadPublicKey(this.address)
    if (storedPublicKey) {
      this.cachedPublicKey = storedPublicKey
      return storedPublicKey
    }

    // Try to fetch the public key from L1 REST API first
    const publicKeyFromRestApi = await this.getPublicKeyFromRestApi()
    if (publicKeyFromRestApi) {
      this.setCachedPublicKey(publicKeyFromRestApi)
      return publicKeyFromRestApi
    }

    // Fallback to signature-based derivation if API doesn't have the public key
    const publicKey = await this.getPublicKey()
    this.setCachedPublicKey(publicKey)
    return publicKey
  }

  private async getPublicKeyFromRestApi(): Promise<Uint8Array | null> {
    try {
      const data = await ky
        .create({ prefixUrl: this.restUrl })
        .get(`cosmos/auth/v1beta1/account_info/${this.address}`)
        .json<{ info: { pub_key: { "@type": string; key: string } | null } }>()

      const pubKey = data?.info?.pub_key?.key

      if (!pubKey) return null

      // The API returns the public key in base64 format
      return fromBase64(pubKey)
    } catch {
      // If the API call fails, return null to fallback to signature-based derivation
      return null
    }
  }

  private async getPublicKey() {
    // Recover the public key by having the wallet sign a fixed message once.
    // EIP-191 is supported across wallets and doesn't require a prior key
    // exchange. Because the message is constant it could be reused by a
    // malicious host to derive the user's public key without explicit consent.
    // The key itself is not sensitive.
    const message = "Sign this message to identify your Initia account."
    const signature = await this.signMessage(message)
    return recoverPublicKey(message, signature)
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

    // The transaction signature itself reveals the public key, so signing never has to
    // request a separate identification signature first. This matters for popup-based
    // wallets: browsers block a second popup because the first one already consumed the
    // click's user activation, so a two-signature flow could never complete.
    const publicKey = recoverPublicKey(signDocAminoJSON, signatureHex)
    this.setCachedPublicKey(publicKey)

    const signatureFromHex = fromHex(signatureHex.replace("0x", "")).subarray(0, -1)
    const secp256signature = Secp256k1Signature.fromFixedLength(signatureFromHex)
    const signatureBytes = secp256signature.toFixedLength()
    const signature = encodeEthSecp256k1Signature(publicKey, signatureBytes)

    return { signed: signDoc, signature }
  }
}

export interface AccountSequence {
  accountNumber: number
  sequence: number
}

/* Fetches the signer's account number and sequence ahead of the approval click. With it in
 * hand, signing reaches the wallet without a network round trip in between. That matters
 * for Safari: it keeps a click's user activation only across microtasks, not across real
 * async waits, and popup-based wallets are blocked by the popup blocker once it is gone. */
export function useSignerAccountSequenceQuery(chainId: string) {
  const address = useInitiaAddress()
  const createSigningStargateClient = useCreateSigningStargateClient()

  return useQuery({
    queryKey: accountQueryKeys.sequence(chainId, address).queryKey,
    queryFn: async (): Promise<AccountSequence> => {
      const client = await createSigningStargateClient(chainId)
      return client.getSequence(address)
    },
    enabled: !!address,
    // A sequence is only valid until the next transaction lands, so never serve a cached one.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/* Drops a prefetched sequence once a transaction is known to be included, so an open
 * approval looks it up again. Broadcasting alone leaves the committed sequence unchanged,
 * so only observed settlements call this. */
export function useInvalidateAccountSequence() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: accountQueryKeys.sequence._def })
}

/* After a failed refetch TanStack Query keeps the previous data. That sequence may already
 * be consumed by a transaction sent elsewhere, so it is dropped and signing looks it up again. */
export function selectPrefetchedAccountSequence({
  data,
  isError,
}: {
  data: AccountSequence | undefined
  isError: boolean
}): AccountSequence | undefined {
  return isError ? undefined : data
}

export function useSignWithEthSecp256k1() {
  const registry = useRegistry()
  const aminoTypes = useAminoTypes()
  const offlineSigner = useOfflineSigner()
  const createSigningStargateClient = useCreateSigningStargateClient()

  return async function (
    chainId: string,
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo: string,
    options?: {
      incrementSequence?: number
      customSigner?: OfflineAminoSigner
      accountSequence?: AccountSequence
    },
  ): Promise<TxRaw> {
    const signer = options?.customSigner ?? offlineSigner
    if (!signer) throw new Error("Signer not initialized")
    const client = await createSigningStargateClient(chainId)
    const { accountNumber, sequence } =
      options?.accountSequence ??
      (await resolveSignerAccountSequence({
        getSequence: (address) => client.getSequence(address),
        signerAddress,
        incrementSequence: options?.incrementSequence ?? 0,
        // Derived autosign wallets may not have an account yet. In that case, use zero defaults.
        allowMissingAccount: !!options?.customSigner,
      }))

    // Returns a signed tx that includes `signerInfos`, `fee`, and the `signatures` created with OfflineSigner's `signAmino()`.
    // https://github.com/cosmos/cosmjs/blob/main/packages/stargate/src/signingstargateclient.ts
    // This overrides SigningStargateClient's `signAmino()` method because
    // 1. it doesn't support Initia's `EthSecp256k1Pubkey`
    // 2. it forces the `signMode` to `SIGN_MODE_LEGACY_AMINO_JSON`.
    /* 2 */ const signMode = SignMode.SIGN_MODE_EIP_191
    const msgs = messages.map((msg) => aminoTypes.toAmino(msg))
    const signDoc = makeSignDocAmino(msgs, fee, chainId, memo, accountNumber, sequence)
    const { signature, signed } = await signer.signAmino(signerAddress, signDoc)
    // The signature response carries the public key, so `signer.getAccounts()` is not
    // consulted here: for a wallet whose key is not cached yet it would open a wallet
    // request of its own before the signing request.
    /* 1 */ const pubkey = encodePubkeyInitia(
      encodeEthSecp256k1Pubkey(fromBase64(signature.pub_key.value)),
    )
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

function isMissingAccountSequenceError(error: unknown, address: string): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return /does not exist on chain/i.test(error.message) && error.message.includes(address)
}

export async function resolveSignerAccountSequence({
  getSequence,
  signerAddress,
  incrementSequence,
  allowMissingAccount,
}: {
  getSequence: (address: string) => Promise<{ accountNumber: number; sequence: number }>
  signerAddress: string
  incrementSequence: number
  allowMissingAccount: boolean
}): Promise<{ accountNumber: number; sequence: number }> {
  try {
    const { accountNumber, sequence } = await getSequence(signerAddress)

    // Handle sequence increments for minievm chains.
    // Note: minievm increases sequence by 1 per MsgCall (unlike move/wasm chains which use 1 per tx).
    return { accountNumber, sequence: sequence + incrementSequence }
  } catch (error) {
    if (allowMissingAccount && isMissingAccountSequenceError(error, signerAddress)) {
      return { accountNumber: 0, sequence: incrementSequence }
    }

    throw error
  }
}

export function useOfflineSigner() {
  const address = useInitiaAddress()
  const { signMessageAsync } = useSignMessage()
  const layer1 = useLayer1()
  return useMemo(
    () => new OfflineSigner(address, (message) => signMessageAsync({ message }), layer1.restUrl),
    [address, signMessageAsync, layer1.restUrl],
  )
}

// Keep one client per chain to avoid repeatedly establishing RPC connections.
const comet38ClientCache = new Map<string, Comet38Client>()
const signingStargateClientCache = new Map<string, SigningStargateClient>()

export function clearSigningClientCache(address: string, chainId: string) {
  const prefix = `${address}:${chainId}:`
  for (const key of signingStargateClientCache.keys()) {
    if (key.startsWith(prefix)) signingStargateClientCache.delete(key)
  }
}

export function useCreateComet38Client() {
  const findChain = useFindChain()

  return async (chainId: string) => {
    const { rpcUrl } = findChain(chainId)
    const cacheKey = `${chainId}:${rpcUrl}`
    if (comet38ClientCache.has(cacheKey)) {
      return comet38ClientCache.get(cacheKey)!
    }
    const cometClient = await Comet38Client.create(new HttpClient(rpcUrl))

    comet38ClientCache.set(cacheKey, cometClient)
    return cometClient
  }
}

export function useCreateSigningStargateClient() {
  const registry = useRegistry()
  const aminoTypes = useAminoTypes()
  const offlineSigner = useOfflineSigner()
  const address = useInitiaAddress()
  const findChain = useFindChain()
  const createComet38Client = useCreateComet38Client()

  return async (chainId: string) => {
    const cacheKey = `${address}:${chainId}:${findChain(chainId).rpcUrl}`
    if (signingStargateClientCache.has(cacheKey)) {
      return signingStargateClientCache.get(cacheKey)!
    }

    if (!offlineSigner) throw new Error("Signer not initialized")

    const cometClient = await createComet38Client(chainId)
    const client = await SigningStargateClient.createWithSigner(cometClient, offlineSigner, {
      registry,
      aminoTypes,
      accountParser: parseAccount,
      broadcastPollIntervalMs: 500,
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
