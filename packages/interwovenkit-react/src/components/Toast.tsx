import type { HTMLAttributes } from "react"
import clsx from "clsx"
import { useTransition, animated, config } from "@react-spring/web"
import { IconCheckCircleFilled, IconClose, IconCloseCircleFilled } from "@initia/icons-react"
import type { InternalNotification } from "@/public/app/NotificationProvider"
import type { NotificationType } from "@/public/app/NotificationContext"
import Loader from "./Loader"
import styles from "./Toast.module.css"

interface Props extends HTMLAttributes<HTMLDivElement> {
  notification: InternalNotification | null
  onClose: () => void
}

const Toast = ({ notification, onClose, ...props }: Props) => {
  const transition = useTransition(notification, {
    keys: (notification) => notification?.id || "empty",
    from: { transform: "translateY(-52px)", opacity: 0 },
    enter: { transform: "translateY(0px)", opacity: 1 },
    leave: { transform: "translateY(-52px)", opacity: 0 },
    config: { ...config.wobbly, clamp: true },
  })

  const getIcon = (type?: NotificationType) => {
    switch (type) {
      case "loading":
        return <Loader size={16} />
      case "info":
      case "success":
        return <IconCheckCircleFilled size={16} />
      case "error":
        return <IconCloseCircleFilled size={16} />
      default:
        return null
    }
  }

  return transition((style, notification) => {
    if (!notification) return null
    const { type, title, description } = notification
    const icon = getIcon(type)
    return (
      <animated.div style={style} className={styles.container}>
        <div className={clsx(styles.toast, type && styles[type])} {...props}>
          {icon && <div className={styles.icon}>{icon}</div>}

          <div className={styles.content}>
            <p className={styles.title}>{title}</p>
            {description && <div className={styles.description}>{description}</div>}
          </div>

          <button className={styles.close} onClick={onClose}>
            <IconClose size={14} />
          </button>
        </div>
      </animated.div>
    )
  })
}

export default Toast
