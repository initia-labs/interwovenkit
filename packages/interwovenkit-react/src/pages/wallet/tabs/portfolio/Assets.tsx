import { useMemo } from "react"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import { useInitiaRegistry } from "@/data/chains"
import { buildDenomLogoMap, compareAssetGroups, useMinityBalances } from "@/data/minity"
import { type PortfolioAssetGroup, type PortfolioAssetItem, usePortfolio } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import AssetGroup from "./AssetGroup"
import UnlistedAssets from "./UnlistedAssets"
import styles from "./Assets.module.css"

interface AssetsProps {
  searchQuery: string
  selectedChain: string
}

const Assets = ({ searchQuery, selectedChain }: AssetsProps) => {
  // Minity data for main assets
  const { data: minityBalances, isLoading: isMinityLoading } = useMinityBalances()

  // usePortfolio for logos and unlisted assets
  const {
    assetGroups: portfolioAssetGroups,
    unlistedAssets,
    isLoading: isPortfolioLoading,
  } = usePortfolio()

  // Registry for chain info lookup
  const registry = useInitiaRegistry()

  // Build registry lookup maps in a single useMemo
  const { chainNameToIdMap, chainIdToRegistryMap } = useMemo(() => {
    const nameToId = new Map<string, string>()
    const idToRegistry = new Map<string, (typeof registry)[number]>()
    for (const chain of registry) {
      nameToId.set(chain.chain_name.toLowerCase(), chain.chainId)
      idToRegistry.set(chain.chainId, chain)
    }
    return { chainNameToIdMap: nameToId, chainIdToRegistryMap: idToRegistry }
  }, [registry])

  // Build denom -> logo map from InterwovenKit
  const denomLogoMap = useMemo(
    () => buildDenomLogoMap(portfolioAssetGroups),
    [portfolioAssetGroups],
  )

  // Group Minity balances by symbol across all chains
  const assetGroups = useMemo(() => {
    const groupMap = new Map<string, PortfolioAssetItem[]>()

    for (const { chainName, balances } of minityBalances) {
      const chainId = chainNameToIdMap.get(chainName.toLowerCase())
      const registryChain = chainId ? chainIdToRegistryMap.get(chainId) : null

      for (const balance of balances) {
        // Skip unknown types, LP tokens, and zero/negative values
        if (balance.type === "unknown" || balance.type === "lp" || (balance.value ?? 0) <= 0)
          continue

        const denomLogos = denomLogoMap.get(balance.denom)

        const item: PortfolioAssetItem = {
          symbol: balance.symbol,
          logoUrl: denomLogos?.assetLogo ?? "",
          denom: balance.denom,
          amount: balance.amount,
          decimals: balance.decimals,
          quantity: String(balance.formattedAmount),
          value: balance.value,
          chain: {
            chainId: chainId ?? chainName,
            name: registryChain?.name ?? chainName,
            logoUrl: denomLogos?.chainLogo ?? registryChain?.logoUrl ?? "",
          },
        }

        const existing = groupMap.get(balance.symbol)
        if (existing) {
          existing.push(item)
        } else {
          groupMap.set(balance.symbol, [item])
        }
      }
    }

    // Convert to array and build final groups
    const groups: PortfolioAssetGroup[] = []

    for (const [symbol, assets] of groupMap) {
      // Sort assets by value descending
      const sortedAssets = assets.toSorted((a, b) => (b.value ?? 0) - (a.value ?? 0))
      const primaryAsset = sortedAssets[0]

      groups.push({
        symbol,
        logoUrl: primaryAsset?.logoUrl ?? "",
        assets: sortedAssets,
      })
    }

    return groups.toSorted(compareAssetGroups)
  }, [minityBalances, chainNameToIdMap, chainIdToRegistryMap, denomLogoMap])

  // Compute filtered assets and total value in a single pass
  const { filteredAssets, filteredUnlistedAssets, totalAssetsValue } = useMemo(() => {
    // Filter asset groups
    const searchFilteredAssets = !searchQuery
      ? assetGroups
      : assetGroups.filter((assetGroup) => {
          const { symbol, assets } = assetGroup
          const query = searchQuery.toLowerCase()
          return (
            symbol.toLowerCase().includes(query) ||
            assets.some(({ denom }) => denom.toLowerCase().includes(query))
          )
        })

    const chainFilteredAssets = !selectedChain
      ? searchFilteredAssets
      : searchFilteredAssets
          .map((assetGroup) => ({
            ...assetGroup,
            assets: assetGroup.assets.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.assets.length > 0)

    // Filter unlisted assets
    const searchFilteredUnlisted = !searchQuery
      ? unlistedAssets
      : unlistedAssets.filter(
          ({ denom, address }) =>
            denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
            address?.toLowerCase().includes(searchQuery.toLowerCase()),
        )

    const chainFilteredUnlisted = !selectedChain
      ? searchFilteredUnlisted
      : searchFilteredUnlisted.filter(({ chain }) => chain.chainId === selectedChain)

    // Calculate total value
    const totalValue = chainFilteredAssets.reduce((total, group) => {
      return total + group.assets.reduce((sum, asset) => sum + (asset.value ?? 0), 0)
    }, 0)

    return {
      filteredAssets: chainFilteredAssets,
      filteredUnlistedAssets: chainFilteredUnlisted,
      totalAssetsValue: totalValue,
    }
  }, [assetGroups, unlistedAssets, searchQuery, selectedChain])

  const isLoading = isMinityLoading || isPortfolioLoading

  // Show skeleton loading on initial load when no data exists yet
  // This prevents flickering when refetching with existing data
  if (isLoading && assetGroups.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.title}>Assets</span>
        </div>
        <div className={styles.list}>
          <FallBack height={48} length={5} />
        </div>
      </div>
    )
  }

  const hasAssets = filteredAssets.length > 0 || filteredUnlistedAssets.length > 0

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Assets</span>
        {hasAssets && <span className={styles.totalValue}>{formatValue(totalAssetsValue)}</span>}
      </div>
      {hasAssets ? (
        <div>
          <div className={styles.list}>
            {filteredAssets.map((assetGroup) => (
              <AssetGroup assetGroup={assetGroup} key={assetGroup.symbol} />
            ))}
          </div>
          <UnlistedAssets unlistedAssets={filteredUnlistedAssets} />
        </div>
      ) : (
        <Status>No liquid assets</Status>
      )}
    </div>
  )
}

export default Assets
