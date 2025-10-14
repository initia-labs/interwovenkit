import clsx from "clsx"
import styles from "./Indicator.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  offset?: number
  disabled?: boolean
  className?: string
}

const Indicator = (props: PropsWithChildren<Props>) => {
  const { offset = -4, disabled, children, className } = props
  return (
    <div className={clsx(styles.container, className)}>
      {children}
      {!disabled && <div className={styles.badge} style={{ right: offset, top: offset }} />}
    </div>
  )
}

export default Indicator
