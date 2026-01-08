import { useMemo } from "react"
import type { PortfolioAssetItem } from "@/data/portfolio"
import UnlistedAssets from "./UnlistedAssets"

interface UnlistedAssetsSectionProps {
  searchQuery: string
  selectedChain: string
  unlistedAssets: PortfolioAssetItem[]
}

const UnlistedAssetsSection = ({
  searchQuery,
  selectedChain,
  unlistedAssets,
}: UnlistedAssetsSectionProps) => {
  // Filter unlisted assets by search query and selected chain
  const filteredUnlistedAssets = useMemo(() => {
    const searchFilteredUnlisted = !searchQuery
      ? unlistedAssets
      : unlistedAssets.filter(
          ({ denom, address }) =>
            denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
            address?.toLowerCase().includes(searchQuery.toLowerCase()),
        )

    return !selectedChain
      ? searchFilteredUnlisted
      : searchFilteredUnlisted.filter(({ chain }) => chain.chainId === selectedChain)
  }, [unlistedAssets, searchQuery, selectedChain])

  return <UnlistedAssets unlistedAssets={filteredUnlistedAssets} />
}

export default UnlistedAssetsSection
