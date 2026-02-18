import { useState } from "react"
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

interface Props {
  assets: BaseAsset[]
  onSelect: (denom: string) => void
  renderAsset?: (asset: BaseAsset, children: (asset: BaseAsset) => ReactNode) => ReactNode
}

const AssetOptions = (props: Props) => {
  const { assets, onSelect, renderAsset = (asset, children) => children(asset) } = props
  const [search, setSearch] = useState("")
  const filteredAssets = filterBySearch(["symbol"], search, assets)

  return (
    <div className={styles.container}>
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
        placeholder="Search by symbol"
        rootClassName={styles.search}
        padding={20}
        ref={useAutoFocus()}
      />

      {filteredAssets.length === 0 ? (
        <Status>No assets</Status>
      ) : (
        <div className={styles.list}>
          {filteredAssets.map((asset) => (
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
                    <Image src={logoUrl} width={32} height={32} className={styles.logo} logo />
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
