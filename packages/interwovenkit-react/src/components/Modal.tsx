import clsx from "clsx"
import type { ReactNode } from "react"
import { useContext } from "react"
import { Dialog } from "radix-ui"
import { IconClose } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import { fullscreenContext } from "@/public/app/fullscreen"
import styles from "./Modal.module.css"

interface Props {
  title?: string
  children: ReactNode
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onInteractOutside?: () => void
}

const Modal = ({ title, children, trigger, open, onOpenChange, onInteractOutside }: Props) => {
  const fullscreen = useContext(fullscreenContext)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}

      <Dialog.Portal container={usePortal()}>
        {/* Overlay is not used because it breaks scrolling behavior in production */}
        <div className={clsx(styles.overlay, { [styles.fullscreen]: fullscreen })} />

        <Dialog.Content
          className={clsx(styles.content, { [styles.fullscreen]: fullscreen })}
          onInteractOutside={onInteractOutside}
        >
          {title && (
            <header className={styles.header}>
              <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              <Dialog.Close className={styles.close}>
                <IconClose size={20} />
              </Dialog.Close>
            </header>
          )}

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Modal
