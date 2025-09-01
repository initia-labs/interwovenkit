import type { OfflineAminoSigner, OfflineDirectSigner, AccountData } from "@interchainjs/cosmos"
import type { StdSignDoc } from "@interchainjs/types"
import { SignDoc, CosmosCryptoSecp256k1PubKey as PubKey } from "@interchainjs/cosmos-types"
import { InitiaAddress } from "@initia/utils"
import type { PublicKeyCache } from "./PublicKeyCache"
import { fromHex, toBase64, toHex } from "@interchainjs/encoding"

export class EthereumOfflineSigner implements OfflineDirectSigner, OfflineAminoSigner {
  constructor(
    private ethAddress: string,
    private signMessage: (message: string) => Promise<string>,
    private publicKeyCache: PublicKeyCache,
  ) {}

  /**
   * Return AccountData[] with populated pubkey and getPublicKey()
   * - pubkey: compressed secp256k1 public key bytes (33 bytes)
   * - algo: 'secp256k1'
   * - getPublicKey(): EncodedMessage for default Cosmos pubkey type
   */
  async getAccounts(): Promise<readonly AccountData[]> {
    // Derive the compressed secp256k1 pubkey from MetaMask by signing a known message
    const publicKey = await this.publicKeyCache.getPublicKey(this.ethAddress)

    return [
      {
        address: InitiaAddress(this.ethAddress).bech32,
        pubkey: publicKey, // used directly by InterchainJS (SignerInfoPlugin)
        algo: "secp256k1",
        // @ts-expect-error InterchainJS
        getPublicKey: () => {
          return {
            typeUrl: "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
            value: PubKey.encode(PubKey.fromPartial({ key: publicKey })).finish(),
          }
        },
      },
    ]
  }

  async signDirect(_signerAddress: string, signDoc: SignDoc) {
    const bytes = SignDoc.encode(signDoc).finish()
    const signatureB64 = await this.signWithPersonalSign(bytes)
    return {
      signed: signDoc,
      signature: { signature: signatureB64, pub_key: await this.pubkeyFor() },
    }
  }

  async signAmino(_signerAddress: string, signDoc: StdSignDoc) {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        account_number: signDoc.account_number,
        chain_id: signDoc.chain_id,
        fee: signDoc.fee,
        memo: signDoc.memo,
        msgs: signDoc.msgs,
        sequence: signDoc.sequence,
      }),
    )
    const signatureB64 = await this.signWithPersonalSign(bytes)
    return {
      signed: signDoc,
      signature: { signature: signatureB64, pub_key: await this.pubkeyFor() },
    }
  }

  // EIP-191 personal_sign wrapper -> base64 signature for Cosmos
  private async signWithPersonalSign(data: Uint8Array): Promise<string> {
    const sigHex = await this.signMessage(toHex(data))
    return toBase64(fromHex(sigHex.slice(2)))
  }

  /**
   * Return StdSignature.pub_key structure for Amino/Direct responses
   * type: tendermint/PubKeySecp256k1, value: base64(compressedPubKey)
   */
  private async pubkeyFor() {
    const compressed = await this.publicKeyCache.getPublicKey(this.ethAddress)
    return {
      type: "initia/PubKeyEthSecp256k1",
      value: toBase64(compressed),
    }
  }
}
