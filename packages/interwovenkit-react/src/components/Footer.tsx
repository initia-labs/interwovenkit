import clsx from "clsx"
import styles from "./Footer.module.css"

import type { PropsWithChildren, ReactNode } from "react"

interface Props {
  extra?: ReactNode
  className?: string
}

const Footer = ({ extra, className, children }: PropsWithChildren<Props>) => {
  return (
    <footer className={clsx(styles.footer, className)}>
      {extra}
      <div className={styles.actions}>{children}</div>
    </footer>
  )
}

export default Footer
