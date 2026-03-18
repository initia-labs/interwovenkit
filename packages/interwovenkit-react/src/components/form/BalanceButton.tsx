import { IconWallet } from "@initia/icons-react"
import styles from "./BalanceButton.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  onClick: () => void
  disabled?: boolean
}

const BalanceButton = ({ onClick, children, disabled }: PropsWithChildren<Props>) => {
  return (
    <div className={styles.wrapper}>
      <IconWallet size={16} aria-hidden="true" />
      <span className={styles.balance}>{children}</span>
      <button
        type="button"
        tabIndex={-1}
        className={styles.button}
        onClick={() => onClick()}
        disabled={disabled}
        aria-label="Use maximum balance"
      >
        MAX
      </button>
    </div>
  )
}

export default BalanceButton
