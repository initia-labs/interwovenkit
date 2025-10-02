import { Collapsible } from "radix-ui"
import { IconChevronDown } from "@initia/icons-react"
import styles from "./TxInsufficientBalance.module.css"

interface TxInsufficientBalanceProps {
  formattedSpend: string | null
  formattedFee: string
  formattedTotal: string
  formattedBalance: string
  symbol: string
}

const TxInsufficientBalance = ({
  formattedSpend,
  formattedFee,
  formattedTotal,
  formattedBalance,
  symbol,
}: TxInsufficientBalanceProps) => {
  return (
    <Collapsible.Root defaultOpen={false} className={styles.root}>
      <Collapsible.Trigger className={styles.trigger}>
        <span>Insufficient balance for fee</span>
        <IconChevronDown className={styles.chevron} size={16} />
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.content}>
        <div className={styles.details}>
          {formattedSpend && (
            <div className={styles.row}>
              <span>Spend</span>
              <span>
                {formattedSpend} {symbol}
              </span>
            </div>
          )}

          <div className={styles.row}>
            <span>Fee</span>
            <span>
              {formattedFee} {symbol}
            </span>
          </div>

          {formattedSpend && (
            <div className={styles.row}>
              <span>Required (spend + fee)</span>
              <span>
                {formattedTotal} {symbol}
              </span>
            </div>
          )}

          <div className={styles.row}>
            <span>Balance</span>
            <span>
              {formattedBalance} {symbol}
            </span>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default TxInsufficientBalance
