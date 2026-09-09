import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AUTO_SIGN_GRANT_REVALIDATION_DELAY_MS,
  collectRevokeAuthzMessageTypes,
  getLegacyExpectedAddressAction,
  resolveDisableAutoSignGranteeCandidates,
  resolveEnableAutoSignGranteeCandidates,
  resolveEnableStayConnected,
  scheduleAutoSignGrantRevalidation,
  shouldClearDerivedWalletAfterDisable,
  shouldCreateRandomAutoSignCandidate,
  shouldUpdateStayConnectedOnEnable,
} from "./actions"
import { autoSignQueryKeys } from "./validation"

afterEach(() => vi.useRealTimers())

describe("scheduleAutoSignGrantRevalidation", () => {
  it("coalesces an indexer-lag retry after immediate mutation invalidation", async () => {
    vi.useFakeTimers()
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)
    const queryClient = { invalidateQueries } as never

    scheduleAutoSignGrantRevalidation(queryClient)
    scheduleAutoSignGrantRevalidation(queryClient)

    await vi.advanceTimersByTimeAsync(AUTO_SIGN_GRANT_REVALIDATION_DELAY_MS - 1)
    expect(invalidateQueries).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: autoSignQueryKeys.expirations._def,
    })
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: autoSignQueryKeys.grants._def,
    })
  })
})

describe("resolveDisableAutoSignGranteeCandidates", () => {
  it("uses only explicit grantee when provided", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      explicitGrantee: "init1explicit",
      cachedDerivedAddress: "init1cached",
      activeIdentityAddress: "init1active",
      statusGrantee: "init1status",
      refetchedStatusGrantee: "init1refetched",
    })

    expect(result).toEqual(["init1explicit"])
  })

  it("returns candidates in priority order with deduplication", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      cachedDerivedAddress: "init1cached",
      activeIdentityAddress: "init1active",
      statusGrantee: "init1cached",
      refetchedStatusGrantee: "init1refetched",
    })

    expect(result).toEqual(["init1cached", "init1active", "init1refetched"])
  })

  it("drops empty candidates when explicit grantee is missing", () => {
    const result = resolveDisableAutoSignGranteeCandidates({
      cachedDerivedAddress: undefined,
      activeIdentityAddress: "init1random",
      statusGrantee: "init1status",
      refetchedStatusGrantee: undefined,
    })

    expect(result).toEqual(["init1random", "init1status"])
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

  it("retains a pre-derivation forgotten random signer for the replacement revoke", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1newlegacy",
      knownGrantees: ["init1forgottenrandom"],
    })

    expect(result).toEqual(["init1newlegacy", "init1forgottenrandom"])
  })
})

describe("enable storage preference", () => {
  it("honors saved tab-only mode when a legacy numeric caller omits the checkbox", () => {
    const effectiveStayConnected = resolveEnableStayConnected(undefined, false)

    expect(effectiveStayConnected).toBe(false)
    expect(
      shouldCreateRandomAutoSignCandidate({
        expectedGrantee: undefined,
        hasActiveIdentity: false,
        stayConnected: effectiveStayConnected,
        autoSignStorage: "browser",
      }),
    ).toBe(false)
  })

  it("creates a random candidate only after an explicit persistent choice", () => {
    expect(
      shouldCreateRandomAutoSignCandidate({
        expectedGrantee: undefined,
        hasActiveIdentity: false,
        stayConnected: true,
        autoSignStorage: "browser",
      }),
    ).toBe(true)
  })
})

describe("getLegacyExpectedAddressAction", () => {
  it("stores the compatibility mirror only for a reproducible legacy signer", () => {
    expect(getLegacyExpectedAddressAction("legacy-derived")).toBe("store")
  })

  it("never mirrors a random signer and self-heals only its exact stale mirror", () => {
    expect(getLegacyExpectedAddressAction("random")).toBe("clear")
    expect(getLegacyExpectedAddressAction(undefined)).toBeUndefined()
  })
})

describe("shouldUpdateStayConnectedOnEnable", () => {
  it("does not persist an unproven replacement random identity before its grant", () => {
    expect(
      shouldUpdateStayConnectedOnEnable({
        hasActiveIdentity: true,
        createRandomCandidate: true,
        stayConnected: true,
      }),
    ).toBe(false)
  })

  it("applies an explicit preference change to a restored active identity", () => {
    expect(
      shouldUpdateStayConnectedOnEnable({
        hasActiveIdentity: true,
        createRandomCandidate: false,
        stayConnected: false,
      }),
    ).toBe(true)
  })
})

describe("collectRevokeAuthzMessageTypes", () => {
  it("returns all unique grant message types regardless of current config", () => {
    const result = collectRevokeAuthzMessageTypes([
      { authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } },
      { authorization: { msg: "/initia.move.v1.MsgExecute" } },
      { authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } },
    ])

    expect(result).toEqual(["/cosmos.bank.v1beta1.MsgSend", "/initia.move.v1.MsgExecute"])
  })

  it("drops empty message types", () => {
    const result = collectRevokeAuthzMessageTypes([
      { authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } },
      { authorization: {} },
      { authorization: { msg: "" } },
    ])

    expect(result).toEqual(["/cosmos.bank.v1beta1.MsgSend"])
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

  it("retains wallet when target chain status is unknown after broadcast", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: undefined,
      hasEnabledSibling: false,
      didBroadcast: true,
      hasExplicitGrantee: false,
    })

    expect(shouldClearWallet).toBe(false)
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
