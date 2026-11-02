import { rawSecp256k1PubkeyToRawAddress } from "@cosmjs/amino"
import { keccak256, Secp256k1 } from "@cosmjs/crypto"
import { toBech32 } from "@cosmjs/encoding"
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing"
import { AuthInfo, type TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"

// The router chain info has no key algorithm field, so chains whose accounts use an
// Ethereum key (keccak256 address, ethsecp256k1 public key) are identified by chain ID.
export function isEthKeyChain(chainId: string) {
  return chainId.startsWith("injective-")
}

export interface SourceAccount {
  ethKey: boolean
  address: Uint8Array
  pubkey?: Uint8Array
}

function ethAddressFromPubkey(pubkey: Uint8Array) {
  return keccak256(Secp256k1.uncompressPubkey(pubkey).slice(1)).slice(-20)
}

// A failed hop refunds to the address given for that chain, so each intermediate address
// must be controlled by the source account's key. The raw address bytes carry over only
// when both chains derive addresses the same way; otherwise they come from the public key.
export function deriveCosmosAddress(
  chain: { chain_id: string; bech32_prefix: string },
  source: SourceAccount,
) {
  const ethKey = isEthKeyChain(chain.chain_id)
  if (ethKey === source.ethKey) return toBech32(chain.bech32_prefix, source.address)
  if (!source.pubkey) throw new Error("Pubkey not found")
  const address = ethKey
    ? ethAddressFromPubkey(source.pubkey)
    : rawSecp256k1PubkeyToRawAddress(Secp256k1.compressPubkey(source.pubkey))
  return toBech32(chain.bech32_prefix, address)
}

export function isPubkeyRequired(chainIds: string[], sourceEthKey: boolean) {
  return chainIds.some((chainId) => isEthKeyChain(chainId) !== sourceEthKey)
}

// CosmJS puts a secp256k1 public key in AuthInfo, but Injective verifies ethsecp256k1
// signatures (keccak256) only under its own public key type. Rewriting AuthInfo after
// signing is safe only in amino sign mode, whose sign bytes do not cover AuthInfo. A
// configured wallet whose amino-only signer still has `signDirect` makes CosmJS sign in
// direct mode, so that case throws instead of broadcasting a signature the chain rejects.
export function withInjectivePubkey(txRaw: TxRaw): TxRaw {
  const authInfo = AuthInfo.decode(txRaw.authInfoBytes)
  const signerInfos = authInfo.signerInfos.map((signerInfo) => {
    if (signerInfo.modeInfo?.single?.mode !== SignMode.SIGN_MODE_LEGACY_AMINO_JSON) {
      throw new Error("Injective transactions must be signed in amino mode")
    }
    if (!signerInfo.publicKey) return signerInfo
    const publicKey = {
      ...signerInfo.publicKey,
      typeUrl: "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
    }
    return { ...signerInfo, publicKey }
  })
  return { ...txRaw, authInfoBytes: AuthInfo.encode({ ...authInfo, signerInfos }).finish() }
}
