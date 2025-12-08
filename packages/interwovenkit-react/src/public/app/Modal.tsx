import clsx from "clsx"
import { type PropsWithChildren } from "react"
import { Dialog } from "@base-ui-components/react/dialog"
import { IconClose } from "@initia/icons-react"
import { useModal } from "@/data/ui"
import { usePortalContainer } from "../portal"
import styles from "./Modal.module.css"

const Modal = ({ children }: PropsWithChildren) => {
  const { isModalOpen, closeModal } = useModal()
  const portalContainer = usePortalContainer()

  return (
    <Dialog.Root open={isModalOpen} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Backdrop className={styles.backdrop} onClick={closeModal} />
        <Dialog.Popup className={clsx(styles.modal)}>
          <button className={styles.closeButton} onClick={closeModal} aria-label="Close">
            <IconClose size={14} />
          </button>
          <div className={styles.content}>{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Modal
