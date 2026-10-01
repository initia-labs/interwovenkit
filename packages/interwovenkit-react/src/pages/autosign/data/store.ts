import { atom } from "jotai"

export interface PendingAutoSignRequest {
  owner: string
  chainId: string
  defaultDuration: number
  stayConnected?: boolean
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
export const derivationSequenceAtom = atom(0)
export const walletGenerationAtom = atom(0)
export const activeWalletOwnerAtom = atom("")
export interface WalletRevision {
  owner: string
  generation: number
  storageRevision: number
  keyId: string
}
export const walletRevisionsAtom = atom<Record<string, WalletRevision>>({})
export const walletProvenanceAtom = atom<Record<string, "legacy-derived" | "random">>({})
