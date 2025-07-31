import { useState, type ReactNode } from "react"
import Modal from "./Modal"

interface Props {
  title?: string
  content: (close: () => void) => ReactNode
  children: ReactNode
  className?: string
}

const ModalTrigger = ({ title, content, children: trigger, className }: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const close = () => setIsOpen(false)

  return (
    <Modal
      title={title}
      trigger={trigger}
      className={className}
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      {content(close)}
    </Modal>
  )
}

export default ModalTrigger
