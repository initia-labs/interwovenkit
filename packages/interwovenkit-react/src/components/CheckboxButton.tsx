import clsx from "clsx"
import type { PropsWithChildren, ReactNode } from "react"
import { IconCheck } from "@initia/icons-react"
import styles from "./CheckboxButton.module.css"

export interface Props {
  checked: boolean
  onClick: () => void
  label: ReactNode
  className?: string
}

const CheckboxButton = ({ checked, onClick, label, className }: PropsWithChildren<Props>) => {
  return (
    <button type="button" className={clsx(styles.button, className)} onClick={onClick}>
      <div className={clsx(styles.checkbox, { [styles.checked]: checked })}>
        {checked && <IconCheck size={12} />}
      </div>
      <span className={styles.label}>{label}</span>
    </button>
  )
}

export default CheckboxButton
