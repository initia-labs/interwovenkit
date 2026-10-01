import { atom, useStore } from "jotai"
import { useDrawer, useModal as useWidgetModal } from "@/data/ui"
import { useModal } from "@/public/app/ModalContext"
import { useInitiaAddress } from "@/public/data/hooks"
import { AutoSignCancelledError } from "./lifecycle"
import type { DerivedWalletPublic } from "./store"
import { activeWalletOwnerAtom, walletGenerationAtom } from "./store"
import { getExpectedAddress, useDeriveWallet } from "./wallet"

interface PendingAutoSignUnlock {
  owner: string
  chainId: string
  surface: "drawer" | "nested"
  resolve: (wallet: DerivedWalletPublic) => void
  reject: (error: Error) => void
}

export const pendingAutoSignUnlockAtom = atom<PendingAutoSignUnlock | null>(null)

/** Recovery requires explicit confirmation before a root-wallet signature. */
export function useRequestAutoSignUnlock() {
  const owner = useInitiaAddress()
  const store = useStore()
  const { clearWallet, getActiveIdentity } = useDeriveWallet()
  const { openModal, closeModal } = useModal()
  const { isDrawerOpen, openDrawer, closeDrawer } = useDrawer()
  const { isModalOpen } = useWidgetModal()

  return async (chainId: string): Promise<DerivedWalletPublic | undefined> => {
    if (!owner || store.get(pendingAutoSignUnlockAtom)) {
      throw new AutoSignCancelledError("An auto-signing unlock is already pending or disconnected")
    }
    const generation = store.get(walletGenerationAtom)
    const identity = await getActiveIdentity(chainId)
    if (
      store.get(activeWalletOwnerAtom) !== owner ||
      store.get(walletGenerationAtom) !== generation ||
      store.get(pendingAutoSignUnlockAtom)
    )
      throw new AutoSignCancelledError()
    // A missing random key cannot be unlocked with a root-wallet signature.
    // Continue the already-approved transaction through normal wallet signing.
    if (identity?.provenance === "random" || (!identity && !getExpectedAddress(owner, chainId)))
      return undefined
    const nested = isDrawerOpen || isModalOpen
    let request: PendingAutoSignUnlock
    const result = new Promise<DerivedWalletPublic>((resolve, reject) => {
      let settled = false
      request = {
        owner,
        chainId,
        surface: nested ? "nested" : "drawer",
        resolve: (wallet) => {
          if (settled) return
          settled = true
          resolve(wallet)
        },
        reject: (error) => {
          if (settled) return
          settled = true
          clearWallet(chainId)
          reject(error)
        },
      }
      store.set(pendingAutoSignUnlockAtom, request)
    })
    if (nested) openModal({ path: "/autosign/unlock" })
    else openDrawer("/autosign/unlock", { chainId })
    try {
      return await result
    } finally {
      if (store.get(pendingAutoSignUnlockAtom) === request!) {
        store.set(pendingAutoSignUnlockAtom, null)
        if (nested) closeModal()
        else closeDrawer()
      }
    }
  }
}
