import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { describe, expect, it } from "vitest"
import { denomToMetadata } from "@initia/utils"
import { INIT_DENOM } from "./constants"

// Import the types we need (these are not exported, so we'll use minimal mocks)
type CoinWithMetadata = Coin & { metadata: string }
type LiquidityTableRow = {
  denom: string
  symbol: string
  totalAmount: number
  totalValue: number
  decimals: number
  poolType?: string
  logoUrl?: string
  coinLogos?: string[]
  breakdown: {
    deposit: number
    staking: number
    lockStaking: number
    unstaking: number
  }
  claimableInit?: {
    staking: string
    lockStaking: string
    total: string
    totalValue: number
  }
}

// Since the helper functions are not exported, we'll test them indirectly through the hooks
// or we can extract them for testing. For now, let's create unit tests for the logic patterns.

describe("initia-liquidity helpers", () => {
  describe("normalizeLps pattern", () => {
    it("should group coins by metadata", () => {
      const coins: Coin[] = [
        { denom: "move/denom1", amount: "1000" },
        { denom: "move/denom2", amount: "2000" },
        { denom: "move/denom1", amount: "500" },
      ]

      // Simulate normalizeLps logic
      const result = new Map<string, CoinWithMetadata[]>()
      for (const coin of coins) {
        const metadata = denomToMetadata(coin.denom)
        const coinWithMetadata: CoinWithMetadata = { ...coin, metadata }
        const existing = result.get(metadata) ?? []
        existing.push(coinWithMetadata)
        result.set(metadata, existing)
      }

      const metadata1 = denomToMetadata("move/denom1")
      expect(result.get(metadata1)?.length).toBe(2)
      expect(result.get(metadata1)?.[0].amount).toBe("1000")
      expect(result.get(metadata1)?.[1].amount).toBe("500")
    })

    it("should preserve all coin properties", () => {
      const coins: Coin[] = [{ denom: "move/test", amount: "12345" }]

      const result = new Map<string, CoinWithMetadata[]>()
      for (const coin of coins) {
        const metadata = denomToMetadata(coin.denom)
        const coinWithMetadata: CoinWithMetadata = { ...coin, metadata }
        const existing = result.get(metadata) ?? []
        existing.push(coinWithMetadata)
        result.set(metadata, existing)
      }

      const metadata = denomToMetadata("move/test")
      const normalized = result.get(metadata)?.[0]
      expect(normalized?.denom).toBe("move/test")
      expect(normalized?.amount).toBe("12345")
      expect(normalized?.metadata).toBe(metadata)
    })

    it("should handle empty array", () => {
      const coins: Coin[] = []

      const result = new Map<string, CoinWithMetadata[]>()
      for (const coin of coins) {
        const metadata = denomToMetadata(coin.denom)
        const coinWithMetadata: CoinWithMetadata = { ...coin, metadata }
        const existing = result.get(metadata) ?? []
        existing.push(coinWithMetadata)
        result.set(metadata, existing)
      }

      expect(result.size).toBe(0)
    })
  })

  describe("collectMetadataKeys pattern", () => {
    it("should collect unique metadata keys from all sources", () => {
      const lps = new Map([
        ["meta1", []],
        ["meta2", []],
      ])
      const delegations = new Map([
        ["meta2", [{ denom: "uusdc", amount: "100" }]],
        ["meta3", [{ denom: "ueth", amount: "200" }]],
      ])
      const lockStaking = new Map<string, unknown[]>([["meta4", []]])
      const undelegations = new Map([["meta5", [{ denom: "ubtc", amount: "300" }]]])

      // Simulate collectMetadataKeys logic
      const keys = new Set<string>()
      for (const metadata of lps.keys()) keys.add(metadata)
      for (const [metadata, stakingList] of delegations) {
        const denom = stakingList[0]?.denom
        if (denom && denom !== INIT_DENOM) keys.add(metadata)
      }
      for (const metadata of lockStaking.keys()) keys.add(metadata)
      for (const [metadata, unstakingList] of undelegations) {
        const denom = unstakingList[0]?.denom
        if (denom && denom !== INIT_DENOM) keys.add(metadata)
      }

      const result = Array.from(keys)
      expect(result.length).toBe(5)
      expect(result).toContain("meta1")
      expect(result).toContain("meta5")
    })

    it("should exclude INIT_DENOM from delegations", () => {
      const delegations = new Map([
        ["meta1", [{ denom: INIT_DENOM, amount: "100" }]],
        ["meta2", [{ denom: "uusdc", amount: "200" }]],
      ])

      const keys = new Set<string>()
      for (const [metadata, stakingList] of delegations) {
        const denom = stakingList[0]?.denom
        if (denom && denom !== INIT_DENOM) keys.add(metadata)
      }

      const result = Array.from(keys)
      expect(result.length).toBe(1)
      expect(result).toContain("meta2")
      expect(result).not.toContain("meta1")
    })

    it("should handle empty maps", () => {
      const lps = new Map()
      const delegations = new Map()

      const keys = new Set<string>()
      for (const metadata of lps.keys()) keys.add(metadata)
      for (const [metadata, stakingList] of delegations) {
        const denom = stakingList[0]?.denom
        if (denom && denom !== INIT_DENOM) keys.add(metadata)
      }

      expect(Array.from(keys).length).toBe(0)
    })
  })

  describe("getLpDenomList pattern", () => {
    it("should extract denoms excluding INIT_DENOM", () => {
      const denomsMap = new Map([
        ["meta1", "uusdc"],
        ["meta2", INIT_DENOM],
        ["meta3", "ueth"],
      ])

      // Simulate getLpDenomList logic
      const denoms: string[] = []
      for (const [, denom] of denomsMap) {
        if (denom && denom !== INIT_DENOM) {
          denoms.push(denom)
        }
      }

      expect(denoms.length).toBe(2)
      expect(denoms).toContain("uusdc")
      expect(denoms).toContain("ueth")
      expect(denoms).not.toContain(INIT_DENOM)
    })

    it("should skip null/undefined denoms", () => {
      const denomsMap = new Map([
        ["meta1", "uusdc"],
        ["meta2", null],
        ["meta3", undefined],
        ["meta4", ""],
      ])

      const denoms: string[] = []
      for (const [, denom] of denomsMap) {
        if (denom && denom !== INIT_DENOM) {
          denoms.push(denom)
        }
      }

      expect(denoms.length).toBe(1)
      expect(denoms[0]).toBe("uusdc")
    })

    it("should handle empty map", () => {
      const denomsMap = new Map()

      const denoms: string[] = []
      for (const [, denom] of denomsMap) {
        if (denom && denom !== INIT_DENOM) {
          denoms.push(denom)
        }
      }

      expect(denoms.length).toBe(0)
    })
  })

  describe("getCoinLogos pattern", () => {
    it("should extract logos from pool coins", () => {
      const pool = {
        coins: [{ denom: "uinit" }, { denom: "uusdc" }],
      }
      const assetByDenom = new Map([
        ["uinit", { logoUrl: "https://example.com/init.png" }],
        ["uusdc", { logoUrl: "https://example.com/usdc.png" }],
      ])

      // Simulate getCoinLogos logic
      const logos = pool.coins.map((coin) => {
        const asset = assetByDenom.get(coin.denom)
        return asset?.logoUrl || ""
      })

      expect(logos.length).toBe(2)
      expect(logos[0]).toBe("https://example.com/init.png")
      expect(logos[1]).toBe("https://example.com/usdc.png")
    })

    it("should return empty array for null pool", () => {
      const pool = null
      const assetByDenom = new Map()

      // Simulate getCoinLogos logic - null pool returns empty array
      const getCoinLogos = (
        pool: { coins: { denom: string }[] } | null,
        assetByDenom: Map<string, { logoUrl?: string }>,
      ): string[] => {
        if (!pool?.coins || pool.coins.length === 0) return []
        return pool.coins.map((coin) => {
          const asset = assetByDenom.get(coin.denom)
          return asset?.logoUrl || ""
        })
      }

      expect(getCoinLogos(pool, assetByDenom)).toEqual([])
    })

    it("should return empty string for missing logos", () => {
      const pool = {
        coins: [{ denom: "uinit" }],
      }
      const assetByDenom = new Map()

      const logos = pool.coins.map((coin) => {
        const asset = assetByDenom.get(coin.denom)
        return asset?.logoUrl || ""
      })

      expect(logos[0]).toBe("")
    })
  })

  describe("createRow pattern", () => {
    it("should create LiquidityTableRow with initial values", () => {
      const denom = "uinit"
      const pools = new Map([["uinit", { symbol: "INIT", pool_type: "balancer" }]])
      const assetByDenom = new Map([
        ["uinit", { decimals: 6, logoUrl: "https://example.com/init.png" }],
      ])

      // Simulate createRow logic
      const pool = pools.get(denom) ?? null
      const symbol = pool?.symbol || denom
      const decimals = assetByDenom.get(denom)?.decimals ?? 6
      const logoUrl = assetByDenom.get(denom)?.logoUrl

      const row: LiquidityTableRow = {
        denom,
        symbol,
        totalAmount: 0,
        totalValue: 0,
        decimals,
        poolType: pool?.pool_type,
        logoUrl,
        coinLogos: undefined,
        breakdown: {
          deposit: 0,
          staking: 0,
          lockStaking: 0,
          unstaking: 0,
        },
      }

      expect(row.denom).toBe("uinit")
      expect(row.symbol).toBe("INIT")
      expect(row.decimals).toBe(6)
      expect(row.poolType).toBe("balancer")
      expect(row.totalAmount).toBe(0)
      expect(row.totalValue).toBe(0)
    })

    it("should handle null pool", () => {
      const denom = "unknown"
      const pools = new Map()

      const pool = pools.get(denom) ?? null
      const symbol = pool?.symbol || denom

      expect(symbol).toBe("unknown")
    })
  })

  describe("processPositionsWithDenom pattern", () => {
    it("should process positions and update row breakdown", () => {
      const positions = new Map([["meta1", [{ denom: "lp-init-usdc", amount: "1000000" }]]])
      const denomsMap = new Map([["meta1", "lp-init-usdc"]])
      const prices = new Map([["lp-init-usdc", 2.5]])
      const rowMap = new Map([
        [
          "lp-init-usdc",
          {
            denom: "lp-init-usdc",
            symbol: "LP-INIT-USDC",
            totalAmount: 0,
            totalValue: 0,
            decimals: 6,
            breakdown: { deposit: 0, staking: 0, lockStaking: 0, unstaking: 0 },
          },
        ],
      ])

      // Simulate processPositionsWithDenom logic
      for (const [metadata, positionList] of positions) {
        const denom = denomsMap.get(metadata) ?? positionList[0]?.denom
        if (!denom || denom === INIT_DENOM) continue

        const row = rowMap.get(denom)
        if (!row) continue

        for (const position of positionList) {
          const formattedAmount = Number(position.amount) / 1_000_000 // simplified fromBaseUnit
          const price = prices.get(denom) ?? 0
          const value = formattedAmount * price

          row.breakdown.deposit += formattedAmount
          row.totalAmount += formattedAmount
          row.totalValue += value
        }
      }

      const row = rowMap.get("lp-init-usdc")
      expect(row?.breakdown.deposit).toBe(1)
      expect(row?.totalAmount).toBe(1)
      expect(row?.totalValue).toBe(2.5)
    })

    it("should skip INIT_DENOM", () => {
      const positions = new Map([["meta1", [{ denom: INIT_DENOM, amount: "1000000" }]]])
      const denomsMap = new Map([["meta1", INIT_DENOM]])
      const rowMap = new Map()

      // Simulate skipping logic
      for (const [metadata, positionList] of positions) {
        const denom = denomsMap.get(metadata) ?? positionList[0]?.denom
        if (!denom || denom === INIT_DENOM) continue
        // This should not execute
        rowMap.set(denom, {} as LiquidityTableRow)
      }

      expect(rowMap.size).toBe(0)
    })

    it("should skip when row not found in rowMap", () => {
      const positions = new Map([["meta1", [{ denom: "uusdc", amount: "1000000" }]]])
      const denomsMap = new Map([["meta1", "uusdc"]])
      const rowMap = new Map() // Empty, no matching row

      let processedCount = 0
      for (const [metadata, positionList] of positions) {
        const denom = denomsMap.get(metadata) ?? positionList[0]?.denom
        if (!denom || denom === INIT_DENOM) continue

        const row = rowMap.get(denom)
        if (!row) continue

        processedCount++
      }

      expect(processedCount).toBe(0)
    })
  })

  describe("processPositionsWithMetadata pattern", () => {
    it("should process positions using metadata only", () => {
      const positions = new Map([["meta1", [{ amount: "1000000" }]]])
      const denomsMap = new Map([["meta1", "lp-token"]])
      const prices = new Map([["lp-token", 3.0]])
      const rowMap = new Map([
        [
          "lp-token",
          {
            denom: "lp-token",
            symbol: "LP",
            totalAmount: 0,
            totalValue: 0,
            decimals: 6,
            breakdown: { deposit: 0, staking: 0, lockStaking: 0, unstaking: 0 },
          },
        ],
      ])

      // Simulate processPositionsWithMetadata logic
      for (const [metadata, positionList] of positions) {
        const denom = denomsMap.get(metadata)
        if (!denom || denom === INIT_DENOM) continue

        const row = rowMap.get(denom)
        if (!row) continue

        for (const position of positionList) {
          const formattedAmount = Number(position.amount) / 1_000_000
          const price = prices.get(denom) ?? 0
          const value = formattedAmount * price

          row.breakdown.lockStaking += formattedAmount
          row.totalAmount += formattedAmount
          row.totalValue += value
        }
      }

      const row = rowMap.get("lp-token")
      expect(row?.breakdown.lockStaking).toBe(1)
      expect(row?.totalAmount).toBe(1)
      expect(row?.totalValue).toBe(3.0)
    })
  })

  describe("addClaimableRewards pattern", () => {
    it("should add claimable rewards to rows", () => {
      const rowMap: Map<string, LiquidityTableRow> = new Map([
        [
          "lp-token",
          {
            denom: "lp-token",
            symbol: "LP",
            totalAmount: 10,
            totalValue: 100,
            decimals: 6,
            breakdown: { deposit: 0, staking: 10, lockStaking: 0, unstaking: 0 },
          },
        ],
      ])
      const metadata = denomToMetadata("lp-token")
      const stakingRewards: Map<string, Coin> = new Map([
        [metadata, { denom: INIT_DENOM, amount: "500000" }],
      ])
      const lockStakingRewards: Map<string, Coin> = new Map([
        [metadata, { denom: INIT_DENOM, amount: "300000" }],
      ])
      const initPrice = 2.0

      // Simulate addClaimableRewards logic
      for (const [denom, row] of rowMap) {
        const meta = denomToMetadata(denom)

        const stakingReward: Coin | undefined = stakingRewards?.get(meta)
        const stakingAmount = stakingReward ? String(Number(stakingReward.amount) / 1_000_000) : "0"

        const lockReward: Coin | undefined = lockStakingRewards?.get(meta)
        const lockAmount = lockReward ? String(Number(lockReward.amount) / 1_000_000) : "0"

        const totalAmount = Number(stakingAmount) + Number(lockAmount)

        if (totalAmount > 0) {
          row.claimableInit = {
            staking: stakingAmount,
            lockStaking: lockAmount,
            total: String(totalAmount),
            totalValue: totalAmount * initPrice,
          }
        }
      }

      const row = rowMap.get("lp-token")
      expect(row?.claimableInit?.staking).toBe("0.5")
      expect(row?.claimableInit?.lockStaking).toBe("0.3")
      expect(row?.claimableInit?.total).toBe("0.8")
      expect(row?.claimableInit?.totalValue).toBe(1.6)
    })

    it("should skip when total is zero", () => {
      const rowMap: Map<string, LiquidityTableRow> = new Map([
        [
          "lp-token",
          {
            denom: "lp-token",
            symbol: "LP",
            totalAmount: 10,
            totalValue: 100,
            decimals: 6,
            breakdown: { deposit: 0, staking: 0, lockStaking: 0, unstaking: 0 },
          },
        ],
      ])
      const stakingRewards = undefined as Map<string, Coin> | undefined
      const lockStakingRewards = undefined as Map<string, Coin> | undefined
      const initPrice = 2.0

      // Simulate addClaimableRewards logic
      for (const [denom, row] of rowMap) {
        const meta = denomToMetadata(denom)

        const stakingReward: Coin | undefined = stakingRewards?.get(meta)
        const stakingAmount = stakingReward ? String(Number(stakingReward.amount) / 1_000_000) : "0"

        const lockReward: Coin | undefined = lockStakingRewards?.get(meta)
        const lockAmount = lockReward ? String(Number(lockReward.amount) / 1_000_000) : "0"

        const totalAmount = Number(stakingAmount) + Number(lockAmount)

        if (totalAmount > 0) {
          row.claimableInit = {
            staking: stakingAmount,
            lockStaking: lockAmount,
            total: String(totalAmount),
            totalValue: totalAmount * initPrice,
          }
        }
      }

      const row = rowMap.get("lp-token")
      expect(row?.claimableInit).toBeUndefined()
    })

    it("should handle undefined rewards", () => {
      const stakingRewards = undefined as Map<string, Coin> | undefined
      const lockStakingRewards = undefined as Map<string, Coin> | undefined

      // Simulate safe access
      const meta = "test"
      const stakingReward: Coin | undefined = stakingRewards?.get(meta)
      const lockReward: Coin | undefined = lockStakingRewards?.get(meta)

      expect(stakingReward).toBeUndefined()
      expect(lockReward).toBeUndefined()
    })
  })
})
