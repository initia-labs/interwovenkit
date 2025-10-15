import { useMemo } from "react"
import { useAtom } from "jotai"
import Status from "@/components/Status"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { nftsChainAtom, nftsSearchAtom } from "../state"
import NftItem from "./NftItem"
import { useAllNfts } from "./queries"
import WithNormalizedNft from "./WithNormalizedNft"
import styles from "./Nfts.module.css"

const Nfts = () => {
  const [searchQuery, setSearchQuery] = useAtom(nftsSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(nftsChainAtom)
  const { nftInfos, chainCounts, totalCount, isLoading } = useAllNfts()

  // Filter NFTs based on chain selection and search query
  const filteredNfts = useMemo(() => {
    return nftInfos.filter(({ collection_addr, collection_name, nft, object_addr, chain }) => {
      // Check chain filter
      if (selectedChain && chain.chainId !== selectedChain) {
        return false
      }

      // Check search query
      if (searchQuery) {
        const query = searchQuery.trim().toLowerCase()
        return (
          collection_addr.toLowerCase().includes(query) ||
          collection_name.toLowerCase().includes(query) ||
          nft.token_id.toLowerCase().includes(query) ||
          object_addr.toLowerCase().includes(query)
        )
      }

      return true
    })
  }, [nftInfos, selectedChain, searchQuery])

  // Get chains that have NFTs
  const relevantChainIds = useMemo(() => {
    return Array.from(new Set(nftInfos.map(({ chain }) => chain.chainId)))
  }, [nftInfos])

  if (isLoading && nftInfos.length === 0) {
    return <Status>Loading NFTs...</Status>
  }

  if (!nftInfos.length && !searchQuery && !isLoading) {
    return <Status>No NFTs</Status>
  }

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <HomeContainer.SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery("")}
          placeholder="Search NFTs"
        />
        <ChainSelect
          value={selectedChain}
          onChange={setSelectedChain}
          chainIds={relevantChainIds}
          renderExtra={(chainId) => {
            // Show total count for "All" option (empty chainId)
            if (!chainId) return totalCount
            return chainCounts[chainId] || 0
          }}
        />
      </HomeContainer.Controls>

      {filteredNfts.length === 0 ? (
        <Status>No NFTs found</Status>
      ) : (
        <div className={styles.grid}>
          {filteredNfts.map((nftInfo) => {
            const { collection_addr, nft } = nftInfo
            return (
              <WithNormalizedNft nftInfo={nftInfo} key={collection_addr + nft.token_id}>
                {(normalizedNft) => <NftItem normalizedNft={normalizedNft} />}
              </WithNormalizedNft>
            )
          })}
        </div>
      )}
    </HomeContainer.Root>
  )
}

export default Nfts
