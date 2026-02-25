import type { StdFee } from "@cosmjs/amino"
import BigNumber from "bignumber.js"
import { formatAmount as formatAmountBase } from "@initia/utils"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import FormattedAmount from "@/components/FormattedAmount"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useTxRequestHandler } from "@/data/tx"
import styles from "./TxFee.module.css"

import type { ReactNode } from "react"

interface Props {
  options: StdFee[]
  value: string
  onChange: (denom: string) => void
}

const TxFee = ({ options, value, onChange }: Props) => {
  const { txRequest } = useTxRequestHandler()
  const chain = useChain(txRequest.chainId)
  const findAsset = useFindAsset(chain)

  const getDp = (amount: string, decimals: number) => {
    if (formatAmountBase(amount, { decimals }) === "0.000000") return 8
    return undefined
  }

  const getLabel = ({ amount: [{ amount, denom }] }: StdFee): ReactNode => {
    if (BigNumber(amount).isZero()) return "0"
    const { symbol, decimals } = findAsset(denom)
    const dp = getDp(amount, decimals)
    return (
      <>
        <FormattedAmount amount={amount} decimals={decimals} dp={dp} /> {symbol}
      </>
    )
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
      <FormattedAmount amount={amount} decimals={decimals} dp={dp} className="monospace" />
      <Dropdown options={dropdownOptions} value={value} onChange={onChange} classNames={styles} />
    </div>
  )
}

export default TxFee
