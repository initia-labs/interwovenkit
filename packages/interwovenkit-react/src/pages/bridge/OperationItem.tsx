import { IconArrowDown } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import CopyButton from "@/components/CopyButton"
import FormattedAmount from "@/components/FormattedAmount"
import Images from "@/components/Images"
import WidgetTooltip from "@/components/WidgetTooltip"
import placeholder from "@/data/placeholder"
import { useSkipAsset } from "./data/assets"
import { useSkipChain } from "./data/chains"
import styles from "./OperationItem.module.css"

import type { ReactNode } from "react"

interface ComponentProps extends Props {
  symbol?: string
  decimals?: number
  logo_uri?: string
}

const OperationItemComponent = (props: ComponentProps) => {
  const { source, label, amount, denom, chainId, address, walletIcon } = props
  const { symbol = truncate(denom), decimals = 0, logo_uri = placeholder } = props
  const { chain_name, pretty_name, ...chain } = useSkipChain(chainId)

  return (
    <div>
      {!source && (
        <div className={styles.arrow}>
          <div className={styles.divider} />
          {label ? (
            <WidgetTooltip label={label}>
              <button className={styles.type}>
                <IconArrowDown size={12} />
              </button>
            </WidgetTooltip>
          ) : (
            <span className={styles.type}>
              <IconArrowDown size={12} />
            </span>
          )}
          <div className={styles.divider} />
        </div>
      )}

      <div className={styles.content}>
        <Images assetLogoUrl={logo_uri} chainLogoUrl={chain.logo_uri ?? undefined} />

        <div className={styles.info}>
          <div className={styles.asset}>
            <FormattedAmount amount={amount} decimals={decimals} className={styles.amount} />
            <span>{symbol}</span>
          </div>

          <div className={styles.lower}>
            <div className={styles.chain}>on {pretty_name || chain_name}</div>

            {address && (
              <CopyButton value={address}>
                {({ copy, copied }) => (
                  <button className={styles.address} onClick={copy}>
                    {walletIcon}
                    {copied ? (
                      <span>Copied!</span>
                    ) : (
                      <span className="monospace">{truncate(address)}</span>
                    )}
                  </button>
                )}
              </CopyButton>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  source?: boolean
  label?: string
  amount: string
  denom: string
  chainId: string
  address: string
  walletIcon?: ReactNode
}

const OperationItem = (props: Props) => {
  const asset = useSkipAsset(props.denom, props.chainId)
  return <OperationItemComponent {...props} {...asset} />
}

OperationItem.Placeholder = OperationItemComponent

export default OperationItem
