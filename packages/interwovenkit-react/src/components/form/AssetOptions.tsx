import clsx from "clsx"
import { memo, useDeferredValue, useMemo, useState } from "react"
import { formatAmount } from "@initia/utils"
import { formatValue } from "@/lib/format"
import Image from "../Image"
import Status from "../Status"
import { useAutoFocus } from "./hooks"
import { filterBySearch } from "./search"
import SearchInput from "./SearchInput"
import type { BaseAsset } from "./types"
import styles from "./AssetOptions.module.css"

import type { ReactNode } from "react"

const DEFAULT_SEARCH_KEYS: Array<keyof BaseAsset> = ["symbol"]
const DEFAULT_RENDER_ASSET = (asset: BaseAsset, children: (asset: BaseAsset) => ReactNode) =>
  children(asset)

interface AssetListProps {
  assets: BaseAsset[]
  onSelect: (denom: string) => void
  renderAsset: (asset: BaseAsset, children: (asset: BaseAsset) => ReactNode) => ReactNode
  listClassName?: string
}

const AssetList = memo(function AssetList(props: AssetListProps) {
  const { assets, onSelect, renderAsset, listClassName } = props

  return (
    <div className={clsx(styles.list, listClassName)}>
      {assets.map((asset) => (
        <button
          type="button"
          className={styles.item}
          onClick={() => onSelect(asset.denom)}
          key={asset.denom}
        >
          {renderAsset(asset, (asset) => {
            const { denom, logoUrl, symbol, name, balance, decimals, value = 0 } = asset
            return (
              <>
                <Image
                  src={logoUrl}
                  width={32}
                  height={32}
                  className={styles.logo}
                  classNames={{ placeholder: styles.fallback }}
                  logo
                />
                <div className={styles.info}>
                  <div className={styles.symbol}>{symbol || denom}</div>
                  <div className={styles.name}>{name}</div>
                </div>
                <div className={styles.balance}>
                  {balance && <div>{formatAmount(balance, { decimals })}</div>}
                  {value > 0 && <div className={styles.value}>{formatValue(value)}</div>}
                </div>
              </>
            )
          })}
        </button>
      ))}
    </div>
  )
})

interface Props {
  assets: BaseAsset[]
  onSelect: (denom: string) => void
  renderAsset?: (asset: BaseAsset, children: (asset: BaseAsset) => ReactNode) => ReactNode
  /** Asset fields matched by the search box. Defaults to symbol only. */
  searchKeys?: Array<keyof BaseAsset>
  /** Search box placeholder. */
  placeholder?: string
  /** Empty-state message shown when nothing matches the search. */
  emptyMessage?: string
  /** Extra class on the scrollable list, e.g. to cap height outside a modal. */
  listClassName?: string
}

const AssetOptions = (props: Props) => {
  const {
    assets,
    onSelect,
    renderAsset = DEFAULT_RENDER_ASSET,
    searchKeys = DEFAULT_SEARCH_KEYS,
    placeholder = "Search by symbol",
    emptyMessage = "No assets",
    listClassName,
  } = props
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const filteredAssets = useMemo(
    () => filterBySearch(searchKeys, deferredSearch, assets),
    [searchKeys, deferredSearch, assets],
  )

  return (
    <div className={styles.container}>
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
        placeholder={placeholder}
        rootClassName={styles.search}
        padding={20}
        ref={useAutoFocus()}
      />

      {filteredAssets.length === 0 ? (
        <Status>{emptyMessage}</Status>
      ) : (
        <AssetList
          assets={filteredAssets}
          onSelect={onSelect}
          renderAsset={renderAsset}
          listClassName={listClassName}
        />
      )}
    </div>
  )
}

const AssetOptionsPlaceholder = () => {
  return (
    <div className={styles.container}>
      <SearchInput
        rootClassName={styles.search}
        padding={20}
        placeholder="Search by symbol"
        readOnly
      />
      <Status>Loading...</Status>
    </div>
  )
}

AssetOptions.Placeholder = AssetOptionsPlaceholder

export default AssetOptions
