import ky from "ky"
import { prop } from "ramda"
import { useQuery, useQueries } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import { fetchAllPages } from "@/data/pagination"
import { useInitiaRegistry, type NormalizedChain } from "@/data/chains"

const nftQueryKeys = createQueryKeys("interwovenkit:nft", {
  nfts: (indexerUrl: string, address: string) => [indexerUrl, address],
  metadata: (url?: string) => [url],
})

interface NftResponse {
  collection_addr: string
  collection_name: string
  nft: { token_id: string; uri: string; description: string }
  object_addr: string
}

interface NftMetadata {
  name?: string
  image?: string
  description?: string
  attributes?: { trait_type: string; value: string }[]
}

export function normalizeNft(nftInfo: NftInfo, nftMetadata: NftMetadata) {
  const { nft } = nftInfo
  const name = nftMetadata.name ?? nft.token_id
  return { ...nftInfo, ...nft, ...nftMetadata, name }
}

export type NormalizedNft = ReturnType<typeof normalizeNft>

export interface NftInfo extends NftResponse {
  chain: NormalizedChain
}

/**
 * Aggregates NFT data from multiple chains
 */
export function aggregateNfts(
  chains: NormalizedChain[],
  nftResults: (NftResponse[] | undefined)[],
): NftInfo[] {
  // Combine all NFT data from different chains
  return chains.flatMap((chain, index) => {
    const nfts = nftResults[index] ?? []
    return nfts.map((nft) => ({ ...nft, chain }))
  })
}

// Hook to fetch and aggregate NFT data from all chains
export const useAllNfts = () => {
  const address = useInitiaAddress()
  const chains = useInitiaRegistry()

  // Fetch NFTs from all chains in parallel
  const queries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: nftQueryKeys.nfts(chain.indexerUrl, address).queryKey,
      queryFn: () =>
        fetchAllPages<"tokens", NftResponse>(
          `indexer/nft/v1/tokens/by_account/${address}`,
          { prefixUrl: chain.indexerUrl },
          "tokens",
        ),
      staleTime: STALE_TIMES.SECOND,
    })),
  })

  const results = queries.map(prop("data"))
  const nftInfos = aggregateNfts(chains, results)

  // Aggregate loading state - true if any chain is still loading
  const isLoading = queries.some((query) => query.isLoading)

  return { nftInfos, isLoading }
}

export function useNftMetataQuery(url?: string) {
  const queryUrl = convertIPFS(url)
  return useQuery({
    queryKey: nftQueryKeys.metadata(queryUrl).queryKey,
    queryFn: async (): Promise<NftMetadata> => {
      try {
        if (!queryUrl) return {}
        const metadata = await ky.get(queryUrl).json<NftMetadata>()
        return { ...metadata, image: convertIPFS(metadata.image) }
      } catch {
        return {}
      }
    },
    staleTime: STALE_TIMES.INFINITY,
  })
}

function convertIPFS(url?: string) {
  return url?.replace("ipfs://", "https://ipfs.io/ipfs/")
}
