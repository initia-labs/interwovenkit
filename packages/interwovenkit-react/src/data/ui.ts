import { atom, useAtom } from "jotai"
import { useReset } from "@/lib/router"
import Amplitude from "@/lib/amplitude"

const isDrawerOpenAtom = atom<boolean>(false)

export function useDrawer() {
  const reset = useReset()
  const [isOpen, setIsOpen] = useAtom(isDrawerOpenAtom)

  const open = (path: string, state?: object) => {
    Amplitude.logEvent("drawer_open", { path, state })
    if (path) {
      reset(path, state)
    }
    setIsOpen(true)
  }

  const close = () => {
    Amplitude.logEvent("drawer_close")
    setIsOpen(false)
  }

  return { isDrawerOpen: isOpen, openDrawer: open, closeDrawer: close }
}
