import { describe, expect, it } from "vitest"
import {
  resolveDisableAutoSignGrantee,
  shouldBroadcastDisableAutoSign,
  shouldRefetchDisableAutoSignGrantee,
} from "./actions"

describe("resolveDisableAutoSignGrantee", () => {
  it("prioritizes explicit grantee", () => {
    const result = resolveDisableAutoSignGrantee({
      explicitGrantee: "init1explicit",
      cachedDerivedAddress: "init1cached",
      statusGrantee: "init1status",
    })

    expect(result).toBe("init1explicit")
  })

  it("falls back to cached derived wallet address", () => {
    const result = resolveDisableAutoSignGrantee({
      cachedDerivedAddress: "init1cached",
      statusGrantee: "init1status",
    })

    expect(result).toBe("init1cached")
  })

  it("falls back to status grantee when no explicit or cached address exists", () => {
    const result = resolveDisableAutoSignGrantee({
      statusGrantee: "init1status",
    })

    expect(result).toBe("init1status")
  })
})

describe("shouldRefetchDisableAutoSignGrantee", () => {
  it("returns true when no grantee source is available", () => {
    const result = shouldRefetchDisableAutoSignGrantee({
      explicitGrantee: undefined,
      cachedDerivedAddress: undefined,
      currentGrantee: undefined,
    })

    expect(result).toBe(true)
  })

  it("returns false when explicit grantee exists", () => {
    const result = shouldRefetchDisableAutoSignGrantee({
      explicitGrantee: "init1explicit",
      cachedDerivedAddress: undefined,
      currentGrantee: undefined,
    })

    expect(result).toBe(false)
  })

  it("returns false when current grantee already exists", () => {
    const result = shouldRefetchDisableAutoSignGrantee({
      explicitGrantee: undefined,
      cachedDerivedAddress: undefined,
      currentGrantee: "init1status",
    })

    expect(result).toBe(false)
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
