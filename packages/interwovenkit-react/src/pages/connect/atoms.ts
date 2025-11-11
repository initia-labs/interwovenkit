import { atom } from "jotai"

// Atom to track the pending connector ID during connection process
export const pendingConnectorIdAtom = atom<string | null>(null)
