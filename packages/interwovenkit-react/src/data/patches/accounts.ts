import type { Any } from "cosmjs-types/google/protobuf/any"
import { PubKey as CosmosCryptoSecp256k1Pubkey } from "cosmjs-types/cosmos/crypto/secp256k1/keys"
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth"
import { encodeSecp256k1Pubkey, type Pubkey } from "@cosmjs/amino"
import { decodeOptionalPubkey } from "@cosmjs/proto-signing"
import type { Account } from "@cosmjs/stargate"
import { accountFromAny } from "@cosmjs/stargate"

function decodeOptionalPubkeyInitia(pubkey: Any | null | undefined): Pubkey | null {
  if (pubkey?.typeUrl === "/initia.crypto.v1beta1.ethsecp256k1.PubKey") {
    const { key } = CosmosCryptoSecp256k1Pubkey.decode(pubkey.value)
    return encodeSecp256k1Pubkey(key)
  }

  return decodeOptionalPubkey(pubkey)
}

export function parseAccount({ typeUrl, value }: Any): Account {
  if (typeUrl === "/cosmos.auth.v1beta1.BaseAccount") {
    const { address, pubKey, accountNumber, sequence } = BaseAccount.decode(value)
    const pubkey = decodeOptionalPubkeyInitia(pubKey)
    return { address, pubkey, accountNumber: Number(accountNumber), sequence: Number(sequence) }
  }

  return accountFromAny({ typeUrl, value })
}
