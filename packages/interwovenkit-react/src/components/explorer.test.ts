import { describe, it, expect } from "vitest"
import type { NormalizedChain } from "@/data/chains"
import { buildExplorerUrl, isValidTxHash } from "./explorer"

describe("isValidTxHash", () => {
  describe("valid transaction hashes", () => {
    it("should accept valid Cosmos transaction hash (64 hex chars)", () => {
      expect(
        isValidTxHash("ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD"),
      ).toBe(true)
      expect(
        isValidTxHash("1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF"),
      ).toBe(true)
    })

    it("should accept lowercase Cosmos transaction hash", () => {
      expect(
        isValidTxHash("abc123def456789abc123def456789abc123def456789abc123def456789abcd"),
      ).toBe(true)
    })
  })

  describe("invalid transaction hashes", () => {
    it("should reject too short hashes", () => {
      expect(isValidTxHash("ABC123")).toBe(false)
      expect(isValidTxHash("0x123456")).toBe(false)
    })

    it("should reject too long hashes", () => {
      expect(
        isValidTxHash("ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCDE"),
      ).toBe(false)
      expect(
        isValidTxHash("0x543b35a39cfadad3da3c23249c474455d15efd2f94f849473226dee8a3c7a9e11"),
      ).toBe(false)
    })

    it("should reject non-hex characters", () => {
      expect(isValidTxHash("TX_WITH-SPECIAL.CHARS")).toBe(false)
      expect(isValidTxHash("GHIJKLMNOPQRSTUVWXYZ123456789012345678901234567890123456789012")).toBe(
        false,
      )
    })

    it("should reject empty or invalid formats", () => {
      expect(isValidTxHash("")).toBe(false)
      expect(isValidTxHash("0x")).toBe(false)
      expect(isValidTxHash("not-a-hash")).toBe(false)
    })

    it("should reject Ethereum-style hashes", () => {
      expect(
        isValidTxHash("0x543b35a39cfadad3da3c23249c474455d15efd2f94f849473226dee8a3c7a9e1"),
      ).toBe(false)
    })
  })
})

describe("buildExplorerUrl", () => {
  const mockChain = {
    explorers: [
      {
        tx_page: "https://scan.initia.xyz/interwoven-1/txs/${txHash}",
        account_page: "https://scan.initia.xyz/interwoven-1/accounts/${accountAddress}",
      },
    ],
  } as Pick<NormalizedChain, "explorers">

  describe("with txHash", () => {
    it("should build transaction URL with valid Cosmos hash", () => {
      const result = buildExplorerUrl(mockChain, {
        txHash: "ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/txs/ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD",
      )
    })

    it("should return undefined for invalid transaction hash", () => {
      const result = buildExplorerUrl(mockChain, {
        txHash: "invalid-tx-hash",
      })

      expect(result).toBeUndefined()
    })

    it("should ignore pathSuffix when txHash is provided", () => {
      const result = buildExplorerUrl(mockChain, {
        txHash: "ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD",
        pathSuffix: "/ignored",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/txs/ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD",
      )
    })
  })

  describe("with accountAddress", () => {
    it("should build account URL with valid Cosmos address", () => {
      const result = buildExplorerUrl(mockChain, {
        accountAddress: "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/accounts/init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs",
      )
    })

    it("should build account URL with valid Ethereum address", () => {
      const result = buildExplorerUrl(mockChain, {
        accountAddress: "0x77d96ae5e7885B19b5Bf4e680E129ACe8fD58fB1",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/accounts/0x77d96ae5e7885B19b5Bf4e680E129ACe8fD58fB1",
      )
    })

    it("should append pathSuffix to account URL", () => {
      const result = buildExplorerUrl(mockChain, {
        accountAddress: "init1prdwrp2kwss8lg854u08vya6uw8t9mldsqchdv",
        pathSuffix: "/txs",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/accounts/init1prdwrp2kwss8lg854u08vya6uw8t9mldsqchdv/txs",
      )
    })

    it("should return undefined for invalid address", () => {
      const result = buildExplorerUrl(mockChain, {
        accountAddress: "invalid-address",
      })

      expect(result).toBeUndefined()
    })
  })

  describe("with missing explorer config", () => {
    const chainWithoutExplorer = { explorers: [] } as Pick<NormalizedChain, "explorers">

    it("should return undefined for txHash", () => {
      const result = buildExplorerUrl(chainWithoutExplorer, {
        txHash: "ABC123DEF456789ABC123DEF456789ABC123DEF456789ABC123DEF456789ABCD",
      })

      expect(result).toBeUndefined()
    })

    it("should return undefined for accountAddress", () => {
      const result = buildExplorerUrl(chainWithoutExplorer, {
        accountAddress: "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs",
      })

      expect(result).toBeUndefined()
    })
  })

  describe("with neither txHash nor accountAddress", () => {
    it("should return undefined", () => {
      const result = buildExplorerUrl(mockChain, {})

      expect(result).toBeUndefined()
    })
  })

  describe("with special characters", () => {
    it("should handle special characters in pathSuffix", () => {
      const result = buildExplorerUrl(mockChain, {
        accountAddress: "init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d",
        pathSuffix: "/txs?page=2&limit=50",
      })

      expect(result).toBe(
        "https://scan.initia.xyz/interwoven-1/accounts/init1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqr5e3d/txs?page=2&limit=50",
      )
    })
  })
})
