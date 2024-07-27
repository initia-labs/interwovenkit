import type { ReactNode } from "react"
import { createContext, useContext } from "react"

export interface ModalOptions {
  title?: string
  content?: ReactNode
  path?: string
}

interface ModalContextProps {
  openModal: (options: ModalOptions) => void
  closeModal: () => void
}

export const ModalContext = createContext<ModalContextProps>(null!)

export const useModal = () => {
  return useContext(ModalContext)
}
