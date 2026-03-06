import type { BalanceResponseDenomEntryJson } from "@skip-go/client"
import clsx from "clsx"
import { formatAmount } from "@initia/utils"
import Images from "@/components/Images"
import { formatValue } from "@/lib/format"
import type { AssetWithChain } from "./types"
import styles from "./AssetResultRow.module.css"
import sectionStyles from "./ResultSection.module.css"

interface Props {
  asset: AssetWithChain
  balance?: BalanceResponseDenomEntryJson
  highlighted: boolean
  hideChainName?: boolean
  onSelect: (chainId: string, denom: string) => void
}

const AssetResultRow = ({ asset, balance, highlighted, hideChainName, onSelect }: Props) => {
  const { denom, symbol, name, chainId, chainName, logoUrl, chainLogoUrl, decimals } = asset
  const valueUsd = Number(balance?.value_usd ?? 0)
  const subtitle = hideChainName ? name : `on ${chainName}`

  return (
    <button
      type="button"
      className={clsx(sectionStyles.item, styles.row, { [sectionStyles.highlighted]: highlighted })}
      onClick={() => onSelect(chainId, denom)}
      data-search-item
    >
      <Images
        assetLogoUrl={logoUrl}
        assetLogoSize={28}
        chainLogoUrl={chainLogoUrl}
        chainLogoSize={14}
      />

      <div className={styles.info}>
        <span className={styles.symbol}>{symbol}</span>
        {subtitle && <span className={styles.chain}>{subtitle}</span>}
      </div>

      <div className={styles.balance}>
        {balance?.amount && (
          <>
            <span>{formatAmount(balance.amount, { decimals })}</span>
            {valueUsd > 0 && <span className={styles.value}>{formatValue(valueUsd)}</span>}
          </>
        )}
      </div>
    </button>
  )
}

export default AssetResultRow
