import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo } from "react"
import { atom, useAtom } from "jotai"
import { IconChevronDown } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import type { PortfolioAssetGroup } from "@/data/portfolio"
import { calculateTotalQuantity, calculateTotalValue } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import AssetActions from "./AssetActions"
import AssetBalance from "./AssetBalance"
import styles from "./AssetGroup.module.css"

const openAssetGroupsAtom = atom<string[]>([])

interface Props {
  assetGroup: PortfolioAssetGroup
}

const AssetGroup = ({ assetGroup }: Props) => {
  const { symbol, logoUrl, assets } = assetGroup
  const isSingleChain = assets.length === 1

  const [openAssetGroups, setOpenAssetGroups] = useAtom(openAssetGroupsAtom)

  const totalQuantity = useMemo(() => calculateTotalQuantity(assetGroup), [assetGroup])
  const totalValue = useMemo(() => calculateTotalValue(assetGroup), [assetGroup])

  const isOpen = openAssetGroups.includes(symbol)

  const toggleOpen = () => {
    setOpenAssetGroups((prev) =>
      isOpen
        ? prev.filter((openAssetSymbol) => openAssetSymbol !== symbol)
        : [...new Set([...prev, symbol])],
    )
  }

  const renderAssetHeader = () => (
    <button className={styles.assetItem}>
      <div className={styles.assetInfo}>
        {logoUrl && <Image src={logoUrl} width={32} height={32} className={styles.logo} logo />}
        <div className={styles.details}>
          <div className={styles.symbol}>{symbol}</div>
          {isSingleChain ? (
            <div className={styles.chainName}>{assets[0].chain.name}</div>
          ) : (
            <div className={styles.chainInfos}>
              <div className={styles.chainLogos}>
                {assets.slice(0, 5).map(({ chain }) => (
                  <Image
                    key={chain.chainId}
                    src={chain.logoUrl}
                    width={16}
                    height={16}
                    className={styles.chainLogo}
                    logo
                  />
                ))}
              </div>
              {assets.length > 5 && <span className={styles.moreChains}>+{assets.length - 5}</span>}
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
          {formatNumber(totalQuantity, { dp: assets[0].unlisted ? 0 : 6 })}
        </div>
        {totalValue > 0 && <div className={styles.value}>{formatValue(totalValue)}</div>}
      </div>
    </button>
  )

  if (isSingleChain) {
    const [asset] = assets

    return (
      <div className={styles.container}>
        <AssetActions asset={asset}>{renderAssetHeader()}</AssetActions>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Collapsible.Root open={isOpen} onOpenChange={toggleOpen}>
        <Collapsible.Trigger asChild>{renderAssetHeader()}</Collapsible.Trigger>

        <Collapsible.Content className={styles.collapsibleContent}>
          <div className={styles.chainsList}>
            {assets.map((asset) => (
              <AssetBalance asset={asset} key={asset.chain.chainId} />
            ))}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default AssetGroup
