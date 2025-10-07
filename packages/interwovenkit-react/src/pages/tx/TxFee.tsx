import type { StdFee } from "@cosmjs/amino"
import BigNumber from "bignumber.js"
import { Select } from "@base-ui-components/react/select"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useTxRequestHandler } from "@/data/tx"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./TxFee.module.css"

interface Props {
  options: StdFee[]
  value: string
  onChange: (denom: string) => void
}

const TxFee = ({ options, value, onChange }: Props) => {
  const portalContainer = usePortal()
  const { txRequest } = useTxRequestHandler()
  const chain = useChain(txRequest.chainId)
  const findAsset = useFindAsset(chain)

  const getDp = (amount: string, decimals: number) => {
    if (formatAmount(amount, { decimals }) === "0.000000") return 8
    return undefined
  }

  const getLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    if (BigNumber(amount).isZero()) return "0"
    const { symbol, decimals } = findAsset(denom)
    const dp = getDp(amount, decimals)
    return `${formatAmount(amount, { decimals, dp })} ${symbol}`
  }

  if (options.length === 1) {
    return <span className="monospace">{getLabel(options[0])}</span>
  }

  const selected = options.find((o) => o.amount[0].denom === value)
  if (!selected) throw new Error("Fee option not found")
  const [{ amount, denom }] = selected.amount
  const { decimals, symbol } = findAsset(denom)
  const dp = getDp(amount, decimals)

  return (
    <Select.Root value={value} onValueChange={onChange} modal={false}>
      <div className={styles.value}>
        <span className="monospace">{formatAmount(amount, { decimals, dp })}</span>
        <Select.Trigger className={styles.trigger}>
          <Select.Value>{symbol}</Select.Value>
          <Select.Icon className={styles.icon}>
            <IconChevronDown size={16} />
          </Select.Icon>
        </Select.Trigger>
      </div>

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={styles.content}
          alignItemWithTrigger={false}
          sideOffset={6}
          align="end"
        >
          <Select.Popup>
            {options.map((option) => {
              const [{ denom }] = option.amount
              return (
                <Select.Item className={styles.item} value={denom} key={denom}>
                  <Select.ItemText>{getLabel(option)}</Select.ItemText>
                </Select.Item>
              )
            })}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default TxFee
