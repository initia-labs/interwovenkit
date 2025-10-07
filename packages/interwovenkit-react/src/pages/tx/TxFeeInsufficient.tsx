import { Collapsible } from "@base-ui-components/react/collapsible"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import styles from "./TxFeeInsufficient.module.css"

interface Props {
  spend: string | null
  fee: string
  total: string
  balance: string
  symbol: string
  decimals: number
}

const TxFeeInsufficient = ({ spend, fee, total, balance, symbol, decimals }: Props) => {
  const rows = [
    spend && { label: "Spend", value: spend },
    { label: "Fee", value: fee },
    spend && { label: "Required (spend + fee)", value: total },
    { label: "Balance", value: balance },
  ].filter(Boolean) as Array<{ label: string; value: string }>

  // Show 8 decimal places for high-precision tokens (decimals=18) to display meaningful fee amounts
  // Without this, fees might show as 0.000000 ETH or required/balance appear equal when they're not
  // 8dp is a balance between accuracy and UI space constraints (full 18dp would be excessive)
  const dp = decimals === 6 ? undefined : 8

  return (
    <Collapsible.Root className={styles.root}>
      <Collapsible.Trigger className={styles.trigger}>
        <span>Insufficient balance for fee</span>
        <IconChevronDown className={styles.chevron} size={16} />
      </Collapsible.Trigger>

      <Collapsible.Panel className={styles.panel}>
        <div className={styles.details}>
          {rows.map(({ label, value }) => (
            <div key={label} className={styles.row}>
              <span>{label}</span>
              <span>
                {formatAmount(value, { decimals, dp })} {symbol}
              </span>
            </div>
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

export default TxFeeInsufficient
