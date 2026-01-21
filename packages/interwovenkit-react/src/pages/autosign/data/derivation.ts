import { Bip39, Secp256k1, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto"
import { toBech32 } from "@cosmjs/encoding"
import { ripemd160 } from "@noble/hashes/ripemd160"
import { sha256 } from "@noble/hashes/sha256"
import { type Hex, keccak256 } from "viem"
import type { DerivedWallet } from "./store"

export function getAutoSignTypedData(origin: string, chainId: string) {
  return {
    domain: { name: "Interwoven Wallet", version: "1" },
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

export async function deriveWalletFromSignature(signature: Hex): Promise<DerivedWallet> {
  const entropyHex = keccak256(signature)
  const entropy = hexToBytes(entropyHex)

  const mnemonic = Bip39.encode(entropy)
  const seed = await Bip39.mnemonicToSeed(mnemonic)

  const hdPath = stringToPath("m/44'/118'/0'/0/0")
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath)

  const keypair = await Secp256k1.makeKeypair(privkey)
  const publicKey = Secp256k1.compressPubkey(keypair.pubkey)

  const sha256Hash = sha256(publicKey)
  const ripemd160Hash = ripemd160(sha256Hash)
  const address = toBech32("init", ripemd160Hash)

  return {
    privateKey: privkey,
    publicKey: publicKey,
    address: address,
  }
}

export function getDerivedWalletKey(origin: string, chainId: string): string {
  return `${origin}:${chainId}`
}

function hexToBytes(hex: Hex): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
