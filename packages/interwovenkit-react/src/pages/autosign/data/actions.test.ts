import { describe, expect, it } from "vitest"
import {
  resolveAutoSignFeegrantGranteeCandidates,
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
  it("includes current grantee and legacy autosign grantees", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      existingGrants: [
        {
          grantee: "init1legacy",
          authorization: {
            msg: "/initia.move.v1.MsgExecute",
          },
        },
        {
          grantee: "init1ignored",
          authorization: {
            msg: "/cosmos.bank.v1beta1.MsgSend",
          },
        },
      ],
      feegrantGrantees: [],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute"],
    })

    expect(result).toEqual(["init1current", "init1legacy"])
  })

  it("includes feegrant-only grantees for revocation", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      existingGrants: [],
      feegrantGrantees: ["init1feegrant-only"],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute"],
    })

    expect(result).toEqual(["init1current", "init1feegrant-only"])
  })

  it("deduplicates grantees coming from grants and feegrants", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      existingGrants: [
        {
          grantee: "init1shared",
          authorization: {
            msg: "/initia.move.v1.MsgExecute",
          },
        },
      ],
      feegrantGrantees: ["init1shared"],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute"],
    })

    expect(result).toEqual(["init1current", "init1shared"])
  })
})

describe("resolveAutoSignFeegrantGranteeCandidates", () => {
  it("returns only grantees with MsgExec-allowed feegrants", () => {
    const result = resolveAutoSignFeegrantGranteeCandidates([
      {
        granter: "init1granter",
        grantee: "init1autosign",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
          allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
        },
      },
      {
        granter: "init1granter",
        grantee: "init1other",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
          allowedMessages: ["/cosmos.bank.v1beta1.MsgSend"],
        },
      },
      {
        granter: "init1granter",
        grantee: "init1unbounded",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        },
      },
    ])

    expect(result).toEqual(["init1autosign"])
  })
})

describe("shouldClearDerivedWalletAfterDisable", () => {
  it("does not clear wallet when target chain is still enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: true,
      hasEnabledSibling: false,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("does not clear wallet when target chain status is unknown", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: undefined,
      hasEnabledSibling: false,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("does not clear wallet when another sibling chain remains enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: false,
      hasEnabledSibling: true,
    })

    expect(shouldClearWallet).toBe(false)
  })

  it("clears wallet when target chain is disabled and no siblings are enabled", () => {
    const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
      isEnabledOnTargetChain: false,
      hasEnabledSibling: false,
    })

    expect(shouldClearWallet).toBe(true)
  })
})
