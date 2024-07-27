import { Any } from "cosmjs-types/google/protobuf/any"
import { PubKey as CosmosCryptoSecp256k1Pubkey } from "cosmjs-types/cosmos/crypto/secp256k1/keys"
import type { Pubkey } from "@cosmjs/amino"
import { pubkeyType } from "@cosmjs/amino"
import { fromBase64 } from "@cosmjs/encoding"
import { encodePubkey } from "@cosmjs/proto-signing"
import type { EthSecp256k1Pubkey } from "./encoding"

export function isEthSecp256k1Pubkey(pubkey: Pubkey): pubkey is EthSecp256k1Pubkey {
  return (pubkey as EthSecp256k1Pubkey).type === "initia/PubKeyEthSecp256k1"
}

export const pubkeyTypeInitia = {
  ...pubkeyType,
  /** https://github.com/initia-labs/initia/blob/main/crypto/ethsecp256k1/ethsecp256k1.go#L40 */
  ethsecp256k1: "initia/PubKeyEthSecp256k1" as const,
}

/**
 * Takes a pubkey in the Amino JSON object style (type/value wrapper)
 * and convertes it into a protobuf `Any`.
 *
 * This is the reverse operation to `decodePubkey`.
 */
export function encodePubkeyInitia(pubkey: Pubkey): Any {
  if (isEthSecp256k1Pubkey(pubkey)) {
    const pubkeyProto = CosmosCryptoSecp256k1Pubkey.fromPartial({
      key: fromBase64(pubkey.value),
    })
    return Any.fromPartial({
      typeUrl: "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
      value: Uint8Array.from(CosmosCryptoSecp256k1Pubkey.encode(pubkeyProto).finish()),
    })
  }

  return encodePubkey(pubkey)
}
