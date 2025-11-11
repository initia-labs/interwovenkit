import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { LocalStorageKey } from "@/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"

/* Helper function to store pubkey - maybe can be moved somwhere else */
export function useStorePubKey() {
  const initiaAddress = useInitiaAddress()

  return ({ message, signature }: { message: string; signature: string }) => {
    const storageKey = `${LocalStorageKey.PUBLIC_KEY}:${initiaAddress}`

    const messageHash = ethers.hashMessage(message)
    const uncompressedPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature)
    const publicKey = Secp256k1.compressPubkey(fromHex(uncompressedPublicKey.replace("0x", "")))

    localStorage.setItem(storageKey, toHex(publicKey))
  }
}
