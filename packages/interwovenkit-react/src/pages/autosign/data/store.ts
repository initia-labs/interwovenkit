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

/* Memory-only storage for derived wallet metadata used by autosign flows. */
export const derivedWalletsAtom = atom<Record<string, DerivedWalletPublic>>({})

export interface PendingDerivationState {
  promise: Promise<DerivedWalletPublic>
  token: string
}

/* Memory-only key material and derivation control state. */
export const derivedWalletPrivateKeysAtom = atom<Record<string, Uint8Array>>({})
export const pendingDerivationsAtom = atom<Record<string, PendingDerivationState>>({})
export const cancelledDerivationTokensAtom = atom<Record<string, true>>({})
export const derivationSequenceAtom = atom(0)
