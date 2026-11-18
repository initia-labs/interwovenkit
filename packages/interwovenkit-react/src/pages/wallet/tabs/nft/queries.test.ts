import { describe, expect, it } from "vitest"
import type { NormalizedChain } from "@/data/chains"
import { aggregateNfts, normalizeNft, parseNftMetadata, parseNftMetadataUrl } from "./queries"

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

describe("parseNftMetadata", () => {
  it("keeps only the display fields", () => {
    const metadata = parseNftMetadata({
      name: "Fake",
      image: "https://example.com/image.png",
      description: "Description",
      attributes: [{ trait_type: "Color", value: "Red" }],
      chain: null,
      collection_addr: "0xattacker",
      collection_name: "Attacker",
      object_addr: "0xattacker",
      token_id: "999",
      uri: "https://example.com/other.json",
      nft: null,
    })

    expect(metadata).toEqual({
      name: "Fake",
      image: "https://example.com/image.png",
      description: "Description",
      attributes: [{ trait_type: "Color", value: "Red" }],
    })
  })

  it("drops a field of the wrong type without dropping the others", () => {
    const metadata = parseNftMetadata({
      name: { toString: "x" },
      image: 1,
      description: "Description",
      attributes: "none",
    })

    expect(metadata).toEqual({ description: "Description" })
  })

  it("drops attributes that cannot be rendered", () => {
    const metadata = parseNftMetadata({
      attributes: [
        { trait_type: "Level", value: 3 },
        null,
        { trait_type: "Nested", value: { a: 1 } },
        { value: "No trait type" },
        { trait_type: "Color", value: "Red" },
      ],
    })

    expect(metadata).toEqual({
      attributes: [
        { trait_type: "Level", value: 3 },
        { trait_type: "Color", value: "Red" },
      ],
    })
  })

  it("converts an IPFS image to a gateway URL", () => {
    expect(parseNftMetadata({ image: "ipfs://cid/1.png" })).toEqual({
      image: "https://ipfs.io/ipfs/cid/1.png",
    })
  })

  it.each([null, "text", 1, []])("returns empty metadata for %j", (data) => {
    expect(parseNftMetadata(data)).toEqual({})
  })
})

describe("parseNftMetadataUrl", () => {
  it("accepts an https URL", () => {
    expect(parseNftMetadataUrl("https://example.com/1.json")).toBe("https://example.com/1.json")
  })

  it("converts an IPFS URI to a gateway URL", () => {
    expect(parseNftMetadataUrl("ipfs://cid/1.json")).toBe("https://ipfs.io/ipfs/cid/1.json")
  })

  it.each([
    "http://192.168.0.1/admin",
    "http://localhost:3000/api",
    'data:application/json,{"chain":null}',
    "javascript:alert(1)",
    "/api/logout",
    "",
    undefined,
  ])("rejects %j", (uri) => {
    expect(parseNftMetadataUrl(uri)).toBeUndefined()
  })
})

describe("normalizeNft", () => {
  const chain = { chainId: "chain-1", name: "Chain 1" } as unknown as NormalizedChain

  const nftInfo = {
    collection_addr: "0xcollection",
    collection_name: "Collection",
    nft: { token_id: "1", uri: "https://initia.xyz/1", description: "On-chain description" },
    object_addr: "0xobject",
    chain,
  }

  it("falls back to on-chain values without metadata", () => {
    expect(normalizeNft(nftInfo, {})).toEqual({
      ...nftInfo,
      token_id: "1",
      uri: "https://initia.xyz/1",
      name: "1",
      description: "On-chain description",
      image: undefined,
      attributes: undefined,
    })
  })

  it("uses the metadata display fields", () => {
    const attributes = [{ trait_type: "Color", value: "Red" }]
    const nft = normalizeNft(nftInfo, {
      name: "Name",
      image: "https://example.com/image.png",
      description: "Metadata description",
      attributes,
    })

    expect(nft.name).toBe("Name")
    expect(nft.image).toBe("https://example.com/image.png")
    expect(nft.description).toBe("Metadata description")
    expect(nft.attributes).toEqual(attributes)
  })

  it("never takes the NFT identity from metadata", () => {
    const metadata = {
      chain: null,
      collection_addr: "0xvictim",
      collection_name: "Victim",
      object_addr: "0xvictim",
      token_id: "999",
      uri: "https://example.com/other.json",
      nft: null,
    }

    // The metadata type forbids these keys. Cast to cover a caller that skips parsing.
    const nft = normalizeNft(nftInfo, metadata as never)

    expect(nft.chain).toBe(chain)
    expect(nft.collection_addr).toBe("0xcollection")
    expect(nft.collection_name).toBe("Collection")
    expect(nft.object_addr).toBe("0xobject")
    expect(nft.token_id).toBe("1")
    expect(nft.uri).toBe("https://initia.xyz/1")
    expect(nft.nft).toBe(nftInfo.nft)
  })
})
