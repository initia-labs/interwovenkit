import { Collapsible } from "@base-ui-components/react/collapsible"
import { IconChevronDown } from "@initia/icons-react"
import styles from "./TxFeeInsufficient.module.css"

interface Props {
  formattedSpend: string | null
  formattedFee: string
  formattedTotal: string
  formattedBalance: string
  symbol: string
}

const TxFeeInsufficient = ({
  formattedSpend,
  formattedFee,
  formattedTotal,
  formattedBalance,
  symbol,
}: Props) => {
  const rows = [
    formattedSpend && { label: "Spend", value: `${formattedSpend} ${symbol}` },
    { label: "Fee", value: `${formattedFee} ${symbol}` },
    formattedSpend && { label: "Required (spend + fee)", value: `${formattedTotal} ${symbol}` },
    { label: "Balance", value: `${formattedBalance} ${symbol}` },
  ].filter(Boolean) as Array<{ label: string; value: string }>

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
              <span>{value}</span>
            </div>
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

export default TxFeeInsufficient
