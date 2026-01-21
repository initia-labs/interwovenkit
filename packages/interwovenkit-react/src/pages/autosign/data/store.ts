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

/* Memory-only storage: private keys exist only in browser memory and are cleared on page refresh.
 * The wallet can always be re-derived from the same signature, so persistence is unnecessary
 * and would increase attack surface. */
export const derivedWalletsAtom = atom<Record<string, DerivedWallet>>({})
