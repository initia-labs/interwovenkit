import type { StdFee } from "@cosmjs/amino"
import { formatAmount } from "@initia/utils"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import { useFindAsset } from "@/data/assets"
import type { NormalizedChain } from "@/data/chains"
import styles from "./TxFee.module.css"

interface Props {
  chain: NormalizedChain
  options: StdFee[]
  value: string
  onChange: (denom: string) => void
}

const TxFee = ({ chain, options, value, onChange }: Props) => {
  const findAsset = useFindAsset(chain)

  const getDp = (amount: string, decimals: number) => {
    if (formatAmount(amount, { decimals }) === "0.000000") return 8
    return undefined
  }

  const getLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    const { symbol, decimals } = findAsset(denom)
    const dp = getDp(amount, decimals)
    return `${formatAmount(amount, { decimals, dp })} ${symbol}`
  }

  const dropdownOptions: DropdownOption<string>[] = options.map((option) => {
    const [{ denom }] = option.amount
    const { symbol } = findAsset(denom)

    return {
      value: denom,
      label: getLabel(option),
      triggerLabel: symbol,
    }
  })

  if (options.length === 1) {
    return <span className="monospace">{getLabel(options[0])}</span>
  }

  const selected = options.find((o) => o.amount[0].denom === value)
  if (!selected) throw new Error("Fee option not found")

  const [{ amount, denom }] = selected.amount
  const { decimals } = findAsset(denom)
  const dp = getDp(amount, decimals)

  return (
    <div className={styles.root}>
      <span className="monospace">{formatAmount(amount, { decimals, dp })}</span>
      <Dropdown options={dropdownOptions} value={value} onChange={onChange} classNames={styles} />
    </div>
  )
}

export default TxFee
