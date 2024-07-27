import type { StdSignature } from "@cosmjs/amino"
import { toBase64 } from "@cosmjs/encoding"
import { encodeEthSecp256k1Pubkey } from "./encoding"

/**
 * Takes a binary pubkey and signature to create a signature object
 *
 * @param pubkey a compressed secp256k1 public key
 * @param signature a 64 byte fixed length representation of secp256k1 signature components r and s
 */
export function encodeEthSecp256k1Signature(
  pubkey: Uint8Array,
  signature: Uint8Array,
): StdSignature {
  if (signature.length !== 64) {
    throw new Error(
      "Signature must be 64 bytes long. Cosmos SDK uses a 2x32 byte fixed length encoding for the secp256k1 signature integers r and s.",
    )
  }

  return {
    pub_key: encodeEthSecp256k1Pubkey(pubkey),
    signature: toBase64(signature),
  }
}
