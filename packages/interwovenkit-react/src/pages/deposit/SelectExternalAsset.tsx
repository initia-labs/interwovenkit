import clsx from "clsx"
import { useEffect } from "react"
import { IconBack, IconCheck } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useConfig } from "@/data/config"
import { formatValue } from "@/lib/format"
import EmptyIconDark from "./assets/EmptyDark.svg"
import EmptyIconLight from "./assets/EmptyLight.svg"
import {
  type TransferMode,
  useExternalAssetOptions,
  useLocalAssetOptions,
  useLocalTransferAsset,
  useTransferForm,
  useTransferMode,
} from "./hooks"
import styles from "./SelectExternalAsset.module.css"

interface Props {
  mode: TransferMode
}

const SelectExternalAsset = ({ mode }: Props) => {
  const { external } = useTransferMode(mode)
  const { data: filteredAssets, isLoading } = useExternalAssetOptions(mode)
  const { setValue, watch } = useTransferForm()
  const localAsset = useLocalTransferAsset(mode)
  const options = useLocalAssetOptions()
  const { theme } = useConfig()
  const values = watch()
  const selectedExternalDenom = values[external.denomKey]
  const selectedExternalChainId = values[external.chainIdKey]
  const currentPage = values.page

  useEffect(() => {
    if (isLoading || filteredAssets.length !== 1) return

    const [{ asset, chain }] = filteredAssets
    const isSelected =
      selectedExternalDenom === asset.denom && selectedExternalChainId === chain.chain_id

    if (isSelected) {
      if (currentPage !== "fields") setValue("page", "fields")
      return
    }

    setValue(external.denomKey, asset.denom)
    setValue(external.chainIdKey, chain.chain_id)
    if (mode === "deposit") setValue("quantity", "")
    setValue("page", "fields")
  }, [
    external.chainIdKey,
    external.denomKey,
    filteredAssets,
    isLoading,
    mode,
    selectedExternalChainId,
    selectedExternalDenom,
    setValue,
    currentPage,
  ])

  function renderBackButton() {
    const isExternalSelected = selectedExternalDenom && selectedExternalChainId
    if (!isExternalSelected && options.length <= 1 && mode === "deposit") return null

    return (
      <button
        className={styles.close}
        onClick={() => {
          if (mode === "withdraw" || isExternalSelected) {
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

  if (!localAsset) return <div>No assets found</div>

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
          {mode === "withdraw"
            ? `No supported destinations to withdraw ${localAsset.symbol}.`
            : `No supported assets to deposit ${localAsset.symbol}.`}
        </p>
      </div>
    )

  return (
    <div className={styles.container}>
      {renderBackButton()}
      <h4 className={styles.title}>
        {mode === "withdraw" ? "Select destination" : `Deposit ${localAsset.symbol}`}{" "}
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
              const isActive =
                selectedExternalDenom === asset.denom && selectedExternalChainId === chain.chain_id
              return (
                <button
                  key={`${asset.chain_id}-${asset.denom}`}
                  className={clsx(styles.asset, isActive && styles.activeAsset)}
                  onClick={() => {
                    setValue(external.denomKey, asset.denom)
                    setValue(external.chainIdKey, chain.chain_id)
                    if (mode === "deposit") setValue("quantity", "")
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
