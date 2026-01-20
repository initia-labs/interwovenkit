import clsx from "clsx"
import { IconBack, IconCheck } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useConfig } from "@/data/config"
import { formatValue } from "@/lib/format"
import { usePath } from "@/lib/router"
import EmptyIconDark from "./assets/EmptyDark.svg"
import EmptyIconLight from "./assets/EmptyLight.svg"
import {
  useExternalAssetOptions,
  useLocalAssetDepositAsset,
  useLocalAssetOptions,
  useTransferForm,
} from "./hooks"
import styles from "./SelectExternalAsset.module.css"

const SelectExternalAsset = () => {
  const path = usePath()
  const { data: filteredAssets, isLoading } = useExternalAssetOptions()
  const { setValue, watch } = useTransferForm()
  const localAsset = useLocalAssetDepositAsset()
  const options = useLocalAssetOptions()
  const { theme } = useConfig()
  const { srcDenom, srcChainId, dstDenom, dstChainId } = watch()
  const isWithdraw = path === "/withdraw"

  const externalDenomKey = isWithdraw ? "dstDenom" : "srcDenom"
  const externalChainIdKey = isWithdraw ? "dstChainId" : "srcChainId"

  function renderBackButton() {
    const externalDenom = isWithdraw ? dstDenom : srcDenom
    const externalChainId = isWithdraw ? dstChainId : srcChainId
    const isExternalSelected = externalDenom && externalChainId
    if (!isExternalSelected && options.length <= 1 && !isWithdraw) return null

    return (
      <button
        className={styles.close}
        onClick={() => {
          if (isWithdraw || isExternalSelected) {
            setValue("page", "fields")
          } else {
            setValue("page", "select-local")
          }
        }}
      >
        <IconBack size={20} />
      </button>
    )
  }

  if (!localAsset) return <div>No asset found</div>

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
          You do not have supported assets to deposit {localAsset.symbol}.
        </p>
      </div>
    )

  return (
    <div className={styles.container}>
      {renderBackButton()}
      <h4 className={styles.title}>
        {isWithdraw ? "Select destination" : `Deposit ${localAsset.symbol}`}{" "}
      </h4>

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
          filteredAssets
            .sort(
              ({ balance: a }, { balance: b }) =>
                Number(b?.value_usd ?? 0) - Number(a?.value_usd ?? 0),
            )
            .map(({ asset, chain, balance }) => {
              const externalDenom = isWithdraw ? dstDenom : srcDenom
              const externalChainId = isWithdraw ? dstChainId : srcChainId
              const isActive = externalDenom === asset.denom && externalChainId === chain.chain_id
              return (
                <button
                  key={`${asset.chain_id}-${asset.denom}`}
                  className={clsx(styles.asset, isActive && styles.activeAsset)}
                  onClick={() => {
                    setValue(externalDenomKey, asset.denom)
                    setValue(externalChainIdKey, chain.chain_id)
                    if (!isWithdraw) setValue("quantity", "")
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
                    {asset.symbol}{" "}
                    {isActive && (
                      <span>
                        <IconCheck size={16} />
                      </span>
                    )}
                  </p>
                  <p className={styles.assetChain}>on {chain.pretty_name}</p>
                  {balance && (
                    <>
                      <p className={styles.balance}>
                        {formatAmount(balance.amount, { decimals: balance.decimals || 6 })}
                      </p>
                      <p className={styles.value}>{formatValue(balance.value_usd || 0)}</p>
                    </>
                  )}
                </button>
              )
            })}
      </div>
    </div>
  )
}

export default SelectExternalAsset
