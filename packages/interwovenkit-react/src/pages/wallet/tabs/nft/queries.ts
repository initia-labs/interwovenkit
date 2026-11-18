import ky from "ky"
import { prop } from "ramda"
import { useQueries, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { type NormalizedChain, useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { fetchAllPages } from "@/data/pagination"
import { isFiniteNumber, isRecord, isString } from "@/pages/deposit/data/parse"
import { useInitiaAddress } from "@/public/data/hooks"

export const nftQueryKeys = createQueryKeys("interwovenkit:nft", {
  nfts: (indexerUrl: string, address: string) => [indexerUrl, address],
  metadata: (url?: string) => [url],
})

interface NftResponse {
  collection_addr: string
  collection_name: string
  nft: { token_id: string; uri: string; description: string }
  object_addr: string
}

interface NftAttribute {
  trait_type: string
  value: string | number
}

interface NftMetadata {
  name?: string
  image?: string
  description?: string
  attributes?: NftAttribute[]
}

function parseNftAttribute(item: unknown): NftAttribute[] {
  if (!isRecord(item)) return []
  const { trait_type, value } = item
  if (!isString(trait_type)) return []
  if (!isString(value) && !isFiniteNumber(value)) return []
  return [{ trait_type, value }]
}

// NFT metadata is written by whoever minted the NFT. Only these display fields are read from it,
// each dropped on its own when malformed, so it can neither replace on-chain values such as the
// chain or the collection address nor break rendering.
export function parseNftMetadata(data: unknown): NftMetadata {
  if (!isRecord(data)) return {}
  const { name, image, description, attributes } = data
  return {
    name: isString(name) ? name : undefined,
    image: isString(image) ? convertIPFS(image) : undefined,
    description: isString(description) ? description : undefined,
    attributes: Array.isArray(attributes) ? attributes.flatMap(parseNftAttribute) : undefined,
  }
}

export function normalizeNft(nftInfo: NftInfo, nftMetadata: NftMetadata) {
  const { nft } = nftInfo
  const { image, attributes } = nftMetadata
  const name = nftMetadata.name ?? nft.token_id
  const description = nftMetadata.description ?? nft.description
  return { ...nftInfo, ...nft, name, description, image, attributes }
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

  // Calculate NFT count per chain
  const chainCounts = nftInfos.reduce<Record<string, number>>(
    (acc, { chain }) => ({ ...acc, [chain.chainId]: (acc[chain.chainId] || 0) + 1 }),
    {},
  )

  const totalCount = Object.values(chainCounts).reduce((sum, count) => sum + count, 0)

  // Aggregate loading state - true if any chain is still loading
  const isLoading = queries.some((query) => query.isLoading)

  return { nftInfos, chainCounts, totalCount, isLoading }
}

// The URI is also written by the minter. Requiring https rules out data: URIs that inline a
// payload, relative paths on the dApp's own origin, and plain-http hosts on the local network.
export function parseNftMetadataUrl(uri?: string) {
  const url = convertIPFS(uri)
  if (!url || !URL.canParse(url)) return undefined
  return new URL(url).protocol === "https:" ? url : undefined
}

export function useNftMetataQuery(uri?: string) {
  const queryUrl = parseNftMetadataUrl(uri)
  return useQuery({
    queryKey: nftQueryKeys.metadata(queryUrl).queryKey,
    queryFn: async (): Promise<NftMetadata> => {
      try {
        if (!queryUrl) return {}
        // Without credentials, a URI pointing at the dApp's own origin is fetched without cookies.
        return parseNftMetadata(await ky.get(queryUrl, { credentials: "omit" }).json())
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
