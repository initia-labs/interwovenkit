import { describe, expect, it } from "vitest"
import type { FeegrantAllowance } from "./fetch"
import {
  createAutoSignMessageTypesKey,
  findValidGranteeCandidates,
  findValidGranteeWithFeegrant,
  resolveAutoSignEnabledForChain,
} from "./validation"

const findFirstValidGrantee = (
  grants: Parameters<typeof findValidGranteeCandidates>[0],
  requiredMsgTypes: Parameters<typeof findValidGranteeCandidates>[1],
) => {
  return findValidGranteeCandidates(grants, requiredMsgTypes)[0] ?? null
}

describe("findFirstValidGrantee", () => {
  const msgType1 = "/initia.move.v1.MsgExecute"
  const msgType2 = "/cosmos.bank.v1beta1.MsgSend"

  describe("no matching grantee", () => {
    it("returns null for empty grants array", () => {
      const result = findFirstValidGrantee([], [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when no grantee has required message type", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: "/some.other.MsgType" } },
        { grantee: "init1def", authorization: { msg: "/another.MsgType" } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when grantee has partial match", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })

    it("returns null when required types are split across grantees", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1def", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })
  })

  describe("single required message type", () => {
    it("finds grantee with matching message type", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
    })

    it("returns first matching grantee when multiple match", () => {
      const grants = [
        { grantee: "init1first", authorization: { msg: msgType1 } },
        { grantee: "init1second", authorization: { msg: msgType1 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grantee).toBe("init1first")
    })
  })

  describe("multiple required message types", () => {
    it("finds grantee with all required message types", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
      expect(result?.grants).toHaveLength(2)
    })

    it("skips grantee with partial match, finds complete match", () => {
      const grants = [
        { grantee: "init1partial", authorization: { msg: msgType1 } },
        { grantee: "init1complete", authorization: { msg: msgType1 } },
        { grantee: "init1complete", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result?.grantee).toBe("init1complete")
    })

    it("handles duplicate grants for same message type", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
    })
  })

  describe("expiration handling", () => {
    it("includes expiration in returned grants", () => {
      const expiration = "2099-12-31T23:59:59Z"
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 }, expiration }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grants[0].expiration).toBe(expiration)
    })

    it("handles grants without expiration", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grants[0].expiration).toBeUndefined()
    })

    it("handles mixed expiration states", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2099-12-31T23:59:59Z",
        },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result?.grants).toHaveLength(2)
      expect(result?.grants.find((g) => g.authorization.msg === msgType1)?.expiration).toBeDefined()
      expect(
        result?.grants.find((g) => g.authorization.msg === msgType2)?.expiration,
      ).toBeUndefined()
    })

    it("filters out expired grants", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when all matching grants are expired", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
        {
          grantee: "init1abc",
          authorization: { msg: msgType2 },
          expiration: "2099-12-31T23:59:59Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })

    it("finds grantee with valid grants when another has expired grants", () => {
      const grants = [
        {
          grantee: "init1expired",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
        {
          grantee: "init1valid",
          authorization: { msg: msgType1 },
          expiration: "2099-12-31T23:59:59Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grantee).toBe("init1valid")
    })
  })

  describe("empty required types", () => {
    it("returns null when no message types are required", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [])

      expect(result).toBeNull()
    })

    it("returns null for empty grants with empty required types", () => {
      const result = findFirstValidGrantee([], [])

      expect(result).toBeNull()
    })
  })
})

describe("findValidGranteeCandidates", () => {
  it("returns all authz-valid grantees in encounter order", () => {
    const msgType = "/initia.move.v1.MsgExecute"
    const grants = [
      { grantee: "init1first", authorization: { msg: msgType } },
      { grantee: "init1second", authorization: { msg: msgType } },
    ]

    const result = findValidGranteeCandidates(grants, [msgType])

    expect(result.map((candidate) => candidate.grantee)).toEqual(["init1first", "init1second"])
  })
})

describe("findValidGranteeWithFeegrant", () => {
  const allowExecFeegrant: FeegrantAllowance = {
    granter: "init1granter",
    grantee: "init1candidate",
    allowance: {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
      },
      allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
    },
  }

  it("skips candidate without feegrant and selects next eligible candidate", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateB" ? allowExecFeegrant : null,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })

  it("skips feegrant that does not allow MsgExec", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const disallowExecFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateA",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        },
        allowedMessages: ["/cosmos.bank.v1beta1.MsgSend"],
      },
    }

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateA" ? disallowExecFeegrant : allowExecFeegrant,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })

  it("keeps candidate priority even when later candidates resolve faster", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) => {
        if (grantee === "init1candidateA") {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return allowExecFeegrant
      },
      concurrency: 2,
    })

    expect(result?.grantee.grantee).toBe("init1candidateA")
  })

  it("skips expired feegrant and selects candidate with active feegrant", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const expiredFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateA",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        expiration: "2020-01-01T00:00:00Z",
      },
    }

    const activeFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateB",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        expiration: "2099-01-01T00:00:00Z",
      },
    }

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateA" ? expiredFeegrant : activeFeegrant,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })
})

describe("resolveAutoSignEnabledForChain", () => {
  it("returns false when expiration is null", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: null,
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(false)
  })

  it("returns true for permanent grant when addresses match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(true)
  })

  it("returns true for permanent grant when expected address is unavailable", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: undefined,
    })

    expect(result).toBe(true)
  })

  it("returns false for permanent grant when expected address key is missing", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: null,
    })

    expect(result).toBe(false)
  })

  it("returns false for permanent grant when addresses do not match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: "init1other",
    })

    expect(result).toBe(false)
  })

  it("returns true for future expiration when addresses match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2099-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(true)
  })

  it("returns false for future expiration when addresses do not match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2099-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1other",
    })

    expect(result).toBe(false)
  })

  it("returns false for expired grants", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2020-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(false)
  })
})

describe("createAutoSignMessageTypesKey", () => {
  it("creates a stable key regardless of chain order", () => {
    const first = createAutoSignMessageTypesKey({
      "initia-2": ["/initia.move.v1.MsgExecute"],
      "initia-1": ["/cosmwasm.wasm.v1.MsgExecuteContract"],
    })

    const second = createAutoSignMessageTypesKey({
      "initia-1": ["/cosmwasm.wasm.v1.MsgExecuteContract"],
      "initia-2": ["/initia.move.v1.MsgExecute"],
    })

    expect(first).toBe(second)
  })

  it("creates a stable key regardless of message type order", () => {
    const first = createAutoSignMessageTypesKey({
      "initia-1": ["/b.Msg", "/a.Msg"],
    })

    const second = createAutoSignMessageTypesKey({
      "initia-1": ["/a.Msg", "/b.Msg"],
    })

    expect(first).toBe(second)
  })

  it("changes key when message type configuration changes", () => {
    const current = createAutoSignMessageTypesKey({
      "initia-1": ["/initia.move.v1.MsgExecute"],
    })

    const next = createAutoSignMessageTypesKey({
      "initia-1": ["/initia.move.v1.MsgExecute", "/cosmos.bank.v1beta1.MsgSend"],
    })

    expect(current).not.toBe(next)
  })
})
