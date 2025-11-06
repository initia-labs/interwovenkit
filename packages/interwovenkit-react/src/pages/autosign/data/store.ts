import { atom } from "jotai"

interface PendingAutoSignRequest {
  chainId: string
  resolve: () => void
  reject: (error: Error) => void
}

export const pendingAutoSignRequestAtom = atom<PendingAutoSignRequest | null>(null)
