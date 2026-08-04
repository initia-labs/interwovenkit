import styles from "./SimpleAssetList.module.css"

export interface SimpleAsset {
  denom: string
  chainId: string
  symbol: string
  logoUrl: string
}

interface Props {
  assets: SimpleAsset[]
  onSelect: (asset: SimpleAsset) => void
  isBusy?: boolean
}

/** Pill-card asset list. The page shell (title, back) is composed by callers. */
const SimpleAssetList = ({ assets, onSelect, isBusy }: Props) => {
  return (
    <div className={styles.list} aria-busy={isBusy}>
      {assets.map((asset) => (
        <button
          type="button"
          className={styles.asset}
          key={`${asset.denom}-${asset.chainId}`}
          onClick={() => onSelect(asset)}
          disabled={isBusy}
        >
          {asset.logoUrl ? (
            <img src={asset.logoUrl} alt={asset.symbol} />
          ) : (
            <div className={styles.imgPlaceholder} aria-hidden="true" />
          )}
          {asset.symbol}
        </button>
      ))}
    </div>
  )
}

export default SimpleAssetList
