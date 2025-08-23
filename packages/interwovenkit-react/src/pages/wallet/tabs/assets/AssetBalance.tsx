import { formatAmount } from "@initia/utils"
import { formatValue } from "@/lib/format"
import type { PortfolioAssetItem } from "@/data/portfolio"
import Images from "@/components/Images"
import AssetActions from "./AssetActions"
import styles from "./AssetBalance.module.css"

interface Props {
  asset: PortfolioAssetItem
}

const ChainBalance = ({ asset }: Props) => {
  const { amount, value, logoUrl, chain } = asset
  const formattedBalance = formatAmount(amount, { decimals: asset.decimals })

  return (
    <AssetActions asset={asset}>
      <button className={styles.item}>
        <div className={styles.info}>
          <Images
            assetLogoUrl={logoUrl}
            chainLogoUrl={chain.logoUrl}
            assetLogoSize={24}
            chainLogoSize={14}
            chainLogoOffset={4}
            className={styles.images}
          />
          <span className={styles.name}>{chain.name}</span>
        </div>
        <div className={styles.value}>
          <span className={styles.amount}>{formattedBalance}</span>
          {Number(value) > 0 && <span className={styles.usd}>{formatValue(value)}</span>}
        </div>
      </button>
    </AssetActions>
  )
}

export default ChainBalance
