import clsx from "clsx"
import Status from "@/components/Status"
import styles from "./DepositStatus.module.css"

import type { ComponentProps } from "react"

/**
 * Deposit screens render status copy at full contrast in a smaller size,
 * unlike the muted default the shared `Status` carries everywhere else — so
 * the look is scoped here instead of restyling the shared class. The contrast
 * color applies only to non-error statuses, leaving the shared error color in
 * charge.
 */
const DepositStatus = ({ error, ...props }: ComponentProps<typeof Status>) => {
  return (
    <Status
      {...props}
      error={error}
      className={clsx(styles.status, { [styles.contrast]: !error })}
    />
  )
}

export default DepositStatus
