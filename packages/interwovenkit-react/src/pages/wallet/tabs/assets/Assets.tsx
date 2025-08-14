import { useMemo } from "react"
import { useAtom } from "jotai"
import { usePortfolio } from "@/data/portfolio"
import Status from "@/components/Status"
import HomeContainer from "../../components/HomeContainer"
import ChainSelect from "../../components/ChainSelect"
import Version from "../../components/Version"
import { assetsSearchAtom, assetsChainAtom } from "../state"
import AssetGroup from "./AssetGroup"
import UnsupportedAssets from "./UnsupportedAssets"
import styles from "./Assets.module.css"

const Assets = () => {
  const [searchQuery, setSearchQuery] = useAtom(assetsSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(assetsChainAtom)
  const { assetGroups, unsupportedAssetGroups, chainPortfolios, isLoading } = usePortfolio()
  const chainIds = chainPortfolios.map((c) => c.chain.chainId)

  // Filter assets based on selected chain and search query
  const filteredAssets = useMemo(() => {
    const searchFiltered = searchQuery
      ? assetGroups.filter((assetGroup) => {
          const { denom, symbol, name, address } = assetGroup.asset
          return (
            denom.toLowerCase().includes(searchQuery.toLowerCase()) ||
            symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
            name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            address?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        })
      : assetGroups

    const chainFiltered = selectedChain
      ? searchFiltered
          .map((assetGroup) => ({
            ...assetGroup,
            chains: assetGroup.chains.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.chains.length > 0)
      : searchFiltered

    return chainFiltered
  }, [assetGroups, searchQuery, selectedChain])

  // Filter unsupported assets based on selected chain and search query
  const filteredUnsupportedAssets = useMemo(() => {
    const searchFiltered = searchQuery
      ? unsupportedAssetGroups.filter((assetGroup) => {
          const { denom } = assetGroup.asset
          return denom.toLowerCase().includes(searchQuery.toLowerCase())
        })
      : unsupportedAssetGroups

    const chainFiltered = selectedChain
      ? searchFiltered
          .map((assetGroup) => ({
            ...assetGroup,
            chains: assetGroup.chains.filter(({ chain }) => chain.chainId === selectedChain),
          }))
          .filter((assetGroup) => assetGroup.chains.length > 0)
      : searchFiltered

    return chainFiltered
  }, [unsupportedAssetGroups, searchQuery, selectedChain])

  // Show loading only on initial load when no data exists yet
  // This prevents flickering when refetching with existing data
  if (isLoading && assetGroups.length === 0) {
    return <Status>Loading assets...</Status>
  }

  if (
    !filteredAssets.length &&
    !filteredUnsupportedAssets.length &&
    !searchQuery &&
    !selectedChain &&
    !isLoading
  ) {
    return <Status>No assets</Status>
  }

  return (
    <>
      <HomeContainer.Root>
        <HomeContainer.Controls>
          <HomeContainer.SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search assets"
          />
          <ChainSelect value={selectedChain} onChange={setSelectedChain} chainIds={chainIds} />
        </HomeContainer.Controls>

        <div>
          {filteredAssets.length === 0 && filteredUnsupportedAssets.length === 0 ? (
            <Status>No assets found</Status>
          ) : (
            <>
              <div className={styles.list}>
                {filteredAssets.map((assetGroup) => (
                  <AssetGroup assetGroup={assetGroup} key={assetGroup.asset.symbol} />
                ))}
              </div>
              <UnsupportedAssets unsupportedAssets={filteredUnsupportedAssets} />
            </>
          )}
        </div>
      </HomeContainer.Root>

      <Version />
    </>
  )
}

export default Assets
