import { useDisconnect as useDisconnectWagmi } from "wagmi"
import { atom, useAtom } from "jotai"
import type { ComponentType } from "react"
import { useNavigate, useReset } from "@/lib/router"
import { useAnalyticsTrack } from "@/data/analytics"
import { LocalStorageKey } from "./constants"
import { useConfig } from "./config"

interface DrawerState {
  isOpen: boolean
  customComponent?: ComponentType
}

const drawerAtom = atom<DrawerState>({ isOpen: false })

export function useDrawer() {
  const reset = useReset()
  const [drawerState, setDrawerState] = useAtom(drawerAtom)
  const track = useAnalyticsTrack()

  const open = (path: string, state?: object, customComponent?: ComponentType) => {
    if (path) {
      reset(path, state)
    }
    setDrawerState({ isOpen: true, customComponent })
    track("Widget Opened")
  }

  const close = () => {
    setDrawerState({ isOpen: false, customComponent: undefined })
    track("Widget Closed")
  }

  return {
    isDrawerOpen: drawerState.isOpen,
    openDrawer: open,
    closeDrawer: close,
    customComponent: drawerState.customComponent,
  }
}

export function useDisconnect() {
  const navigate = useNavigate()
  const { closeDrawer } = useDrawer()
  const { disconnect } = useDisconnectWagmi()
  const { disconnectAction } = useConfig()

  return () => {
    navigate("/blank")
    closeDrawer()
    disconnect()
    disconnectAction?.()

    // Clear bridge form values on disconnect
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
    localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
    localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
    localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)
  }
}
