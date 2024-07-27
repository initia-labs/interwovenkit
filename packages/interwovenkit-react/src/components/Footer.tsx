import clsx from "clsx"
import type { PropsWithChildren, ReactNode } from "react"
import styles from "./Footer.module.css"

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
