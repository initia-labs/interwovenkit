import { createPortal } from "react-dom"
import { IconBack } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./DepositBackButton.module.css"

interface Props {
  onClick: () => void
}

/**
 * Back arrow shared by deposit flow pages, pinned to the top-left of the
 * widget surface, level with the surface-owned top-right close (X) button.
 *
 * The flow renders inside the modal's scroll region (Modal `.content`), so a
 * button anchored to the page surface scrolls out of view on short (mobile)
 * viewports while the close button stays pinned — leaving no way to go back.
 * Portaling to the modal chrome (the dialog popup registered in PortalContext)
 * keeps it pinned like the close button. Before the container registers (first
 * render), the button falls back to the page surface anchor, which sits at the
 * same spot while unscrolled.
 */
const DepositBackButton = ({ onClick }: Props) => {
  const container = usePortal()

  const button = (
    <button type="button" className={styles.back} onClick={onClick} aria-label="Go back">
      <IconBack size={20} aria-hidden="true" />
    </button>
  )

  return container ? createPortal(button, container) : button
}

export default DepositBackButton
