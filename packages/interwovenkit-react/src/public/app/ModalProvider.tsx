import { type PropsWithChildren, useCallback, useEffect, useState } from "react"
import { useAtomValue } from "jotai"
import AsyncBoundary from "@/components/AsyncBoundary"
import Modal from "@/components/Modal"
import { txRequestHandlerAtom } from "@/data/tx"
import { useDrawer, useModal as useWidgetModal } from "@/data/ui"
import { usePath } from "@/lib/router"
import { AutoSignCancelledError } from "@/pages/autosign/data/lifecycle"
import { pendingAutoSignUnlockAtom } from "@/pages/autosign/data/unlock-request"
import UnlockAutoSign from "@/pages/autosign/UnlockAutoSign"
import TxRequest from "@/pages/tx/TxRequest"
import { useInitiaAddress } from "@/public/data/hooks"
import type { ModalOptions } from "./ModalContext"
import { ModalContext } from "./ModalContext"

const ModalProvider = ({ children }: PropsWithChildren) => {
  const [{ title, content, path }, setOptions] = useState<ModalOptions>({})
  const [isOpen, setIsOpen] = useState(false)
  const txRequest = useAtomValue(txRequestHandlerAtom)
  const unlockRequest = useAtomValue(pendingAutoSignUnlockAtom)
  const owner = useInitiaAddress()
  const widgetPath = usePath()
  const { isDrawerOpen } = useDrawer()
  const { isModalOpen } = useWidgetModal()

  useEffect(() => {
    if (!unlockRequest) return
    if (unlockRequest.owner !== owner) {
      unlockRequest.reject(new AutoSignCancelledError("Wallet account changed"))
    } else if (
      (!isDrawerOpen && !isModalOpen) ||
      (unlockRequest.surface === "drawer" && widgetPath !== "/autosign/unlock")
    ) {
      unlockRequest.reject(new AutoSignCancelledError("Auto-signing unlock was closed"))
    }
  }, [owner, unlockRequest, isDrawerOpen, isModalOpen, widgetPath])

  const openModal = useCallback((options: ModalOptions) => {
    setOptions(options)
    setIsOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setOptions({})
    setIsOpen(false)
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (path === "/autosign/unlock") {
          unlockRequest?.reject(new AutoSignCancelledError("User rejected auto-signing unlock"))
        } else {
          txRequest?.reject(new Error("User rejected"))
        }
        setOptions({})
      }
      setIsOpen(open)
    },
    [txRequest, unlockRequest, path],
  )

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}

      <Modal
        title={title}
        open={isOpen}
        // FIXME: React StrictMode causes a problem by unmounting the component once on purpose.
        // Should reject on unmount, but didn't work as expected.
        // Currently handled via drawer/modal close instead.
        // Would be nice to fix this properly later.
        onOpenChange={handleOpenChange}
      >
        <AsyncBoundary>
          {path === "/tx" ? (
            <TxRequest />
          ) : path === "/autosign/unlock" ? (
            <UnlockAutoSign />
          ) : (
            content
          )}
        </AsyncBoundary>
      </Modal>
    </ModalContext.Provider>
  )
}

export default ModalProvider
