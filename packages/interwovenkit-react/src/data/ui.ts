import { useDisconnect as useDisconnectWagmi } from "wagmi"
import { atom, useAtom, useSetAtom } from "jotai"
import { useAnalyticsTrack } from "@/data/analytics"
import { useNavigate, useReset } from "@/lib/router"
import { useDeriveWallet } from "@/pages/autosign/data/wallet"
import { LocalStorageKey } from "./constants"

const isDrawerOpenAtom = atom<boolean>(false)
const isModalOpenAtom = atom<boolean>(false)

export function useDrawer() {
  const reset = useReset()
  const [isOpen, setIsOpen] = useAtom(isDrawerOpenAtom)
  const setIsModalOpen = useSetAtom(isModalOpenAtom)
  const track = useAnalyticsTrack()

  const open = (path: string, state?: object) => {
    if (path) {
      reset(path, state)
    }
    // close modal before opening drawer
    setIsModalOpen(false)

    setIsOpen(true)
    track("Widget Opened")
  }

  const close = () => {
    setIsOpen(false)
    track("Widget Closed")
  }

  return { isDrawerOpen: isOpen, openDrawer: open, closeDrawer: close }
}

export function useModal() {
  const reset = useReset()
  const [isOpen, setIsOpen] = useAtom(isModalOpenAtom)
  const setIsDrawerOpen = useSetAtom(isDrawerOpenAtom)
  const track = useAnalyticsTrack()

  const open = (path: string, state?: object) => {
    if (path) {
      reset(path, state)
    }
    // close drawer before opening modal
    setIsDrawerOpen(false)

    setIsOpen(true)
    track("Widget Opened")
  }

  const close = () => {
    setIsOpen(false)
    track("Widget Closed")
  }

  return { isModalOpen: isOpen, openModal: open, closeModal: close }
}

export function useDisconnect() {
  const navigate = useNavigate()
  const { closeDrawer } = useDrawer()
  const { closeModal } = useModal()
  const { disconnect } = useDisconnectWagmi()
  const { clearAllWallets } = useDeriveWallet()

  return () => {
    navigate("/blank")
    closeDrawer()
    closeModal()
    disconnect()

    clearAllWallets()

    // Clear bridge form values on disconnect
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)
  }
}
