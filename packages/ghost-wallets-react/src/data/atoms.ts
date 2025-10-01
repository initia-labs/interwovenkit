import { atom } from "jotai"

/**
 * Atom to store the ghost wallet expiration timestamp
 * undefined means no expiration is set
 */
export const ghostWalletExpirationAtom = atom<Record<string, number | undefined>>({})
