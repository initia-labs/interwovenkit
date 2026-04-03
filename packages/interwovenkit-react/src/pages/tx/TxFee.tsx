import type { StdFee } from "@cosmjs/amino"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import FormattedAmount from "@/components/FormattedAmount"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useTxRequestHandler } from "@/data/tx"
import { formatDisplayAmountParts } from "@/lib/format"
import styles from "./TxFee.module.css"

interface Props {
  options: StdFee[]
  value: string
  onChange: (denom: string) => void
}

const TxFee = ({ options, value, onChange }: Props) => {
  const { txRequest } = useTxRequestHandler()
  const chain = useChain(txRequest.chainId)
  const findAsset = useFindAsset(chain)

  const getAmountLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    const { symbol, decimals } = findAsset(denom)
    return (
      <>
        <FormattedAmount amount={amount} decimals={decimals} /> {symbol}
      </>
    )
  }

  const getDropdownLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    const { symbol, decimals } = findAsset(denom)
    const parts = formatDisplayAmountParts(amount, { decimals })

    const formattedAmount =
      parts.kind === "plain"
        ? parts.value
        : `${parts.prefix}${"0".repeat(parts.hiddenZeroCount)}${parts.significant}`

    return `${formattedAmount} ${symbol}`
  }

  const dropdownOptions: DropdownOption<string>[] = options.map((option) => {
    const [{ denom }] = option.amount
    const { symbol } = findAsset(denom)

    return {
      value: denom,
      label: getDropdownLabel(option),
      triggerLabel: symbol,
    }
  })

  if (options.length === 1) {
    return <span className="monospace">{getAmountLabel(options[0])}</span>
  }

  const selected = options.find((o) => o.amount[0].denom === value)
  if (!selected) throw new Error("Fee option not found")

  const [{ amount, denom }] = selected.amount
  const { decimals } = findAsset(denom)

  return (
    <div className={styles.root}>
      <FormattedAmount amount={amount} decimals={decimals} className="monospace" />
      <Dropdown options={dropdownOptions} value={value} onChange={onChange} classNames={styles} />
    </div>
  )
}

export default TxFee
