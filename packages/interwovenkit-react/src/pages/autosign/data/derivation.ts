import { Bip39, Secp256k1, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto"
import { toBech32 } from "@cosmjs/encoding"
import { type Hex, keccak256 } from "viem"
import type { DerivedWallet } from "./store"

/**
 * Create EIP-712 typed data that requests enabling "Auto-Sign" scoped to an origin and chain.
 *
 * @param origin - The requesting application's origin (e.g., window.location.origin)
 * @param chainId - The target chain identifier to scope the derived wallet
 * @returns An EIP-712 typed data object with domain, types, primaryType "AutoSign", and a message containing `action: "Enable Auto-Sign"`, `origin`, and `chainId`
 */
export function getAutoSignTypedData(origin: string, chainId: string) {
  return {
    domain: { name: "InterwovenKit", version: "1" },
    types: {
      AutoSign: [
        { name: "action", type: "string" },
        { name: "origin", type: "string" },
        { name: "chainId", type: "string" },
      ],
    },
    primaryType: "AutoSign" as const,
    message: {
      action: "Enable Auto-Sign",
      origin: origin,
      chainId: chainId,
    },
  }
}

/**
 * Derives a deterministic HD wallet (private key, compressed public key, and address) from an Ethereum signature.
 *
 * @param signature - An Ethereum signature as a hex string expected to encode 65 bytes (r + s + v)
 * @returns An object containing `privateKey` (derived private key), `publicKey` (compressed public key), and `address` (Bech32 address with the `init` prefix)
 * @throws Error if `signature` does not decode to exactly 65 bytes
 */
export async function deriveWalletFromSignature(signature: Hex): Promise<DerivedWallet> {
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
  const entropy = hexToBytes(keccak256(`0x${bytesToHex(rsValues)}`))

  const mnemonic = Bip39.encode(entropy)
  const seed = await Bip39.mnemonicToSeed(mnemonic)

  const hdPath = stringToPath("m/44'/60'/0'/0/0")
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath)

  const keypair = await Secp256k1.makeKeypair(privkey)
  const publicKey = Secp256k1.compressPubkey(keypair.pubkey)

  const uncompressedPubkey = keypair.pubkey
  const pubkeyWithoutPrefix = uncompressedPubkey.slice(1)
  const pubkeyHex = `0x${bytesToHex(pubkeyWithoutPrefix)}` as Hex
  const addressHash = keccak256(pubkeyHex)
  const addressBytes = hexToBytes(addressHash).slice(-20)
  const address = toBech32("init", addressBytes)

  return {
    privateKey: privkey,
    publicKey: publicKey,
    address: address,
  }
}

/**
 * Create a deterministic storage key for a derived wallet scoped to an origin and chain.
 *
 * @param origin - The requesting origin (e.g., website or dApp identifier)
 * @param chainId - The blockchain chain identifier
 * @returns A string key composed of `origin` and `chainId` separated by a colon (`origin:chainId`)
 */
export function getDerivedWalletKey(origin: string, chainId: string): string {
  return `${origin}:${chainId}`
}

/**
 * Convert a hexadecimal string into a byte array.
 *
 * @param hex - Hexadecimal string to convert; may include a leading `0x` prefix.
 * @returns A `Uint8Array` containing the bytes represented by the hex string.
 * @throws Error if `hex` is empty, has an odd length, or contains non-hexadecimal characters.
 */
function hexToBytes(hex: Hex): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex

  if (cleanHex.length === 0) {
    throw new Error("Invalid hex: empty string")
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex: odd length (${cleanHex.length})`)
  }

  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new Error("Invalid hex: contains non-hexadecimal characters")
  }

  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Converts a byte array to a lowercase hexadecimal string without a `0x` prefix.
 *
 * @param bytes - The input byte array to convert.
 * @returns The hexadecimal representation of `bytes` in lowercase with no `0x` prefix.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}