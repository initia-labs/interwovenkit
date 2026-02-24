import { type PropsWithChildren, useContext } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { IconClose } from "@initia/icons-react"
import AsyncBoundary from "@/components/AsyncBoundary"
import { useModal } from "@/data/ui"
import { usePortalContainer } from "../portal"
import { PortalContext } from "./PortalContext"
import styles from "./Modal.module.css"

const Modal = ({ children }: PropsWithChildren) => {
  const { isModalOpen, closeModal } = useModal()
  const { setContainer } = useContext(PortalContext)
  const portalContainer = usePortalContainer()

  return (
    <Dialog.Root open={isModalOpen} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Backdrop className={styles.backdrop} onClick={closeModal} />
        <Dialog.Popup className={styles.modal} ref={setContainer}>
          <button className={styles.closeButton} onClick={closeModal} aria-label="Close">
            <IconClose size={20} />
          </button>
          <AsyncBoundary>{children}</AsyncBoundary>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Modal
