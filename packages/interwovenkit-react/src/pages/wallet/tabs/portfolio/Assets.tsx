import { useMemo } from "react"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import {
  applyFallbackPricing,
  applyLogosToGroups,
  type ChainInfo,
  filterAssetGroups,
  groupBalancesBySymbol,
  useMinityPortfolio,
} from "@/data/minity"
import type { PortfolioAssetItem } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import AssetGroup from "./AssetGroup"
import UnlistedAssetsSection from "./UnlistedAssetsSection"
import styles from "./Assets.module.css"

interface AssetsProps {
  searchQuery: string
  selectedChain: string
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
  unlistedAssets: PortfolioAssetItem[]
  chainInfoMap: Map<string, ChainInfo>
  chainPrices: Map<string, Map<string, number>>
}

const Assets = ({
  searchQuery,
  selectedChain,
  denomLogos,
  symbolLogos,
  unlistedAssets,
  chainInfoMap,
  chainPrices,
}: AssetsProps) => {
  // Minity data for main assets (SSE - streams progressively)
  const { balances: minityBalances, isLoading } = useMinityPortfolio()

  // Apply fallback pricing to balances (if Minity doesn't provide value, use price API)
  const balancesWithPricing = useMemo(
    () => applyFallbackPricing(minityBalances, chainPrices),
    [minityBalances, chainPrices],
  )

  // Group Minity balances by symbol across all chains (no logo dependency - fast)
  const baseAssetGroups = useMemo(
    () => groupBalancesBySymbol(balancesWithPricing, chainInfoMap),
    [balancesWithPricing, chainInfoMap],
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
          <UnlistedAssetsSection
            searchQuery={searchQuery}
            selectedChain={selectedChain}
            unlistedAssets={unlistedAssets}
          />
        </div>
      ) : assetGroups.length === 0 && isLoading ? (
        <FallBack height={56} length={3} />
      ) : (
        <Status>No liquid assets</Status>
      )}
    </div>
  )
}

export default Assets
