import { formatAmount } from "@initia/utils"
import { formatValue } from "@/lib/format"
import type { AssetBalance } from "@/data/portfolio"
import Images from "@/components/Images"
import AssetActions from "./AssetActions"
import styles from "./ChainBalance.module.css"

interface Props {
  chainBalance: AssetBalance
  isUnsupported?: boolean
}

const ChainBalance = ({ chainBalance, isUnsupported }: Props) => {
  const { chain, asset, denom, amount, value } = chainBalance
  const formattedBalance = formatAmount(amount, { decimals: asset.decimals })

  return (
    <AssetActions denom={denom} chain={chain} isUnsupported={isUnsupported}>
      <button className={styles.item}>
        <div className={styles.info}>
          <Images
            assetLogoUrl={asset.logoUrl}
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
          {value > 0 && <span className={styles.usd}>{formatValue(value)}</span>}
        </div>
      </button>
    </AssetActions>
  )
}

export default ChainBalance
