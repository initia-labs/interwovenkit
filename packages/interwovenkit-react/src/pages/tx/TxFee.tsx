import type { StdFee } from "@cosmjs/amino"
import { formatAmount } from "@initia/utils"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useTxRequestHandler } from "@/data/tx"
import { getFeeDp, getFeeLabel } from "@/lib/feeLabel"
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

  const dropdownOptions: DropdownOption<string>[] = options.map((option) => {
    const [{ denom }] = option.amount
    const { symbol } = findAsset(denom)

    return {
      value: denom,
      label: getFeeLabel(option, findAsset),
      triggerLabel: symbol,
    }
  })

  if (options.length === 1) {
    return <span className="monospace">{getFeeLabel(options[0], findAsset)}</span>
  }

  const selected = options.find((o) => o.amount[0].denom === value)
  if (!selected) throw new Error("Fee option not found")

  const [{ amount, denom }] = selected.amount
  const { decimals } = findAsset(denom)
  const dp = getFeeDp(amount, decimals)

  return (
    <div className={styles.root}>
      <span className="monospace">{formatAmount(amount, { decimals, dp })}</span>
      <Dropdown options={dropdownOptions} value={value} onChange={onChange} classNames={styles} />
    </div>
  )
}

export default TxFee
