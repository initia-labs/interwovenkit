import clsx from "clsx"
import AnimatedHeight from "../AnimatedHeight"
import InputHelp from "./InputHelp"
import styles from "./FormHelp.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  level: "info" | "warning" | "error" | "success"
  mt?: number
}

const FormHelpStack = ({ children }: PropsWithChildren) => {
  if (!children) return null
  if (Array.isArray(children) && children.filter(Boolean).length === 0) return null
  return (
    <AnimatedHeight>
      <div className={styles.stack}>{children}</div>
    </AnimatedHeight>
  )
}

const FormHelp = ({ mt = 0, ...props }: PropsWithChildren<Props>) => {
  return <InputHelp {...props} className={clsx(styles.help, styles[props.level])} mt={mt} />
}

FormHelp.Stack = FormHelpStack

export default FormHelp
