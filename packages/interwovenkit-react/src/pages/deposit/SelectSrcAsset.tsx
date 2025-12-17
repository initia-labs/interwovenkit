import { IconBack } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useConfig } from "@/data/config"
import EmptyIconDark from "./assets/EmptyDark.svg"
import EmptyIconLight from "./assets/EmptyLight.svg"
import { useDepositForm, useDstDepositAsset, useFilteredDepositAssets } from "./hooks"
import styles from "./SelectSrcAsset.module.css"

const SelectSrcAsset = () => {
  const { data: filteredAssets, isLoading } = useFilteredDepositAssets()
  const { setValue } = useDepositForm()
  const dstAsset = useDstDepositAsset()
  const { theme } = useConfig()

  if (!dstAsset) return null

  function navigateBack() {
    setValue("dstDenom", "")
    setValue("dstChainId", "")
  }

  if (!isLoading && !filteredAssets.length)
    return (
      <div className={styles.container}>
        <button className={styles.close} onClick={navigateBack}>
          <IconBack size={14} />
        </button>
        <h4 className={styles.title}>No available assets</h4>
        <img
          src={theme === "dark" ? EmptyIconDark : EmptyIconLight}
          alt="No assets"
          className={styles.emptyIcon}
        />
        <p className={styles.empty}>
          You do not have supported assets to deposit {dstAsset.symbol}.
        </p>
      </div>
    )

  return (
    <div className={styles.container}>
      <button className={styles.close} onClick={navigateBack}>
        <IconBack size={14} />
      </button>
      <h4 className={styles.title}>Select asset</h4>

      <div className={styles.list}>
        {filteredAssets.map(({ asset, chain, balance }) => (
          <button
            key={`${asset.chain_id}-${asset.denom}`}
            className={styles.asset}
            onClick={() => {
              setValue("srcDenom", asset.denom)
              setValue("srcChainId", chain.chain_id)
              setValue("quantity", "")
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
    </div>
  )
}

export default SelectSrcAsset
