import { memo, useMemo } from "react"
import Skeletons from "@/components/Skeletons"
import Status from "@/components/Status"
import { useLayer1 } from "@/data/chains"
import {
  applyLogosToGroups,
  type ChainInfo,
  filterAllAssets,
  processMinityBalances,
  useMinityPortfolio,
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import AssetGroup from "./AssetGroup"
import UnlistedAssets from "./UnlistedAssets"
import styles from "./Assets.module.css"

interface AssetsProps {
  searchQuery: string
  selectedChain: string
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
  chainInfoMap: Map<string, ChainInfo>
  chainPrices: Map<string, Map<string, number>>
}

const Assets = memo(
  ({
    searchQuery,
    selectedChain,
    denomLogos,
    symbolLogos,
    chainInfoMap,
    chainPrices,
  }: AssetsProps) => {
    // Minity data for ALL assets (SSE - streams progressively)
    // Single data source for both listed and unlisted assets
    const { balances: minityBalances, isLoading } = useMinityPortfolio()

    // Get L1 chain ID for sorting unlisted assets (Initia first)
    const layer1 = useLayer1()

    // OPTIMIZED: Single-pass processing of all Minity data
    // Extracts both listed and unlisted assets, applies pricing, groups by symbol
    // Replaces 3 separate iterations with 1 efficient pass
    const { listedGroups: baseAssetGroups, unlistedAssets } = useMemo(
      () => processMinityBalances(minityBalances, chainInfoMap, chainPrices, layer1.chainId),
      [minityBalances, chainInfoMap, chainPrices, layer1.chainId],
    )

    // Apply logos to asset groups (cheap operation - only runs when logos load)
    const assetGroups = useMemo(
      () => applyLogosToGroups(baseAssetGroups, denomLogos, symbolLogos),
      [baseAssetGroups, denomLogos, symbolLogos],
    )

    // Filter both listed and unlisted assets in one operation
    const { filteredAssets, totalAssetsValue, filteredUnlistedAssets } = useMemo(
      () => filterAllAssets(assetGroups, unlistedAssets, searchQuery, selectedChain),
      [assetGroups, unlistedAssets, searchQuery, selectedChain],
    )

    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.title}>Assets</span>
          {filteredAssets.length > 0 && (
            <span className={styles.totalValue}>{formatValue(totalAssetsValue)}</span>
          )}
        </div>
        {filteredAssets.length > 0 ? (
          <div>
            <div className={styles.list}>
              {filteredAssets.map((assetGroup) => (
                <AssetGroup assetGroup={assetGroup} key={assetGroup.symbol} />
              ))}
            </div>
            <UnlistedAssets unlistedAssets={filteredUnlistedAssets} />
          </div>
        ) : assetGroups.length === 0 && isLoading ? (
          <Skeletons height={56} length={3} />
        ) : (
          <Status>No liquid assets</Status>
        )}
      </div>
    )
  },
)

export default Assets
