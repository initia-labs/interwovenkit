import { IconBack } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useDepositForm, useFilteredDepositAssets } from "./hooks"
import styles from "./SelectSrcAsset.module.css"

interface Props {
  onClose: () => void
}

const SelectSrcAsset = ({ onClose }: Props) => {
  const { data: filteredAssets } = useFilteredDepositAssets()
  const { setValue } = useDepositForm()

  return (
    <div className={styles.container}>
      <button className={styles.close} onClick={onClose}>
        <IconBack size={14} />
      </button>
      <h4 className={styles.title}>Select asset</h4>

      {filteredAssets.map(({ asset, chain, balance }) => (
        <button
          key={`${asset.chain_id}-${asset.denom}`}
          className={styles.asset}
          onClick={() => {
            setValue("srcDenom", asset.denom)
            setValue("srcChainId", chain.chain_id)
            setValue("quantity", "")
            onClose()
          }}
        >
          <div className={styles.iconContainer}>
            <img src={asset.logo_uri} alt={asset.symbol} className={styles.assetIcon} />
            <img src={chain.logo_uri || ""} alt={chain.chain_name} className={styles.chainIcon} />
          </div>
          <p className={styles.assetName}>{asset.symbol}</p>
          <p className={styles.assetChain}>on {chain.pretty_name}</p>
          <p className={styles.balance}>
            {formatAmount(balance?.amount, { decimals: balance.decimals || 6 })}
          </p>
          <p className={styles.value}>${Number(balance.value_usd).toFixed(2)}</p>
        </button>
      ))}
    </div>
  )
}

export default SelectSrcAsset
