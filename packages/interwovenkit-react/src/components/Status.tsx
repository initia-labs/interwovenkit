import clsx from "clsx"
import styles from "./Status.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  error?: boolean
  className?: string
}

const Status = ({ error, className, children }: PropsWithChildren<Props>) => {
  return (
    <p
      className={clsx(styles.status, { [styles.error]: error }, className)}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  )
}

export default Status
