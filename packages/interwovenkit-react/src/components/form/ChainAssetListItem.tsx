import clsx from "clsx"
import { IconCheck } from "@initia/icons-react"
import styles from "./ChainAssetListItem.module.css"

const ChainAssetListItemSkeleton = () => {
  return (
    <div className={clsx(styles.asset, styles.placeholder)}>
      <div className={styles.iconContainer}>
        <div className={styles.assetIcon} />
        <div className={styles.chainIcon} />
      </div>
      <div className={styles.assetPlaceholder} />
    </div>
  )
}

interface Props {
  assetLogoUrl?: string
  assetSymbol: string
  chainLogoUrl: string
  chainName: string
  chainPrettyName: string
  balanceLabel?: string
  valueLabel?: string
  isActive?: boolean
  onClick: () => void
}

const ChainAssetListItem = ({
  assetLogoUrl,
  assetSymbol,
  chainLogoUrl,
  chainName,
  chainPrettyName,
  balanceLabel,
  valueLabel,
  isActive,
  onClick,
}: Props) => {
  return (
    <button
      type="button"
      className={clsx(styles.asset, isActive && styles.activeAsset)}
      onClick={onClick}
    >
      <div className={styles.iconContainer}>
        <img src={assetLogoUrl} alt={assetSymbol} className={styles.assetIcon} />
        <img src={chainLogoUrl} alt={chainName} className={styles.chainIcon} />
      </div>
      <p className={styles.assetName}>
        {assetSymbol}{" "}
        {isActive && (
          <span>
            <IconCheck size={16} />
          </span>
        )}
      </p>
      <p className={styles.assetChain}>on {chainPrettyName}</p>
      {balanceLabel !== undefined && (
        <>
          <p className={styles.balance}>{balanceLabel}</p>
          <p className={styles.value}>{valueLabel}</p>
        </>
      )}
    </button>
  )
}

ChainAssetListItem.Skeleton = ChainAssetListItemSkeleton

export default ChainAssetListItem
