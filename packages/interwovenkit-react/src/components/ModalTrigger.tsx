import { useState, type ReactNode } from "react"
import Modal from "./Modal"

interface Props {
  title?: string
  content: (close: () => void) => ReactNode
  children: ReactNode
  className?: string
  amplitudeOpenEventName?: string
}

const ModalTrigger = ({
  title,
  content,
  children: trigger,
  className,
  amplitudeOpenEventName,
}: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const close = () => setIsOpen(false)

  return (
    <Modal
      title={title}
      trigger={
        <button className={className} data-amp-track-name={amplitudeOpenEventName}>
          {trigger}
        </button>
      }
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      {content(close)}
    </Modal>
  )
}

export default ModalTrigger
