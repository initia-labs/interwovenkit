import { useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import { useAllChainAssetsQueries } from "@/data/assets"
import {
  applyLogosToGroups,
  buildAssetLogoMaps,
  filterAssetGroups,
  groupBalancesBySymbol,
  useChainInfoMap,
  useMinityPortfolio,
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import AssetGroup from "./AssetGroup"
import UnlistedAssetsSection from "./UnlistedAssetsSection"
import styles from "./Assets.module.css"

interface AssetsProps {
  searchQuery: string
  selectedChain: string
}

const Assets = ({ searchQuery, selectedChain }: AssetsProps) => {
  // Minity data for main assets (SSE - streams progressively)
  const { balances: minityBalances, isLoading } = useMinityPortfolio()

  // Chain info map for chain names/logos (registry - fast, blocking)
  const chainInfoMap = useChainInfoMap()

  // Asset logos (non-blocking - renders immediately, logos appear when ready)
  const assetsQueries = useAllChainAssetsQueries()
  const { denomLogos, symbolLogos } = useMemo(
    () => buildAssetLogoMaps(assetsQueries),
    [assetsQueries],
  )

  // Group Minity balances by symbol across all chains (no logo dependency - fast)
  const baseAssetGroups = useMemo(
    () => groupBalancesBySymbol(minityBalances, chainInfoMap),
    [minityBalances, chainInfoMap],
  )

  // Apply logos to asset groups (cheap operation - only runs when logos load)
  const assetGroups = useMemo(
    () => applyLogosToGroups(baseAssetGroups, denomLogos, symbolLogos),
    [baseAssetGroups, denomLogos, symbolLogos],
  )

  // Filter by search query and selected chain
  const { filteredAssets, totalAssetsValue } = useMemo(
    () => filterAssetGroups(assetGroups, searchQuery, selectedChain),
    [assetGroups, searchQuery, selectedChain],
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
          <AsyncBoundary>
            <UnlistedAssetsSection searchQuery={searchQuery} selectedChain={selectedChain} />
          </AsyncBoundary>
        </div>
      ) : isLoading ? (
        <FallBack height={56} length={3} />
      ) : (
        <Status>No liquid assets</Status>
      )}
    </div>
  )
}

export default Assets
