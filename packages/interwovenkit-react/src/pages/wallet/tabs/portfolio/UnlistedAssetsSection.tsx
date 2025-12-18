import { useMemo } from "react"
import { usePortfolio } from "@/data/portfolio"
import UnlistedAssets from "./UnlistedAssets"

interface UnlistedAssetsSectionProps {
  searchQuery: string
  selectedChain: string
}

const UnlistedAssetsSection = ({ searchQuery, selectedChain }: UnlistedAssetsSectionProps) => {
  const { unlistedAssets } = usePortfolio()

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
