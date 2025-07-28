import type { ReactNode } from "react"
import { useState } from "react"
import { formatAmount, formatNumber } from "@initia/utils"
import Image from "../Image"
import Status from "../Status"
import type { BaseAsset } from "./types"
import { filterBySearch } from "./search"
import SearchInput from "./SearchInput"
import styles from "./AssetOptions.module.css"

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
      <SearchInput value={search} onChange={setSearch} placeholder="Search by symbol" />

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
              {renderAsset(asset, ({ logoUrl, symbol, name, balance, decimals, value = 0 }) => (
                <>
                  <Image src={logoUrl} width={32} height={32} className={styles.logo} />
                  <div className={styles.info}>
                    <div className={styles.symbol}>{symbol}</div>
                    <div className={styles.name}>{name}</div>
                  </div>
                  <div className={styles.balance}>
                    {balance && <div>{formatAmount(balance, { decimals })}</div>}
                    {value > 0 && <div className={styles.value}>${formatNumber(value)}</div>}
                  </div>
                </>
              ))}
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
      <SearchInput placeholder="Search by symbol" />
      <Status>Loading...</Status>
    </div>
  )
}

AssetOptions.Placeholder = AssetOptionsPlaceholder

export default AssetOptions
