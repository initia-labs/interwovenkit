import clsx from "clsx"
import type { PropsWithChildren } from "react"
import styles from "./Status.module.css"

const Status = ({ error, children }: PropsWithChildren<{ error?: boolean }>) => {
  return <p className={clsx(styles.status, { [styles.error]: error })}>{children}</p>
}

export default Status
