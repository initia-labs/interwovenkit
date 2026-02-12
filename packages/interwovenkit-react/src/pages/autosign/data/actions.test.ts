import { describe, expect, it } from "vitest"
import {
  resolveDisableAutoSignGranteeCandidates,
  resolveEnableAutoSignGranteeCandidates,
  shouldClearDerivedWalletAfterDisable,
} from "./actions"

describe("resolveDisableAutoSignGranteeCandidates", () => {
  it("uses only explicit grantee when provided", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      explicitGrantee: "init1explicit",
      cachedDerivedAddress: "init1cached",
      statusGrantee: "init1status",
      refetchedStatusGrantee: "init1refetched",
    })

    expect(result).toEqual(["init1explicit"])
  })

  it("returns candidates in priority order with deduplication", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      cachedDerivedAddress: "init1cached",
      statusGrantee: "init1cached",
      refetchedStatusGrantee: "init1refetched",
    })

    expect(result).toEqual(["init1cached", "init1refetched"])
  })

  it("drops empty candidates when explicit grantee is missing", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      cachedDerivedAddress: undefined,
      statusGrantee: "init1status",
      refetchedStatusGrantee: undefined,
    })

    expect(result).toEqual(["init1status"])
  })
})

describe("resolveEnableAutoSignGranteeCandidates", () => {
  it("includes current and expected grantees", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      expectedGrantee: "init1expected",
    })

    expect(result).toEqual(["init1current", "init1expected"])
  })

  it("deduplicates identical current and expected grantees", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      expectedGrantee: "init1current",
    })

    expect(result).toEqual(["init1current"])
  })

  it("returns only the trusted current grantee when no expected grantee exists", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
    })

    expect(result).toEqual(["init1current"])
  })
})

describe("shouldClearDerivedWalletAfterDisable", () => {
  it("does not clear wallet when target chain is still enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: true,
      hasEnabledSibling: false,
      didBroadcast: true,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("does not clear wallet when target chain status is unknown and no transaction was broadcast", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: undefined,
      hasEnabledSibling: false,
      didBroadcast: false,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("clears wallet when target chain status is unknown after broadcast in default disable flow", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: undefined,
      hasEnabledSibling: false,
      didBroadcast: true,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(true)
  })

  it("does not clear wallet when status is unknown after explicit grantee revoke", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: undefined,
      hasEnabledSibling: false,
      didBroadcast: true,
      hasExplicitGrantee: true,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("does not clear wallet when another sibling chain remains enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: false,
      hasEnabledSibling: true,
      didBroadcast: true,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("clears wallet when target chain is disabled and no siblings are enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: false,
      hasEnabledSibling: false,
      didBroadcast: false,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(true)
  })
})
