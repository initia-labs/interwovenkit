import { useMemo } from "react"
import { useAtom } from "jotai"
import Status from "@/components/Status"
import { usePortfolio } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { portfolioChainAtom, portfolioSearchAtom } from "../state"
import AssetGroup from "./AssetGroup"
import UnlistedAssets from "./UnlistedAssets"
import styles from "./Assets.module.css"

const OnchainAssets = () => {
  const [searchQuery, setSearchQuery] = useAtom(portfolioSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(portfolioChainAtom)
  const { assetGroups, unlistedAssets, chainsByValue, totalValue, isLoading } = usePortfolio()
  const chainIds = chainsByValue.map(({ chainId }) => chainId)

  // Filter assets based on selected chain and search query
  const filteredAssets = useMemo(() => {
    const searchFiltered = !searchQuery
      ? assetGroups
      : assetGroups.filter((assetGroup) => {
          const { symbol, assets } = assetGroup
          return (
            symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
            assets.some(({ denom, address }) => {
              return (
                denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
                address?.toLowerCase().includes(searchQuery.toLowerCase())
              )
            })
          )
        })

    const chainFiltered = !selectedChain
      ? searchFiltered
      : searchFiltered
          .map((assetGroup) => ({
            ...assetGroup,
            assets: assetGroup.assets.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.assets.length > 0)

    return chainFiltered
  }, [assetGroups, searchQuery, selectedChain])

  // Filter unlisted assets based on selected chain and search query
  const filteredUnlistedAssets = useMemo(() => {
    const searchFiltered = !searchQuery
      ? unlistedAssets
      : unlistedAssets.filter(
          ({ denom, address }) =>
            denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
            address?.toLowerCase().includes(searchQuery.toLowerCase()),
        )

    const chainFiltered = !selectedChain
      ? searchFiltered
      : searchFiltered.filter(({ chain }) => chain.chainId === selectedChain)

    return chainFiltered
  }, [unlistedAssets, searchQuery, selectedChain])

  // Show loading only on initial load when no data exists yet
  // This prevents flickering when refetching with existing data
  if (isLoading && assetGroups.length === 0) {
    return <Status>Loading assets...</Status>
  }

  if (
    !filteredAssets.length &&
    !filteredUnlistedAssets.length &&
    !searchQuery &&
    !selectedChain &&
    !isLoading
  ) {
    return <Status>No assets</Status>
  }

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <HomeContainer.SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery("")}
          placeholder="Search assets"
        />
        <ChainSelect
          value={selectedChain}
          onChange={setSelectedChain}
          chainIds={chainIds}
          renderExtra={(chainId) => {
            // Show total value for "All" option (empty chainId)
            if (!chainId) return formatValue(totalValue)
            const chain = chainsByValue.find((c) => c.chainId === chainId)
            return chain ? formatValue(chain.value) : null
          }}
        />
      </HomeContainer.Controls>

      <div>
        {filteredAssets.length === 0 && filteredUnlistedAssets.length === 0 ? (
          <Status>No assets found</Status>
        ) : (
          <>
            <div className={styles.list}>
              {filteredAssets.map((assetGroup) => (
                <AssetGroup assetGroup={assetGroup} key={assetGroup.symbol} />
              ))}
            </div>
            <UnlistedAssets unlistedAssets={filteredUnlistedAssets} />
          </>
        )}
      </div>
    </HomeContainer.Root>
  )
}

export default OnchainAssets
