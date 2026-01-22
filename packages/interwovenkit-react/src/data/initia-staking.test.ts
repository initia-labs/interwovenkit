import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { describe, expect, it } from "vitest"
import { createObjectAddress, denomToMetadata, InitiaAddress } from "@initia/utils"

// These are the helper functions we're testing (they're not exported, so we test the logic patterns)

describe("initia-staking helpers", () => {
  describe("getLockStakingAddress", () => {
    const LOCK_STAKE_MODULE_ADDRESS = "0x1"

    // Simulate getLockStakingAddress logic
    function getLockStakingAddress(address: string, lockStakeModuleAddress: string): string {
      const seed = `${lockStakeModuleAddress}::lock_staking::StakingAccount`
      const hexAddress = createObjectAddress(address, seed)
      return InitiaAddress(hexAddress).bech32
    }

    it("should derive lock staking address from user address", () => {
      // Use a hex address instead of bech32
      const userAddress = "0x0000000000000000000000000000000000000000000000000000000000000000"

      const lockAddress = getLockStakingAddress(userAddress, LOCK_STAKE_MODULE_ADDRESS)

      expect(lockAddress).toBeTruthy()
      expect(lockAddress).toMatch(/^init1/) // Should be bech32 format
    })

    it("should use lockStakeModuleAddress in seed", () => {
      const userAddress = "0x0000000000000000000000000000000000000000000000000000000000000000"
      const moduleAddress1 = "0x1"
      const moduleAddress2 = "0x2"

      const lock1 = getLockStakingAddress(userAddress, moduleAddress1)
      const lock2 = getLockStakingAddress(userAddress, moduleAddress2)

      // Different module addresses should produce different lock addresses
      expect(lock1).not.toBe(lock2)
    })

    it("should return bech32 format address", () => {
      const userAddress = "0x0000000000000000000000000000000000000000000000000000000000000000"

      const lockAddress = getLockStakingAddress(userAddress, LOCK_STAKE_MODULE_ADDRESS)

      expect(lockAddress).toMatch(/^init1[a-z0-9]+$/)
    })

    it("should be deterministic (same inputs = same output)", () => {
      const userAddress = "0x0000000000000000000000000000000000000000000000000000000000000000"

      const lock1 = getLockStakingAddress(userAddress, LOCK_STAKE_MODULE_ADDRESS)
      const lock2 = getLockStakingAddress(userAddress, LOCK_STAKE_MODULE_ADDRESS)

      expect(lock1).toBe(lock2)
    })

    it("should handle different user addresses", () => {
      const user1 = "0x0000000000000000000000000000000000000000000000000000000000000001"
      const user2 = "0x0000000000000000000000000000000000000000000000000000000000000002"

      const lock1 = getLockStakingAddress(user1, LOCK_STAKE_MODULE_ADDRESS)
      const lock2 = getLockStakingAddress(user2, LOCK_STAKE_MODULE_ADDRESS)

      // Different user addresses should produce different lock addresses
      expect(lock1).not.toBe(lock2)
    })
  })

  describe("normalizeRewards", () => {
    type RewardsResponse = {
      rewards: Array<{
        validator_address: string
        reward: Coin[]
      }>
      total: Coin[]
    }

    // Simulate normalizeRewards logic
    function normalizeRewards(data: RewardsResponse): Map<string, Coin> {
      const result = new Map<string, Coin>()

      if (!data.total || !Array.isArray(data.total)) {
        return result
      }

      for (const reward of data.total) {
        if (!reward.denom || !reward.amount) continue
        const metadata = denomToMetadata(reward.denom)
        if (!result.has(metadata)) {
          result.set(metadata, reward)
        }
      }

      return result
    }

    it("should transform rewards array to Map<metadata, reward>", () => {
      const response: RewardsResponse = {
        rewards: [],
        total: [
          { denom: "uinit", amount: "1000000" },
          { denom: "uusdc", amount: "500000" },
        ],
      }

      const result = normalizeRewards(response)

      const initMeta = denomToMetadata("uinit")
      const usdcMeta = denomToMetadata("uusdc")

      expect(result.size).toBe(2)
      expect(result.get(initMeta)?.denom).toBe("uinit")
      expect(result.get(initMeta)?.amount).toBe("1000000")
      expect(result.get(usdcMeta)?.denom).toBe("uusdc")
      expect(result.get(usdcMeta)?.amount).toBe("500000")
    })

    it("should use first reward per metadata key", () => {
      // Two different denoms that might resolve to same metadata (edge case)
      const response: RewardsResponse = {
        rewards: [],
        total: [
          { denom: "uinit", amount: "1000000" },
          { denom: "uinit", amount: "2000000" }, // Duplicate
        ],
      }

      const result = normalizeRewards(response)
      const meta = denomToMetadata("uinit")

      expect(result.size).toBe(1)
      expect(result.get(meta)?.amount).toBe("1000000") // First one
    })

    it("should handle empty total array", () => {
      const response: RewardsResponse = {
        rewards: [],
        total: [],
      }

      const result = normalizeRewards(response)

      expect(result.size).toBe(0)
    })

    it("should handle undefined total", () => {
      const response = {
        rewards: [],
        total: undefined,
      } as unknown as RewardsResponse

      const result = normalizeRewards(response)

      expect(result.size).toBe(0)
    })

    it("should handle non-array total", () => {
      const response = {
        rewards: [],
        total: "not an array",
      } as unknown as RewardsResponse

      const result = normalizeRewards(response)

      expect(result.size).toBe(0)
    })

    it("should extract denom and amount correctly", () => {
      const response: RewardsResponse = {
        rewards: [],
        total: [{ denom: "move/abc123", amount: "999888777" }],
      }

      const result = normalizeRewards(response)
      const meta = denomToMetadata("move/abc123")
      const reward = result.get(meta)

      expect(reward?.denom).toBe("move/abc123")
      expect(reward?.amount).toBe("999888777")
    })

    it("should skip rewards without denom or amount", () => {
      const response: RewardsResponse = {
        rewards: [],
        total: [
          { denom: "", amount: "1000" },
          { denom: "uinit", amount: "" },
          { denom: "uusdc", amount: "500" }, // Valid
        ],
      }

      const result = normalizeRewards(response)

      expect(result.size).toBe(1)
      const meta = denomToMetadata("uusdc")
      expect(result.get(meta)?.amount).toBe("500")
    })
  })
})
