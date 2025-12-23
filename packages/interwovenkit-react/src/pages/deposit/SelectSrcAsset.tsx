import clsx from "clsx"
import { IconBack, IconCheckCircleFilled } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useConfig } from "@/data/config"
import EmptyIconDark from "./assets/EmptyDark.svg"
import EmptyIconLight from "./assets/EmptyLight.svg"
import {
  useDepositForm,
  useDepositOptions,
  useDstDepositAsset,
  useFilteredDepositAssets,
} from "./hooks"
import styles from "./SelectSrcAsset.module.css"

const SelectSrcAsset = () => {
  const { data: filteredAssets, isLoading } = useFilteredDepositAssets()
  const { setValue, watch } = useDepositForm()
  const dstAsset = useDstDepositAsset()
  const options = useDepositOptions()
  const { theme } = useConfig()
  const { srcDenom, srcChainId } = watch()

  function renderBackButton() {
    const isSrcSelected = srcDenom && srcChainId
    if (!isSrcSelected && options.length <= 1) return null

    return (
      <button
        className={styles.close}
        onClick={() => {
          if (isSrcSelected) {
            setValue("page", "fields")
          } else {
            setValue("page", "select-dst")
          }
        }}
      >
        <IconBack size={14} />
      </button>
    )
  }

  if (!dstAsset) return null

  if (!isLoading && !filteredAssets.length)
    return (
      <div className={styles.container}>
        {renderBackButton()}
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
      {renderBackButton()}
      <h4 className={styles.title}>Deposit {dstAsset.symbol}</h4>

      <div className={styles.list}>
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={clsx(styles.asset, styles.placeholder)}>
              <div className={styles.iconContainer}>
                <div className={styles.assetIcon} />
                <div className={styles.chainIcon} />
              </div>
              <div className={styles.assetPlaceholder} />
            </div>
          ))}
        {!isLoading &&
          filteredAssets.map(({ asset, chain, balance }) => {
            const isActive = srcDenom === asset.denom && srcChainId === chain.chain_id
            return (
              <button
                key={`${asset.chain_id}-${asset.denom}`}
                className={clsx(styles.asset, isActive && styles.activeAsset)}
                onClick={() => {
                  setValue("srcDenom", asset.denom)
                  setValue("srcChainId", chain.chain_id)
                  setValue("quantity", "")
                  setValue("page", "fields")
                }}
              >
                <div className={styles.iconContainer}>
                  <img src={asset.logo_uri} alt={asset.symbol} className={styles.assetIcon} />
                  <img
                    src={chain.logo_uri || ""}
                    alt={chain.chain_name}
                    className={styles.chainIcon}
                  />
                </div>
                <p className={styles.assetName}>
                  {asset.symbol} {isActive && <IconCheckCircleFilled size={14} />}
                </p>
                <p className={styles.assetChain}>on {chain.pretty_name}</p>
                <p className={styles.balance}>
                  {formatAmount(balance?.amount, { decimals: balance.decimals || 6 })}
                </p>
                <p className={styles.value}>${Number(balance.value_usd).toFixed(2)}</p>
              </button>
            )
          })}
      </div>
    </div>
  )
}

export default SelectSrcAsset
