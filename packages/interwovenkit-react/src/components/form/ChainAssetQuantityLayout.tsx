import { IconWarningFilled } from "@initia/icons-react"
import styles from "./ChainAssetQuantityLayout.module.css"

import type { ReactNode } from "react"

interface Props {
  selectButton: ReactNode
  accountButton?: ReactNode
  quantityInput: ReactNode
  balanceButton?: ReactNode
  value?: string
  errorMessage?: string
  hideNumbers?: boolean
}

const ChainAssetQuantityLayout = (props: Props) => {
  const {
    selectButton,
    accountButton,
    quantityInput,
    balanceButton,
    value,
    errorMessage,
    hideNumbers,
  } = props

  return (
    <div className={styles.fieldset}>
      <div className={styles.upper}>
        <div className={styles.select}>{selectButton}</div>
        <div className={styles.account}>{accountButton}</div>
      </div>

      {!hideNumbers && (
        <div className={styles.lower}>
          {quantityInput}

          <div className={styles.wrapper}>
            <div className={styles.balance}>{balanceButton}</div>
            {value && <div className={styles.value}>{value}</div>}
          </div>

          {errorMessage && (
            <footer className={styles.error}>
              <IconWarningFilled size={12} />
              <p>{errorMessage}</p>
            </footer>
          )}
        </div>
      )}
    </div>
  )
}

export default ChainAssetQuantityLayout
