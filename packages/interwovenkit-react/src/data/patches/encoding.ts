import type { SinglePubkey } from "@cosmjs/amino"
import { toBase64 } from "@cosmjs/encoding"
import { pubkeyTypeInitia } from "./pubkeys"

export interface EthSecp256k1Pubkey extends SinglePubkey {
  readonly type: "initia/PubKeyEthSecp256k1"
  readonly value: string
}

/**
 * Takes a Secp256k1 public key as raw bytes and returns the Amino JSON
 * representation of it (the type/value wrapper object).
 */
export function encodeEthSecp256k1Pubkey(pubkey: Uint8Array): EthSecp256k1Pubkey {
  if (pubkey.length !== 33 || (pubkey[0] !== 0x02 && pubkey[0] !== 0x03)) {
    throw new Error(
      "Public key must be compressed secp256k1, i.e. 33 bytes starting with 0x02 or 0x03",
    )
  }
  return {
    type: pubkeyTypeInitia.ethsecp256k1,
    value: toBase64(pubkey),
  }
}
