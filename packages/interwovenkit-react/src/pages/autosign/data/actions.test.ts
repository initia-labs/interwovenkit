import { describe, expect, it } from "vitest"
import {
  resolveDisableAutoSignGranteeCandidates,
  resolveEnableAutoSignGranteeCandidates,
  shouldBroadcastDisableAutoSign,
  shouldRefetchDisableAutoSignGrantee,
} from "./actions"

describe("shouldRefetchDisableAutoSignGrantee", () => {
  it("returns true when explicit grantee is missing", () => {
    const result = shouldRefetchDisableAutoSignGrantee({
      explicitGrantee: undefined,
    })

    expect(result).toBe(true)
  })

  it("returns false when explicit grantee exists", () => {
    const result = shouldRefetchDisableAutoSignGrantee({
      explicitGrantee: "init1explicit",
    })

    expect(result).toBe(false)
  })
})

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
      allowedMessageTypes: ["/initia.move.v1.MsgExecute"],
    })

    expect(result).toEqual(["init1current", "init1legacy"])
  })
})

describe("shouldBroadcastDisableAutoSign", () => {
  it("returns false when revoke message list is empty", () => {
    expect(shouldBroadcastDisableAutoSign([])).toBe(false)
  })

  it("returns true when at least one revoke message exists", () => {
    expect(shouldBroadcastDisableAutoSign([{ typeUrl: "any" }])).toBe(true)
  })
})
