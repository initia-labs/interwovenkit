import { describe, expect, it } from "vitest"
import type { NormalizedChain } from "@/data/chains"
import { aggregateNfts } from "./queries"

describe("aggregateNfts", () => {
  const mockChain1 = {
    chainId: "chain-1",
    name: "Chain 1",
  } as unknown as NormalizedChain

  const mockChain2 = {
    chainId: "chain-2",
    name: "Chain 2",
  } as unknown as NormalizedChain

  const createMockNft = (collectionName: string, tokenId: string, collectionAddr = "0x123") => ({
    collection_addr: collectionAddr,
    collection_name: collectionName,
    nft: {
      token_id: tokenId,
      uri: `https://initia.xyz/${tokenId}`,
      description: `NFT ${tokenId}`,
    },
    object_addr: `0xobj${tokenId}`,
  })

  it("should combine NFTs from multiple chains", () => {
    const nft1 = createMockNft("Collection B", "3")
    const nft2 = createMockNft("Collection A", "1")
    const nft3 = createMockNft("Collection A", "2")
    const nft4 = createMockNft("Collection B", "1")

    const chains = [mockChain1, mockChain2]
    const nftResults = [
      [nft1, nft2],
      [nft3, nft4],
    ]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(4)
    // Verify all NFTs are present
    const collectionNames = result.map((r) => r.collection_name)
    expect(collectionNames).toContain("Collection A")
    expect(collectionNames).toContain("Collection B")

    // Verify chain information is attached
    const chain1Nfts = result.filter((r) => r.chain === mockChain1)
    const chain2Nfts = result.filter((r) => r.chain === mockChain2)
    expect(chain1Nfts).toHaveLength(2)
    expect(chain2Nfts).toHaveLength(2)
  })

  it("should handle undefined NFT results", () => {
    const nft1 = createMockNft("Collection A", "1")

    const chains = [mockChain1, mockChain2]
    const nftResults = [[nft1], undefined]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(1)
    expect(result[0].collection_name).toBe("Collection A")
    expect(result[0].nft.token_id).toBe("1")
    expect(result[0].chain).toBe(mockChain1)
  })

  it("should handle empty NFT arrays", () => {
    const chains = [mockChain1, mockChain2]
    const nftResults = [[], []]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(0)
  })

  it("should handle mixed empty and populated results", () => {
    const nft1 = createMockNft("Collection A", "1")
    const nft2 = createMockNft("Collection B", "2")

    const chains = [mockChain1, mockChain2]
    const nftResults = [[], [nft1, nft2]]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(2)
    const collectionNames = result.map((r) => r.collection_name)
    expect(collectionNames).toContain("Collection A")
    expect(collectionNames).toContain("Collection B")
    expect(result.every((r) => r.chain === mockChain2)).toBe(true)
  })

  it("should handle multiple NFTs from same collection", () => {
    const nft1 = createMockNft("Collection A", "10")
    const nft2 = createMockNft("Collection A", "2")
    const nft3 = createMockNft("Collection A", "1")
    const nft4 = createMockNft("Collection A", "20")

    const chains = [mockChain1]
    const nftResults = [[nft1, nft2, nft3, nft4]]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(4)
    expect(result.every((r) => r.collection_name === "Collection A")).toBe(true)
    const tokenIds = result.map((r) => r.nft.token_id)
    expect(tokenIds).toContain("1")
    expect(tokenIds).toContain("2")
    expect(tokenIds).toContain("10")
    expect(tokenIds).toContain("20")
  })

  it("should handle NFTs from same collection across different chains", () => {
    const nft1 = createMockNft("Collection A", "1")
    const nft2 = createMockNft("Collection A", "1") // Same token ID, different chain

    const chains = [mockChain1, mockChain2]
    const nftResults = [[nft1], [nft2]]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(2)
    expect(result[0].chain).toBe(mockChain1)
    expect(result[1].chain).toBe(mockChain2)
    expect(result.every((r) => r.collection_name === "Collection A")).toBe(true)
  })

  it("should correctly handle single chain with multiple NFTs", () => {
    const nft1 = createMockNft("Collection C", "1")
    const nft2 = createMockNft("Collection A", "3")
    const nft3 = createMockNft("Collection B", "2")

    const chains = [mockChain1]
    const nftResults = [[nft1, nft2, nft3]]

    const result = aggregateNfts(chains, nftResults)

    expect(result).toHaveLength(3)
    const collectionNames = result.map((r) => r.collection_name)
    expect(collectionNames).toContain("Collection A")
    expect(collectionNames).toContain("Collection B")
    expect(collectionNames).toContain("Collection C")
    expect(result.every((r) => r.chain === mockChain1)).toBe(true)
  })
})
