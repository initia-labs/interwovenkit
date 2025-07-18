import { Select } from "radix-ui"
import BigNumber from "bignumber.js"
import type { StdFee } from "@cosmjs/amino"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount } from "@/public/utils"
import { usePortal } from "@/public/app/PortalContext"
import { useChain } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import { useTxRequestHandler } from "@/data/tx"
import styles from "./TxFee.module.css"
import Amplitude from "@/lib/amplitude"

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

  const getLabel = ({ amount: [{ amount, denom }] }: StdFee) => {
    if (BigNumber(amount).isZero()) return "0"
    const { symbol, decimals } = findAsset(denom)
    return `${formatAmount(amount, { decimals })} ${symbol}`
  }

  if (options.length === 1) {
    return getLabel(options[0])
  }

  return (
    <Select.Root
      value={value}
      onValueChange={onChange}
      onOpenChange={(open) => open && Amplitude.logEvent("Tx_fee_clicked")}
    >
      <Select.Trigger className={styles.trigger}>
        <Select.Value />
        <Select.Icon className={styles.icon}>
          <IconChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal container={portalContainer}>
        <Select.Content className={styles.content} position="popper" sideOffset={6} align="end">
          <Select.Viewport>
            {options.map((option) => {
              const [{ denom }] = option.amount
              return (
                <Select.Item className={styles.item} value={denom} key={denom}>
                  <Select.ItemText>{getLabel(option)}</Select.ItemText>
                </Select.Item>
              )
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

export default TxFee
