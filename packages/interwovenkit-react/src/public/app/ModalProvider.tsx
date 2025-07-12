import { useCallback, useState, type PropsWithChildren } from "react"
import { useAtomValue } from "jotai"
import Modal from "@/components/Modal"
import TxRequest from "@/pages/tx/TxRequest"
import { txRequestHandlerAtom } from "@/data/tx"
import type { ModalOptions } from "./ModalContext"
import { ModalContext } from "./ModalContext"

const ModalProvider = ({ children }: PropsWithChildren) => {
  const [{ title, content, path }, setOptions] = useState<ModalOptions>({})
  const [isOpen, setIsOpen] = useState(false)
  const txRequest = useAtomValue(txRequestHandlerAtom)

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
        txRequest?.reject(new Error("User rejected"))
        setOptions({})
      }
      setIsOpen(open)
    },
    [txRequest],
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
        {path === "/tx" ? <TxRequest /> : content}
      </Modal>
    </ModalContext.Provider>
  )
}

export default ModalProvider
