import { atom } from "jotai"

interface PendingAutoSignRequest {
  chainId: string
  resolve: () => void
  reject: (error: Error) => void
}

export const pendingAutoSignRequestAtom = atom<PendingAutoSignRequest | null>(null)

export interface DerivedWallet {
  privateKey: Uint8Array
  publicKey: Uint8Array
  address: string
}

export interface DerivedWalletPublic {
  publicKey: Uint8Array
  address: string
}

/* Memory-only storage for non-sensitive wallet metadata.
 * Private keys are intentionally excluded from atom state to reduce exposure. */
export const derivedWalletsAtom = atom<Record<string, DerivedWalletPublic>>({})
