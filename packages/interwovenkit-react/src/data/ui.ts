import { useDisconnect as useDisconnectWagmi } from "wagmi"
import { atom, useAtom } from "jotai"
import { useNavigate, useReset } from "@/lib/router"
import { useAnalyticsTrack } from "@/data/analytics"
import { LocalStorageKey } from "./constants"

const isDrawerOpenAtom = atom<boolean>(false)

export function useDrawer() {
  const reset = useReset()
  const [isOpen, setIsOpen] = useAtom(isDrawerOpenAtom)
  const track = useAnalyticsTrack()

  const open = (path: string, state?: object) => {
    if (path) {
      reset(path, state)
    }
    setIsOpen(true)
    track("Widget Opened")
  }

  const close = () => {
    setIsOpen(false)
    track("Widget Closed")
  }

  return { isDrawerOpen: isOpen, openDrawer: open, closeDrawer: close }
}

export function useDisconnect() {
  const navigate = useNavigate()
  const { closeDrawer } = useDrawer()
  const { disconnect } = useDisconnectWagmi()

  return () => {
    navigate("/blank")
    closeDrawer()
    disconnect()

    // Clear bridge form values on disconnect
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)
  }
}
