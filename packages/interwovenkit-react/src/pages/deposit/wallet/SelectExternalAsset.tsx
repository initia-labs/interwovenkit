import { useEffect, useEffectEvent } from "react"
import { formatAmount } from "@initia/utils"
import ChainAssetListItem from "@/components/form/ChainAssetListItem"
import { useConfig } from "@/data/config"
import { formatValueWithPrice } from "@/lib/format"
import { useLocalAssetOptions } from "../data/assetOptions"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import EmptyIconDark from "./assets/EmptyDark.svg"
import EmptyIconLight from "./assets/EmptyLight.svg"
import { getEmptyDepositCopy } from "./emptyDepositCopy"
import { useExternalAssetOptions, useLocalTransferAsset } from "./externalAssets"
import { useTransferFlow, useTransferForm, useTransferMode } from "./transferFlowConfig"
import styles from "./SelectExternalAsset.module.css"

const SelectExternalAsset = () => {
  const { mode, onExit } = useTransferFlow()
  const { external } = useTransferMode()
  const {
    data: filteredAssets,
    isLoading,
    balancesError,
    supportedExternalChains,
    appchainSourceSymbols,
    externalSourceSymbols,
    localSymbol,
  } = useExternalAssetOptions()
  const { setValue, watch } = useTransferForm()
  const localAsset = useLocalTransferAsset()
  const { data: options } = useLocalAssetOptions()
  const { theme } = useConfig()
  const values = watch()
  const selectedExternalDenom = values[external.denomKey]
  const selectedExternalChainId = values[external.chainIdKey]

  const hasSingleOption = !isLoading && filteredAssets.length === 1

  const singleAssetOptionKey = hasSingleOption
    ? `${filteredAssets[0].chain.chain_id}:${filteredAssets[0].asset.denom}`
    : ""

  function selectExternalAsset(denom: string, chainId: string) {
    setValue(external.denomKey, denom)
    setValue(external.chainIdKey, chainId)
    if (mode === "deposit") setValue("quantity", "")
    setValue("page", "fields")
  }

  const applyAutoSelection = useEffectEvent(() => {
    if (!singleAssetOptionKey) return

    const [{ asset, chain }] = filteredAssets
    const isSelected =
      selectedExternalDenom === asset.denom && selectedExternalChainId === chain.chain_id

    if (isSelected) {
      setValue("page", "fields")
      return
    }

    selectExternalAsset(asset.denom, chain.chain_id)
  })

  useEffect(() => {
    applyAutoSelection()
  }, [singleAssetOptionKey])

  const isExternalSelected = Boolean(selectedExternalDenom && selectedExternalChainId)
  const showBack = isExternalSelected || Boolean(onExit) || options.length > 1 || mode !== "deposit"

  function goBack() {
    if (mode === "withdraw" || isExternalSelected) {
      setValue("page", "fields")
    } else if (onExit) {
      // Embedded in the deposit hub: backward leaves the flow to the method
      // hub instead of the select-local page, which this flow skips.
      onExit()
    } else {
      setValue("page", "select-local")
    }
  }

  const onBack = showBack ? goBack : undefined

  if (!localAsset) return <div>No assets found</div>

  // A balance-query failure empties the deposit-mode list (the filter keeps
  // only assets with a positive balance snapshot), so it must render as an
  // error instead of masquerading as "you hold nothing".
  if (mode === "deposit" && balancesError && !filteredAssets.length) {
    return (
      <div className={styles.container}>
        <DepositSubpage title={`Deposit ${localAsset.symbol} via wallet`} onBack={onBack}>
          <DepositStatus error>Failed to load balances</DepositStatus>
        </DepositSubpage>
      </div>
    )
  }

  if (!isLoading && !filteredAssets.length) {
    const externalChainNames = supportedExternalChains
      .map((chain) => chain.pretty_name || chain.chain_name)
      .filter((name): name is string => !!name)
    const emptyDepositCopy = getEmptyDepositCopy({
      localSymbol,
      externalSourceSymbols,
      externalChainNames,
      appchainSourceSymbols,
    })
    const emptyTitle =
      mode === "withdraw"
        ? `No supported destinations to withdraw ${localAsset.symbol}.`
        : emptyDepositCopy.title

    return (
      <div className={styles.container}>
        <DepositSubpage title="No available assets" onBack={onBack}>
          <img
            src={theme === "dark" ? EmptyIconDark : EmptyIconLight}
            alt="No assets"
            className={styles.emptyIcon}
          />
          <p className={styles.empty}>{emptyTitle}</p>
          {mode === "deposit" && (
            <p className={styles.emptyDescription}>{emptyDepositCopy.description}</p>
          )}
        </DepositSubpage>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Title rule: see DepositSubpage's `title`. */}
      <DepositSubpage
        title={
          mode === "withdraw" ? "Select destination" : `Deposit ${localAsset.symbol} via wallet`
        }
        onBack={onBack}
      >
        <DepositSubpage.List className={styles.list} maxHeight="min(70vh, 90vh - 81px)">
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => <ChainAssetListItem.Skeleton key={i} />)}
          {!isLoading &&
            filteredAssets
              .sort(
                ({ balance: a }, { balance: b }) =>
                  Number(b?.value_usd ?? 0) - Number(a?.value_usd ?? 0),
              )
              .map(({ asset, chain, balance }) => {
                const isActive =
                  selectedExternalDenom === asset.denom &&
                  selectedExternalChainId === chain.chain_id
                return (
                  <ChainAssetListItem
                    key={`${asset.chain_id}-${asset.denom}`}
                    assetLogoUrl={asset.logo_uri}
                    assetSymbol={asset.symbol}
                    chainLogoUrl={chain.logo_uri || ""}
                    chainName={chain.chain_name}
                    chainPrettyName={chain.pretty_name}
                    isActive={isActive}
                    onClick={() => selectExternalAsset(asset.denom, chain.chain_id)}
                    balanceLabel={
                      balance
                        ? formatAmount(balance.amount, { decimals: balance.decimals || 6 })
                        : undefined
                    }
                    valueLabel={
                      balance ? formatValueWithPrice(balance.value_usd, balance.price) : undefined
                    }
                  />
                )
              })}
        </DepositSubpage.List>
      </DepositSubpage>
    </div>
  )
}

export default SelectExternalAsset
