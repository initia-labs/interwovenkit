import clsx from "clsx"
import { useContext } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { IconClose } from "@initia/icons-react"
import { fullscreenContext } from "@/public/app/fullscreen"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./Modal.module.css"

import type { ReactNode } from "react"

interface Props {
  title?: string
  children: ReactNode
  trigger?: ReactNode
  className?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const Modal = ({ title, children, trigger, className, open, onOpenChange }: Props) => {
  const portal = usePortal()
  const fullscreen = useContext(fullscreenContext)

  if (!portal) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={false} // Don't block parent app scroll as this is a widget
    >
      {trigger && <Dialog.Trigger className={className}>{trigger}</Dialog.Trigger>}

      <Dialog.Portal container={portal}>
        <Dialog.Backdrop
          className={clsx(styles.overlay, { [styles.fullscreen]: fullscreen })}
          onClick={() => onOpenChange(false)} // Workaround: backdrop click doesn't work after build
          forceRender // Required for nested backdrop rendering
        />

        <Dialog.Popup className={clsx(styles.content, { [styles.fullscreen]: fullscreen })}>
          {title && (
            <header className={styles.header}>
              <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              <Dialog.Close className={styles.close}>
                <IconClose size={20} />
              </Dialog.Close>
            </header>
          )}

          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Modal
