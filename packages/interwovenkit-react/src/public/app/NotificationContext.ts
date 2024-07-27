import type { ReactNode } from "react"
import { createContext, useContext } from "react"

export interface Notification {
  type?: NotificationType
  title: string
  description?: ReactNode
  autoHide?: boolean
}

export type NotificationType = "loading" | "success" | "error" | "info"

export interface NotificationContextValue {
  showNotification: (notification: Notification) => void
  updateNotification: (notification: Notification) => void
  hideNotification: () => void
}

export const NotificationContext = createContext<NotificationContextValue>(null!)

export const useNotification = () => {
  return useContext(NotificationContext)
}
