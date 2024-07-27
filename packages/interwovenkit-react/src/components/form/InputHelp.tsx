import clsx from "clsx"
import type { PropsWithChildren } from "react"
import { IconCheckCircleFilled, IconInfoFilled, IconWarningFilled } from "@initia/icons-react"
import Loader from "../Loader"
import styles from "./InputHelp.module.css"

interface Props {
  level?: "info" | "warning" | "error" | "success" | "loading"
  className?: string
  mt?: number
}

const InputHelp = ({ level, className, mt = 8, children }: PropsWithChildren<Props>) => {
  if (!children) return null

  const getIcon = () => {
    switch (level) {
      case "loading":
        return <Loader size={12} />
      case "info":
        return <IconInfoFilled size={12} />
      case "warning":
      case "error":
        return <IconWarningFilled size={12} />
      default:
        return <IconCheckCircleFilled size={12} />
    }
  }

  return (
    <div className={clsx(styles.help, level && styles[level], className)} style={{ marginTop: mt }}>
      <div className={styles.icon}>{getIcon()}</div>
      <p>{children}</p>
    </div>
  )
}

export default InputHelp
