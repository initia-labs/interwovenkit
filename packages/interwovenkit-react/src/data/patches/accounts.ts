import { encodeSecp256k1Pubkey, type Pubkey } from "@cosmjs/amino"
import { decodeOptionalPubkey } from "@cosmjs/proto-signing"
import type { Account } from "@cosmjs/stargate"
import { accountFromAny } from "@cosmjs/stargate"
import { BinaryReader } from "cosmjs-types/binary"
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth"
import { PubKey as CosmosCryptoSecp256k1Pubkey } from "cosmjs-types/cosmos/crypto/secp256k1/keys"
import type { Any } from "cosmjs-types/google/protobuf/any"

// Both wrap the same `bytes key = 1` message as the Cosmos secp256k1 key.
const ETH_SECP256K1_PUBKEY_TYPE_URLS = [
  "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
  "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
]

function decodeOptionalPubkeyInitia(pubkey: Any | null | undefined): Pubkey | null {
  if (pubkey && ETH_SECP256K1_PUBKEY_TYPE_URLS.includes(pubkey.typeUrl)) {
    const { key } = CosmosCryptoSecp256k1Pubkey.decode(pubkey.value)
    return encodeSecp256k1Pubkey(key)
  }

  return decodeOptionalPubkey(pubkey)
}

function toAccount({ address, pubKey, accountNumber, sequence }: BaseAccount): Account {
  const pubkey = decodeOptionalPubkeyInitia(pubKey)
  return { address, pubkey, accountNumber: Number(accountNumber), sequence: Number(sequence) }
}

/** Reads `base_account` (field 1) of `/injective.types.v1beta1.EthAccount`; `code_hash` is not needed. */
function decodeInjectiveEthAccount(value: Uint8Array): BaseAccount {
  const reader = new BinaryReader(value)
  while (reader.pos < reader.len) {
    const tag = reader.uint32()
    if (tag >>> 3 === 1) return BaseAccount.decode(reader, reader.uint32())
    reader.skipType(tag & 7)
  }
  throw new Error("EthAccount is missing base_account")
}

export function parseAccount({ typeUrl, value }: Any): Account {
  if (typeUrl === "/cosmos.auth.v1beta1.BaseAccount") {
    return toAccount(BaseAccount.decode(value))
  }

  if (typeUrl === "/injective.types.v1beta1.EthAccount") {
    return toAccount(decodeInjectiveEthAccount(value))
  }

  return accountFromAny({ typeUrl, value })
}
