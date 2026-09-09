import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { LocalStorageKey } from "./constants"

/* Every EIP-191 signature reveals the signer's public key, so any signature the wallet
 * produces (a transaction, the auto-sign derivation message) can populate this cache.
 * Wallets that don't expose the key up front, such as social-login wallets whose account
 * has never been seen on chain, would otherwise need a dedicated identification signature.
 *
 * The key is persisted in localStorage so reloads don't ask again. The host page can read
 * it since localStorage is scoped to the embedding origin; the key itself is not secret. */

export function recoverPublicKey(message: string, signature: string): Uint8Array {
  const messageHash = ethers.hashMessage(message)
  const uncompressedPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature)
  return Secp256k1.compressPubkey(fromHex(uncompressedPublicKey.replace("0x", "")))
}

function getStorageKey(address: string): string {
  return `${LocalStorageKey.PUBLIC_KEY}:${address}`
}

export function loadPublicKey(address: string): Uint8Array | null {
  const publicKeyHex = localStorage.getItem(getStorageKey(address))
  return publicKeyHex ? fromHex(publicKeyHex) : null
}

export function storePublicKey(address: string, publicKey: Uint8Array): void {
  try {
    localStorage.setItem(getStorageKey(address), toHex(publicKey))
  } catch {
    // The host origin's storage quota can be exhausted by the embedding page. The write
    // runs right after a wallet signature, so failing here would discard that signature
    // over a cache that only saves an identification request on a later reload.
  }
}
