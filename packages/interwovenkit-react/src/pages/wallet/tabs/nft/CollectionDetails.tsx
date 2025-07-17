import { useLocationState, useNavigate } from "@/lib/router"
import type { NormalizedChain } from "@/data/chains"
import { parsePaginatedResponse } from "@/data/pagination"
import Page from "@/components/Page"
import LoadMoreButton from "@/components/LoadMoreButton"
import type { NormalizedCollection } from "./queries"
import { useNfts } from "./queries"
import WithNormalizedNft from "./WithNormalizedNft"
import NftThumbnail from "./NftThumbnail"
import styles from "./CollectionDetails.module.css"

const CollectionDetails = () => {
  const navigate = useNavigate()
  const { collection, chain } = useLocationState<{
    collection: NormalizedCollection
    chain: NormalizedChain
  }>("/collection")

  const { data, hasNextPage, isFetching, fetchNextPage } = useNfts({ chain, collection })
  const { list } = parsePaginatedResponse("tokens", data)

  return (
    <Page title={collection.name}>
      <div className={styles.grid}>
        {list.map((item) => (
          <WithNormalizedNft nftResponse={item} key={item.object_addr}>
            {(nft) => (
              <div className={styles.item}>
                <NftThumbnail
                  chain={chain}
                  collection={collection}
                  nft={nft}
                  onClick={() => navigate("/nft", { collection, nft, chain })}
                />
                <div className={styles.name}>{nft.name}</div>
              </div>
            )}
          </WithNormalizedNft>
        ))}
      </div>

      {hasNextPage && <LoadMoreButton onClick={() => fetchNextPage()} disabled={isFetching} />}
    </Page>
  )
}

export default CollectionDetails
