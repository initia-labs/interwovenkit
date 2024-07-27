import { IconChevronDown } from "@initia/icons-react"
import Images from "../Images"
import type { BaseAsset, BaseChain } from "./types"
import styles from "./AssetOnChainButton.module.css"

interface Props {
  chain: BaseChain
  asset: BaseAsset
  readOnly?: boolean
}

const AssetOnChainButton = ({ asset, chain, readOnly }: Props) => {
  const content = (
    <div className={styles.content}>
      <Images assetLogoUrl={asset.logoUrl} chainLogoUrl={chain.logoUrl} />

      <div className={styles.details}>
        <div className={styles.symbol}>{asset.symbol || asset.denom}</div>
        <div className={styles.chain}>on {chain.name}</div>
      </div>
    </div>
  )

  if (readOnly) {
    return <div className={styles.root}>{content}</div>
  }

  return (
    <div className={styles.root}>
      {content}
      <IconChevronDown size={16} className={styles.chevron} />
    </div>
  )
}

export default AssetOnChainButton
