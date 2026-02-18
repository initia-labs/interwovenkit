import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { LocalStorageKey } from "./constants"

export interface PublicKeyStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function getPublicKeyStorageKey(address: string): string {
  return `${LocalStorageKey.PUBLIC_KEY}:${address}`
}

export function getBrowserPublicKeyStorage(): PublicKeyStorage | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readPublicKeyFromStorage(
  storage: PublicKeyStorage,
  address: string,
): Uint8Array | null {
  try {
    const value = storage.getItem(getPublicKeyStorageKey(address))
    if (!value) {
      return null
    }

    return fromHex(value)
  } catch {
    return null
  }
}

export function writePublicKeyToStorage(
  storage: PublicKeyStorage,
  address: string,
  publicKey: Uint8Array,
) {
  try {
    storage.setItem(getPublicKeyStorageKey(address), toHex(publicKey))
  } catch {
    // Ignore storage write failures (e.g. sandboxed iframes).
  }
}

export function recoverCompressedPublicKeyFromMessageSignature(
  message: string,
  signature: string,
): Uint8Array {
  const messageHash = ethers.hashMessage(message)
  const uncompressedPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature)
  return Secp256k1.compressPubkey(fromHex(uncompressedPublicKey.replace("0x", "")))
}

export function cacheRecoveredPublicKeyFromMessageSignature({
  address,
  message,
  signature,
  storage,
}: {
  address: string
  message: string
  signature: string
  storage: PublicKeyStorage
}): boolean {
  try {
    const publicKey = recoverCompressedPublicKeyFromMessageSignature(message, signature)
    writePublicKeyToStorage(storage, address, publicKey)
    return true
  } catch {
    return false
  }
}
