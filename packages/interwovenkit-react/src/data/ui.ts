import { useDisconnect as useDisconnectWagmi } from "wagmi"
import { atom, useAtom, useSetAtom } from "jotai"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useAnalyticsTrack } from "@/data/analytics"
import { useNavigate, useReset } from "@/lib/router"
import { useDeriveWallet } from "@/pages/autosign/data/wallet"
import { useInitiaAddress } from "@/public/data/hooks"
import { useClearSSECache } from "./minity/sse"
import { LocalStorageKey } from "./constants"
import { clearErrorCache } from "./errors"
import { clearClientCaches } from "./signer"

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

export function clearDisconnectState({
  queryClient,
  clearSSECache,
  address,
}: {
  queryClient: Pick<QueryClient, "clear">
  clearSSECache: () => void
  address?: string
}) {
  clearClientCaches()
  clearErrorCache()
  queryClient.clear()
  clearSSECache()

  localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
  localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
  localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
  localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
  localStorage.removeItem(LocalStorageKey.BRIDGE_QUANTITY)
  localStorage.removeItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)

  if (address) {
    localStorage.removeItem(`${LocalStorageKey.PUBLIC_KEY}:${address}`)
  }
}

export function useDisconnect() {
  const navigate = useNavigate()
  const { closeDrawer } = useDrawer()
  const { closeModal } = useModal()
  const { disconnect } = useDisconnectWagmi()
  const queryClient = useQueryClient()
  const { clearAllWallets } = useDeriveWallet()
  const address = useInitiaAddress()
  const clearSSECache = useClearSSECache()

  return () => {
    navigate("/blank")
    closeDrawer()
    closeModal()

    // Clear all in-memory caches before wallet disconnect
    clearDisconnectState({ queryClient, clearSSECache, address })

    disconnect()

    clearAllWallets()
  }
}
