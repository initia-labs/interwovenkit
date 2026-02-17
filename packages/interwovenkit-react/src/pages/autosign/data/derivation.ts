import { Bip39, Secp256k1, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto"
import { toBech32 } from "@cosmjs/encoding"
import { bytesToHex, type Hex, hexToBytes, keccak256 } from "viem"
import type { DerivedWallet } from "./store"

/* EIP-191 message for wallet derivation signature. Origin scopes derived wallets
 * so the same user signing on different apps will derive different wallets.
 * Uses personal_sign (EIP-191) instead of signTypedData (EIP-712) for better
 * hardware wallet compatibility, particularly with Ledger devices. */
export function getAutoSignMessage(origin: string): string {
  return `Enable Auto-Sign for InterwovenKit

Origin: ${origin}

Sign this message to create a dedicated signing wallet for auto-sign transactions. This wallet will only be used to sign transactions on your behalf when auto-sign is enabled.`
}

/**
 * Derive an HD wallet from an Ethereum signature.
 * Based on dYdX's implementation:
 * https://github.com/dydxprotocol/v4-clients/blob/main/v4-client-js/src/lib/onboarding.ts#L42-L60
 */
export async function deriveWalletFromSignature(
  signature: Hex,
  bech32Prefix: string,
): Promise<DerivedWallet> {
  const signatureBytes = hexToBytes(signature)

  if (signatureBytes.length !== 65) {
    throw new Error(
      `Invalid signature length: expected 65 bytes (r: 32, s: 32, v: 1), got ${signatureBytes.length}`,
    )
  }

  // Strip the `v` byte (recovery id) and hash only r,s values (first 64 bytes).
  // The `v` value can vary between wallets (27/28 for legacy, EIP-155 chain-specific,
  // or 0/1 for modern), but r,s are consistent for the same signature.
  // See dYdX: https://github.com/dydxprotocol/v4-clients/blob/main/v4-client-js/src/lib/onboarding.ts#L56
  const rsValues = signatureBytes.slice(0, 64)
  const entropy = hexToBytes(keccak256(bytesToHex(rsValues)))

  const mnemonic = Bip39.encode(entropy)
  const seed = await Bip39.mnemonicToSeed(mnemonic)

  const hdPath = stringToPath("m/44'/60'/0'/0/0")
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath)

  const keypair = await Secp256k1.makeKeypair(privkey)
  const publicKey = Secp256k1.compressPubkey(keypair.pubkey)

  const uncompressedPubkey = keypair.pubkey
  const pubkeyWithoutPrefix = uncompressedPubkey.slice(1)
  const pubkeyHex = bytesToHex(pubkeyWithoutPrefix)
  const addressHash = keccak256(pubkeyHex)
  const addressBytes = hexToBytes(addressHash).slice(-20)
  const address = toBech32(bech32Prefix, addressBytes)

  return {
    privateKey: privkey,
    publicKey: publicKey,
    address: address,
  }
}

export function getDerivedWalletKey(userAddress: string, bech32Prefix: string): string {
  return `${userAddress}:${bech32Prefix}`
}
