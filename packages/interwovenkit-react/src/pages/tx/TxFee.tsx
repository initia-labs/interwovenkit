import { Select } from "@base-ui-components/react/select"
import BigNumber from "bignumber.js"
import type { StdFee } from "@interchainjs/amino"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { usePortal } from "@/public/app/PortalContext"
import { useChain } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import { useTxRequestHandler } from "@/data/tx"
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

  const getOption = (denom: string) => {
    const option = options.find((option) => option.amount[0].denom === denom)
    if (!option) throw new Error(`Option not found for denom: ${denom}`)
    return option
  }

  const getLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    if (BigNumber(amount).isZero()) return "0"
    const { symbol, decimals } = findAsset(denom)
    return `${formatAmount(amount, { decimals })} ${symbol}`
  }

  if (options.length === 1) {
    return getLabel(options[0])
  }

  return (
    <Select.Root value={value} onValueChange={onChange} modal={false}>
      <Select.Trigger className={styles.trigger}>
        <Select.Value>{(value) => getLabel(getOption(value))}</Select.Value>
        <Select.Icon className={styles.icon}>
          <IconChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>

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
