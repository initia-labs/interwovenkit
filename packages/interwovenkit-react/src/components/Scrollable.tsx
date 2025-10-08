import clsx from "clsx"
import styles from "./Scrollable.module.css"

import type { PropsWithChildren, RefObject } from "react"

interface Props {
  className?: string
  ref?: RefObject<HTMLDivElement | null>
}

const Scrollable = ({ className, children, ref }: PropsWithChildren<Props>) => {
  return (
    <div ref={ref} className={clsx(styles.scrollable, className)}>
      {children}
    </div>
  )
}

export default Scrollable
