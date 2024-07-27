import clsx from "clsx"
import type { PropsWithChildren } from "react"
import AnimatedHeight from "../AnimatedHeight"
import InputHelp from "./InputHelp"
import styles from "./FormHelp.module.css"

interface Props {
  level: "info" | "warning" | "error" | "success"
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

const FormHelp = (props: PropsWithChildren<Props>) => {
  return <InputHelp {...props} className={clsx(styles.help, styles[props.level])} mt={0} />
}

FormHelp.Stack = FormHelpStack

export default FormHelp
