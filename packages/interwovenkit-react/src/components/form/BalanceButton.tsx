import type { PropsWithChildren } from "react"
import { IconWallet } from "@initia/icons-react"
import styles from "./BalanceButton.module.css"

interface Props {
  onClick: () => void
  disabled?: boolean
}

const BalanceButton = ({ onClick, children, disabled }: PropsWithChildren<Props>) => {
  return (
    <div className={styles.wrapper}>
      <IconWallet size={16} />
      <span className={styles.balance}>{children}</span>
      <button type="button" className={styles.button} onClick={() => onClick()} disabled={disabled}>
        MAX
      </button>
    </div>
  )
}

export default BalanceButton
