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
  it("includes current and expected grantees", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      expectedGrantee: "init1expected",
      existingGrants: [],
      existingFeegrants: [],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute"],
    })

    expect(result).toEqual(["init1current", "init1expected"])
  })

  it("includes legacy autosign grantees with full authz coverage and eligible feegrant", () => {
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
          grantee: "init1legacy",
          authorization: {
            msg: "/initia.move.v1.MsgPublish",
          },
        },
        {
          grantee: "init1ignored",
          authorization: {
            msg: "/cosmos.bank.v1beta1.MsgSend",
          },
        },
      ],
      existingFeegrants: [
        {
          granter: "init1granter",
          grantee: "init1legacy",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
          },
        },
      ],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute", "/initia.move.v1.MsgPublish"],
    })

    expect(result).toEqual(["init1current", "init1legacy"])
  })

  it("does not include grantees with partial authz overlap even with feegrant", () => {
    const result = resolveEnableAutoSignGranteeCandidates({
      currentGrantee: "init1current",
      existingGrants: [
        {
          grantee: "init1third-party",
          authorization: {
            msg: "/initia.move.v1.MsgExecute",
          },
        },
      ],
      existingFeegrants: [
        {
          granter: "init1granter",
          grantee: "init1third-party",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
          },
        },
      ],
      allowedMessageTypes: ["/initia.move.v1.MsgExecute", "/initia.move.v1.MsgPublish"],
    })

    expect(result).toEqual(["init1current"])
  })
})

describe("resolveAutoSignFeegrantGranteeCandidates", () => {
  it("includes known MsgExec and basic feegrants, and excludes unknown grantees", () => {
    const result = resolveAutoSignFeegrantGranteeCandidates({
      feegrants: [
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
          grantee: "init1legacy-basic",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
          },
        },
        {
          granter: "init1granter",
          grantee: "init1unknown",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
          },
        },
        {
          granter: "init1granter",
          grantee: "init1known-non-exec",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            allowedMessages: ["/cosmos.bank.v1beta1.MsgSend"],
          },
        },
      ],
      knownAutoSignGrantees: ["init1autosign", "init1legacy-basic", "init1known-non-exec"],
    })

    expect(result).toEqual(["init1autosign", "init1legacy-basic"])
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
