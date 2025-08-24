import type { Any } from "@interchainjs/cosmos-types"
import { CosmosCryptoSecp256k1PubKey } from "@interchainjs/cosmos-types"
import { BaseAccount } from "@interchainjs/cosmos-types"
import { encodeSecp256k1Pubkey, type Pubkey } from "@interchainjs/amino"
import { decodeOptionalPubkey } from "@interchainjs/pubkey"

function decodeOptionalPubkeyInitia(pubkey: Any | null | undefined): Pubkey | null {
  if (pubkey?.typeUrl === "/initia.crypto.v1beta1.ethsecp256k1.PubKey") {
    const { key } = CosmosCryptoSecp256k1PubKey.decode(pubkey.value)
    return encodeSecp256k1Pubkey(key)
  }

  return decodeOptionalPubkey(pubkey)
}

export function parseAccount({ value }: Any) {
  const { address, pubKey, accountNumber, sequence } = BaseAccount.decode(value)
  const pubkey = decodeOptionalPubkeyInitia(pubKey)
  return { address, pubkey, accountNumber: Number(accountNumber), sequence: Number(sequence) }
}
