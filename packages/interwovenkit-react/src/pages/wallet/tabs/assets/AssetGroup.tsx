import clsx from "clsx"
import { useState } from "react"
import { Collapsible } from "radix-ui"
import { IconChevronDown } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import type { AssetGroup as AssetGroupType } from "@/data/portfolio"
import Image from "@/components/Image"
import AssetActions from "./AssetActions"
import ChainBalance from "./ChainBalance"
import styles from "./AssetGroup.module.css"

interface Props {
  assetGroup: AssetGroupType
  isUnsupported?: boolean
}

const AssetGroup = ({ assetGroup, isUnsupported }: Props) => {
  const [open, setOpen] = useState(false)
  const { asset, totalQuantity, totalValue, chains } = assetGroup
  const { symbol, logoUrl, denom } = asset
  const isSingleChain = chains.length === 1

  const formattedBalance = formatNumber(totalQuantity, { dp: 6 })
  const formattedValue = totalValue > 0 ? `$${formatNumber(totalValue)}` : ""

  const renderAssetHeader = () => (
    <button className={styles.assetItem}>
      <div className={styles.assetInfo}>
        {logoUrl && <Image src={logoUrl} width={32} height={32} className={styles.logo} />}
        <div className={styles.details}>
          <div className={styles.symbol}>{symbol}</div>
          {isSingleChain ? (
            <div className={styles.chainName}>{chains[0].chain.name}</div>
          ) : (
            <div className={styles.chainInfos}>
              <div className={styles.chainLogos}>
                {chains.slice(0, 5).map((chainBalance, idx) => (
                  <Image
                    key={chainBalance.chain.chainId}
                    src={chainBalance.chain.logoUrl}
                    width={16}
                    height={16}
                    className={styles.chainLogo}
                    style={{ marginLeft: idx > 0 ? -4 : 0, zIndex: chains.length - idx }}
                  />
                ))}
              </div>
              {chains.length > 5 && <span className={styles.moreChains}>+{chains.length - 5}</span>}
              <IconChevronDown
                size={16}
                className={clsx(styles.expandIcon, { [styles.expanded]: open })}
              />
            </div>
          )}
        </div>
      </div>
      <div className={styles.valueColumn}>
        <div className={styles.amount}>{formattedBalance}</div>
        <div className={styles.value}>{formattedValue}</div>
      </div>
    </button>
  )

  if (isSingleChain) {
    const [{ chain }] = chains
    return (
      <div className={styles.container}>
        <AssetActions denom={denom} chain={chain} isUnsupported={isUnsupported}>
          {renderAssetHeader()}
        </AssetActions>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger asChild>{renderAssetHeader()}</Collapsible.Trigger>

        <Collapsible.Content className={styles.collapsibleContent}>
          <div className={styles.chainsList}>
            {chains.map((chainBalance) => (
              <ChainBalance
                chainBalance={chainBalance}
                isUnsupported={isUnsupported}
                key={chainBalance.chain.chainId}
              />
            ))}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default AssetGroup
