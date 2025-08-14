import { useMemo } from "react"
import { useAtom } from "jotai"
import Status from "@/components/Status"
import HomeContainer from "../../components/HomeContainer"
import ChainSelect from "../../components/ChainSelect"
import { nftsSearchAtom, nftsChainAtom } from "../state"
import { useAllNfts } from "./queries"
import NftItem from "./NftItem"
import WithNormalizedNft from "./WithNormalizedNft"
import styles from "./Nfts.module.css"

const Nfts = () => {
  const [searchQuery, setSearchQuery] = useAtom(nftsSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(nftsChainAtom)
  const { nftInfos, isLoading } = useAllNfts()

  // Filter NFTs based on chain selection and search query
  const filteredNfts = useMemo(() => {
    return nftInfos.filter(({ collection_addr, collection_name, nft, object_addr, chain }) => {
      // Check chain filter
      if (selectedChain && chain.chainId !== selectedChain) {
        return false
      }

      // Check search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
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
          placeholder="Search nfts"
        />
        <ChainSelect
          value={selectedChain}
          onChange={setSelectedChain}
          chainIds={relevantChainIds}
        />
      </HomeContainer.Controls>

      {filteredNfts.length === 0 ? (
        <Status>No NFTs found</Status>
      ) : (
        <div className={styles.grid}>
          {filteredNfts.map((nftInfo) => (
            <WithNormalizedNft nftInfo={nftInfo} key={nftInfo.object_addr}>
              {(normalizedNft) => <NftItem {...normalizedNft} />}
            </WithNormalizedNft>
          ))}
        </div>
      )}
    </HomeContainer.Root>
  )
}

export default Nfts
