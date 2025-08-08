import { formatAmount, formatNumber } from "@initia/utils"
import type { AssetBalance } from "@/data/portfolio"
import Image from "@/components/Image"
import styles from "./ChainBalance.module.css"
import AssetActions from "./AssetActions"

interface Props {
  chainBalance: AssetBalance
  isUnsupported?: boolean
}

const ChainBalance = ({ chainBalance, isUnsupported }: Props) => {
  const { chain, asset, balance, value } = chainBalance
  const formattedBalance = formatAmount(balance, { decimals: asset.decimals })

  return (
    <AssetActions denom={asset.denom} chain={chain} isUnsupported={isUnsupported}>
      <button className={styles.chainItem}>
        <div className={styles.chainItemInfo}>
          <Image src={chain.logoUrl} width={16} height={16} />
          <span className={styles.chainItemName}>{chain.name}</span>
        </div>
        <div className={styles.chainItemValue}>
          <span className={styles.chainItemAmount}>{formattedBalance}</span>
          {value > 0 && <span className={styles.chainItemUsd}>${formatNumber(value)}</span>}
        </div>
      </button>
    </AssetActions>
  )
}

export default ChainBalance
