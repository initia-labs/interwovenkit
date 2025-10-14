import clsx from "clsx"
import styles from "./Status.module.css"

import type { PropsWithChildren } from "react"

const Status = ({ error, children }: PropsWithChildren<{ error?: boolean }>) => {
  return <p className={clsx(styles.status, { [styles.error]: error })}>{children}</p>
}

export default Status
