import { useMemo } from "react"
import clsx from "clsx"
import { uniq, without } from "ramda"
import { atom, useAtom } from "jotai"
import { Collapsible } from "radix-ui"
import { IconChevronDown } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import { formatValue } from "@/lib/format"
import type { AssetGroup as AssetGroupType } from "@/data/portfolio"
import { calculateAssetGroupTotalQuantity, calculateAssetGroupTotalValue } from "@/data/portfolio"
import Image from "@/components/Image"
import AssetActions from "./AssetActions"
import ChainBalance from "./ChainBalance"
import styles from "./AssetGroup.module.css"

const openAssetGroupsAtom = atom<string[]>([])

interface Props {
  assetGroup: AssetGroupType
  isUnsupported?: boolean
}

const AssetGroup = ({ assetGroup, isUnsupported }: Props) => {
  const [openAssetGroups, setOpenAssetGroups] = useAtom(openAssetGroupsAtom)
  const { asset, chains } = assetGroup
  const { symbol, logoUrl } = asset
  const isSingleChain = chains.length === 1

  const totalQuantity = useMemo(() => calculateAssetGroupTotalQuantity(assetGroup), [assetGroup])
  const totalValue = useMemo(() => calculateAssetGroupTotalValue(assetGroup), [assetGroup])

  const isOpen = openAssetGroups.includes(symbol)

  const toggleOpen = () => {
    setOpenAssetGroups((prev) => (isOpen ? without([symbol], prev) : uniq([...prev, symbol])))
  }

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
                {chains.slice(0, 5).map((chainBalance) => (
                  <Image
                    key={chainBalance.chain.chainId}
                    src={chainBalance.chain.logoUrl}
                    width={16}
                    height={16}
                    className={styles.chainLogo}
                  />
                ))}
              </div>
              {chains.length > 5 && <span className={styles.moreChains}>+{chains.length - 5}</span>}
              <IconChevronDown
                size={16}
                className={clsx(styles.expandIcon, { [styles.expanded]: isOpen })}
              />
            </div>
          )}
        </div>
      </div>
      <div className={styles.valueColumn}>
        <div className={styles.amount}>
          {formatNumber(totalQuantity, { dp: !isSingleChain ? 6 : Math.min(asset.decimals, 6) })}
        </div>
        {totalValue > 0 && <div className={styles.value}>{formatValue(totalValue)}</div>}
      </div>
    </button>
  )

  if (isSingleChain) {
    const [{ denom, chain }] = chains

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
      <Collapsible.Root open={isOpen} onOpenChange={toggleOpen}>
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
