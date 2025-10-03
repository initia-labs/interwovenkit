import BigNumber from "bignumber.js"
import { Collapsible } from "@base-ui-components/react/collapsible"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount, fromBaseUnit } from "@initia/utils"
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

  // Determine decimal places for display based on fee amount
  // - decimals=6: use default (undefined)
  // - otherwise: show up to 8 decimal places if fee would display as 0.000000
  const dp = BigNumber(fromBaseUnit(fee, { decimals })).lt(0.000001) ? 8 : undefined

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
